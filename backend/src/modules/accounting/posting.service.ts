import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { PeriodService } from '../../common/period/period.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { DocDate } from '../../common/utils/dates';
import { D, DecValue } from '../../common/utils/money';
import { DbOrTx, Tx } from '../../db/db';
import { accounts, journalEntries } from '../../db/schema';
import { DEFAULT_COA, SystemKey } from './default-coa';
import { JournalValidationError, normalizeJournalLines } from './journal-rules';
import { ReferenceRepository } from '../../db/reference.repository';
import { insertOne, patchById } from '../../db/owned';
import { PostingRepository } from './posting.repository';

export interface PostLine {
  /** Salah satu: id akun, atau kunci akun sistem (AR, SALES, ...) */
  accountId?: string;
  key?: SystemKey;
  debit?: DecValue;
  credit?: DecValue;
  /** Jumlah valas (positif) — wajib untuk akun kas/bank bermata uang asing, dilarang untuk akun Rupiah */
  foreignAmount?: DecValue | null;
  memo?: string;
  /** Proyek (usaha jasa) — dipakai jurnal umum untuk biaya langsung proyek */
  projectId?: string | null;
  /** Cabang baris ini; tidak diisi = ikut cabang jurnal (diturunkan dari dokumen sumbernya); null = pusat (paksa tanpa cabang) */
  branchId?: string | null;
}

export interface PostJournalInput {
  tenantId: string;
  date: DocDate;
  description: string;
  sourceType: string;
  sourceId?: string;
  /** Nomor bukti transaksi */
  reference?: string;
  createdById?: string;
  /** Cabang untuk seluruh baris tanpa cabang sendiri; kosong = diturunkan otomatis dari gudang / kas dokumen sumber */
  branchId?: string | null;
  lines: PostLine[];
}

/**
 * Satu-satunya pintu masuk untuk menulis jurnal.
 * Modul lain (penjualan, pembelian, kas, inventori) memanggil ini di dalam transaksinya sendiri,
 * sehingga dokumen dan jurnalnya selalu tersimpan bersama atau tidak sama sekali.
 */
@Injectable()
export class PostingService {
  constructor(
    private readonly seq: SequenceService,
    private readonly period: PeriodService,
    private readonly refs: ReferenceRepository,
    private readonly repo: PostingRepository,
  ) {}

  async post(tx: Tx, input: PostJournalInput) {
    // Jurnal penutup tahun hanya memindahkan saldo pendapatan/beban ke Laba Ditahan (laporan laba rugi mengabaikannya), jadi boleh
    // dibuat sesudah periodenya dikunci; tanpa pengecualian ini kunci periode otomatis menghalangi tutup buku.
    if (input.sourceType !== 'CLOSING') await this.period.assertOpen(tx, input.tenantId, input.date);
    const accountRows = await this.resolveAccountRows(tx, input.tenantId, input.lines);
    const accountIds = accountRows.map((a) => a.id);
    input.lines.forEach((l, i) => this.assertForeignAmount(accountRows[i], l));

    let normalized;
    try {
      normalized = normalizeJournalLines(input.lines.map((l, i) => ({ ...l, accountId: accountIds[i] })));
    } catch (e) {
      if (e instanceof JournalValidationError) throw new BadRequestException(e.message);
      throw e;
    }
    const pids = [...new Set(normalized.lines.map((l) => l.projectId).filter((x): x is string => !!x))];
    if (pids.length) {
      const found = await this.repo.queryProject(tx, input.tenantId, pids);
      if (found.rows.length !== pids.length) throw new BadRequestException('Proyek tidak ditemukan');
    }
    if (input.sourceType !== 'CASH_COUNT') await this.assertCashNotCounted(tx, input.tenantId, input.date, normalized.lines.map((l) => l.accountId));
    // Cabang: eksplisit per baris / per jurnal, atau diturunkan otomatis dari gudang atau kas dokumen sumber
    const explicit = [...new Set([...normalized.lines.map((l) => l.branchId).filter((x): x is string => !!x), ...(input.branchId ? [input.branchId] : [])])];
    if (explicit.length) {
      const ok = await this.repo.queryBranche(tx, input.tenantId, explicit);
      if (ok.rows.length !== explicit.length) throw new BadRequestException('Cabang tidak ditemukan');
    }
    const entryBranch = input.branchId ?? (await this.deriveBranch(tx, input.tenantId, input.sourceType, input.sourceId));

    // Jurnal lintas cabang: tiap cabang harus seimbang sendiri. Selisih per cabang ditutup otomatis lewat Rekening Antar Cabang
    // (piutang di satu cabang, utang di cabang lain; nol saat digabung), jadi pusat membayar biaya cabang, transfer kas antar-cabang,
    // dan gaji karyawan cabang tidak merusak neraca per cabang.
    const labelOf = (l: { branchId?: string | null }) => (l.branchId === undefined ? entryBranch : l.branchId) ?? null;
    if (new Set(normalized.lines.map(labelOf)).size > 1) {
      const net = new Map<string | null, ReturnType<typeof D>>();
      for (const l of normalized.lines) net.set(labelOf(l), (net.get(labelOf(l)) ?? D(0)).plus(l.debit).minus(l.credit));
      const [rak] = await this.resolveAccounts(tx, input.tenantId, [{ key: 'INTERBRANCH' }]);
      for (const [b, v] of net) {
        if (v.isZero()) continue;
        normalized.lines.push({ accountId: rak, debit: v.isNegative() ? v.abs() : D(0), credit: v.isPositive() ? v : D(0), foreignAmount: null, memo: 'Antar cabang', projectId: null, branchId: b });
      }
    }

    const number = await this.seq.next(tx, input.tenantId, 'JOURNAL', input.date);
    const entry = await insertOne(tx, journalEntries, {
        tenantId: input.tenantId,
        number,
        date: input.date,
        description: input.description,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        reference: input.reference,
        createdById: input.createdById,
      });
    const lines = await this.repo.insertJournalLinesForPost(tx, normalized.lines, entry.id, entryBranch);
    return { ...entry, lines };
  }

  /**
   * Cabang dokumen sumber: gudang/toko → cabang pemiliknya; kas → cabang yang dipilih di transaksi kas.
   * Hanya dijalankan bila perusahaan punya cabang (satu query ringan); kosong bila tidak bisa ditentukan.
   */
  private async deriveBranch(tx: Tx, tenantId: string, sourceType: string, sourceId?: string): Promise<string | null> {
    if (!sourceId) return null;
    const any = await this.repo.queryBrancheForDeriveBranch(tx, tenantId);
    if (!any.rows.length) return null;
    const id = sourceId;
    const wh = (whSql: ReturnType<typeof sql>) => sql`SELECT w.branch_id::text AS b FROM warehouses w WHERE w.tenant_id = ${tenantId} AND w.id = (${whSql})`;
    let q;
    switch (sourceType) {
      case 'POS':
        q = wh(sql`SELECT s.warehouse_id FROM pos_orders o JOIN pos_sessions s ON s.id = o.session_id WHERE o.id::text = ${id}`);
        break;
      case 'POS_CLOSE':
        q = wh(sql`SELECT warehouse_id FROM pos_sessions WHERE id::text = ${id}`);
        break;
      case 'POS_RETURN':
        q = wh(sql`SELECT warehouse_id FROM pos_returns WHERE id::text = ${id}`);
        break;
      case 'DELIVERY':
        q = wh(sql`SELECT warehouse_id FROM delivery_orders WHERE id::text = ${id}`);
        break;
      case 'GOODS_RECEIPT':
        q = wh(sql`SELECT warehouse_id FROM goods_receipts WHERE id::text = ${id}`);
        break;
      case 'INVOICE':
        q = wh(sql`SELECT so.warehouse_id FROM invoices i JOIN sales_orders so ON so.id = i.sales_order_id WHERE i.id::text = ${id}`);
        break;
      case 'PAYMENT':
        q = wh(sql`SELECT so.warehouse_id FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN sales_orders so ON so.id = i.sales_order_id WHERE p.id::text = ${id}`);
        break;
      case 'SALES_RETURN':
        q = wh(sql`SELECT so.warehouse_id FROM sales_returns r JOIN invoices i ON i.id = r.invoice_id JOIN sales_orders so ON so.id = i.sales_order_id WHERE r.id::text = ${id}`);
        break;
      case 'PURCHASE_INVOICE':
        q = wh(sql`SELECT warehouse_id FROM purchase_invoices WHERE id::text = ${id}`);
        break;
      case 'SUPPLIER_PAYMENT':
        q = wh(sql`SELECT i.warehouse_id FROM supplier_payments p JOIN purchase_invoices i ON i.id = p.purchase_invoice_id WHERE p.id::text = ${id}`);
        break;
      case 'PURCHASE_RETURN':
        q = wh(sql`SELECT warehouse_id FROM purchase_returns WHERE id::text = ${id}`);
        break;
      case 'BANK':
        q = sql`SELECT a.branch_id::text AS b FROM bank_statement_lines l JOIN bank_statements st ON st.id = l.statement_id JOIN accounts a ON a.id = st.cash_account_id WHERE l.tenant_id = ${tenantId} AND l.id::text = ${id}`;
        break;
      case 'CASH_IN':
      case 'CASH_OUT':
      case 'TRANSFER':
        q = sql`SELECT branch_id::text AS b FROM cash_transactions WHERE tenant_id = ${tenantId} AND id::text = ${id}`;
        break;
      default:
        // dokumen stok lain (penyesuaian, transfer, produksi, penurunan nilai): gudang dari mutasi stok dokumen itu
        q = wh(sql`SELECT warehouse_id FROM stock_moves WHERE tenant_id = ${tenantId} AND ref_id = ${id} ORDER BY created_at LIMIT 1`);
    }
    const r = await this.repo.queryDeriveBranch(tx, q);
    return r.rows[0]?.b ?? null;
  }

  /** Koreksi jurnal = jurnal balik. Jurnal asli tidak pernah diubah/dihapus. */
  /** `internal` = dibalik oleh modul pemiliknya (mis. pembatalan setoran pajak), bukan dari menu jurnal */
  async reverse(tx: Tx, tenantId: string, journalId: string, date: DocDate, userId?: string, internal = false) {
    await this.period.assertOpen(tx, tenantId, date);
    const original = await tx.query.journalEntries.findFirst({
      where: and(eq(journalEntries.id, journalId), eq(journalEntries.tenantId, tenantId)),
      with: { lines: true },
    });
    if (!original) throw new NotFoundException('Jurnal tidak ditemukan');
    if (original.reversalOfId) throw new BadRequestException('Jurnal balik tidak dapat dibalik lagi');
    if (!internal && !['MANUAL', 'OPENING', 'ADJUSTMENT', 'RECURRING', 'INCOME_TAX', 'BANK'].includes(original.sourceType)) {
      throw new BadRequestException('Jurnal otomatis dikoreksi lewat dokumennya (retur / pembatalan), bukan dibalik manual');
    }
    if (original.sourceType !== 'CASH_COUNT') await this.assertCashNotCounted(tx, tenantId, date, original.lines.map((l) => l.accountId));
    const already = await tx.query.journalEntries.findFirst({ where: eq(journalEntries.reversalOfId, journalId) });
    if (already) throw new BadRequestException(`Jurnal ini sudah dibalik oleh ${already.number}`);

    const number = await this.seq.next(tx, tenantId, 'JOURNAL', date);
    const entry = await insertOne(tx, journalEntries, {
        tenantId,
        number,
        date,
        description: `Pembalikan ${original.number}: ${original.description}`,
        sourceType: 'REVERSAL',
        sourceId: original.id,
        reversalOfId: original.id,
        createdById: userId,
      });
    const lines = await this.repo.insertJournalLines(tx, original.lines, entry.id);
    return { ...entry, lines };
  }

  /**
   * Kas yang sudah diopname (selesai) terkunci sampai tanggal opname: transaksi baru ke akun itu
   * harus bertanggal sesudahnya, agar hasil opname yang sudah ditandatangani tidak berubah.
   */
  async assertCashNotCounted(tx: DbOrTx, tenantId: string, date: DocDate, accountIds: string[]) {
    const ids = [...new Set(accountIds)];
    if (!ids.length) return;
    const r = await this.repo.queryCashCount(tx, tenantId, date, ids);
    const c = r.rows[0];
    if (c) {
      const [y, m, d] = c.date.split('-');
      throw new BadRequestException(`${c.name} sudah diopname per ${d}/${m}/${y} (${c.number}). Transaksi ke akun ini harus bertanggal sesudah tanggal opname.`);
    }
  }

  /**
   * Akun kas/bank untuk penerimaan/pembayaran.
   * Jika id diberikan harus akun kas milik perusahaan; jika tidak, pakai akun sistem (Kas atau Bank).
   * Rekening bermata uang asing ditolak kecuali alurnya memang mengenal valas (`allowForeign`): pembayaran faktur dan transaksi kas.
   */
  async resolveCashAccount(db: DbOrTx, tenantId: string, accountId: string | undefined, fallback: 'CASH' | 'BANK', allowForeign = false) {
    if (accountId) {
      const acc = await this.refs.account(db, tenantId, accountId);
      if (!acc || !acc.isCashAccount || !acc.isPostable) throw new BadRequestException('Akun kas/bank tidak valid');
      if (acc.currency !== 'IDR' && !allowForeign) throw new BadRequestException(`${acc.name} adalah rekening ${acc.currency}; transaksi ini hanya untuk rekening Rupiah`);
      return acc;
    }
    const [acc] = await this.repo.findAccountsBySystemKey(db, tenantId, fallback);
    if (!acc) throw new BadRequestException(`Akun sistem ${fallback} tidak ditemukan`);
    return acc;
  }

  /**
   * Uang keluar dari akun kas/bank tidak boleh membuat saldonya negatif (pengaturan Kontrol kas "Tolak saldo negatif", bawaan aktif).
   * Kas Keluar punya pemeriksaan sendiri; pembelian aset, bayar pemasok, setoran pajak, uang muka pemasok, dan gaji memakai yang ini.
   */
  async assertCashCovers(tx: Tx, tenantId: string, cash: { id: string; name?: string | null }, amount: DecValue) {
    const [t] = (await this.repo.queryTenant(tx, tenantId)).rows;
    if (t?.block === false) return;
    await this.repo.queryAssertCashCovers(tx, cash.id); // serialkan per akun kas (lihat CashService.create)
    const [b] = (await this.repo.queryJournalLine(tx, cash.id)).rows;
    if (D(b.bal).minus(D(amount)).lt(0)) {
      throw new BadRequestException(`Saldo ${cash.name ?? 'akun kas'} tidak cukup (Rp${D(b.bal).toNumber().toLocaleString('id-ID')}); pengeluaran ini akan membuat saldo negatif`);
    }
  }

  /**
   * Akun valas wajib membawa jumlah valasnya di setiap baris (tanpa itu saldo valas rusak), akun Rupiah dilarang memilikinya.
   * Alur yang belum mengenal valas otomatis tertolak di sini dengan pesan jelas, bukan menulis saldo valas yang salah.
   */
  private assertForeignAmount(acc: { code: string; name: string; currency: string }, l: PostLine) {
    const has = l.foreignAmount != null && !D(l.foreignAmount).isZero();
    const nonZero = !D(l.debit).isZero() || !D(l.credit).isZero();
    if (!nonZero) return;
    if (acc.currency !== 'IDR' && !has) throw new BadRequestException(`${acc.name} (${acc.code}) bermata uang ${acc.currency}: transaksi ke akun ini harus menyertakan jumlah ${acc.currency}`);
    if (acc.currency === 'IDR' && has) throw new BadRequestException(`${acc.name} (${acc.code}) berupa rekening Rupiah; jumlah valas tidak boleh diisi`);
  }

  private async resolveAccounts(tx: Tx, tenantId: string, lines: PostLine[]): Promise<string[]> {
    return (await this.resolveAccountRows(tx, tenantId, lines)).map((a) => a.id);
  }

  private async resolveAccountRows(tx: Tx, tenantId: string, lines: PostLine[]) {
    const keys = [...new Set(lines.filter((l) => l.key).map((l) => l.key!))];
    const ids = [...new Set(lines.filter((l) => l.accountId).map((l) => l.accountId!))];
    if (keys.length) await this.ensureSystemAccounts(tx, tenantId, keys);

    const conds = [];
    if (keys.length) conds.push(inArray(accounts.systemKey, keys));
    if (ids.length) conds.push(inArray(accounts.id, ids));
    if (!conds.length) throw new BadRequestException('Jurnal tanpa akun');

    const found = await this.repo.listAccounts(tx, tenantId, conds);
    const byKey = new Map(found.filter((a) => a.systemKey).map((a) => [a.systemKey!, a]));
    const byId = new Map(found.map((a) => [a.id, a]));

    return lines.map((l) => {
      const acc = l.key ? byKey.get(l.key) : byId.get(l.accountId!);
      if (!acc) throw new BadRequestException(`Akun ${l.key ?? l.accountId} tidak ditemukan`);
      if (!acc.isPostable) throw new BadRequestException(`Akun ${acc.code} adalah akun induk dan tidak bisa diposting`);
      return acc;
    });
  }

  /**
   * Perusahaan lama mungkin belum punya akun sistem yang ditambahkan di versi baru
   * (mis. Retur Penjualan). Buat otomatis dari bagan akun standar saat pertama dibutuhkan.
   */
  async ensureSystemAccounts(tx: DbOrTx, tenantId: string, keys: SystemKey[]) {
    const existing = await this.repo.listAccountsBySystemKey(tx, tenantId, keys);
    const have = new Set(existing.map((e) => e.systemKey));
    for (const key of keys.filter((k) => !have.has(k))) {
      const row = DEFAULT_COA.find((r) => r.key === key);
      if (!row) continue;
      const [parent] = row.parent
        ? await this.repo.listAccountsByCode(tx, tenantId, row.parent)
        : [];
      const [sameCode] = await this.repo.findAccountsByCode(tx, tenantId, row.code);
      // Akun dengan kode sama yang belum bertanda sistem (mis. 6-1000 Beban Gaji lama) dipakai langsung
      if (sameCode && !sameCode.systemKey && sameCode.type === row.type && sameCode.isPostable) {
        await patchById(tx, accounts, sameCode.id, { systemKey: key });
        continue;
      }
      await this.repo.insertAccounts(tx, tenantId, sameCode, row.code, row.name, row.type, parent, key, row.cash);
    }
  }
}
