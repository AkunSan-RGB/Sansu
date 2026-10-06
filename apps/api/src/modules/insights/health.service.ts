/**
 * Cek kesehatan pembukuan: pemeriksaan otomatis yang biasanya dilakukan akuntan sebelum
 * laporan ditandatangani, ditambah rasio keuangan dengan penjelasan bahasa awam.
 */
import { Injectable } from '@nestjs/common';
import { REPORT_GROUPS } from '@sansu/shared';
import { sql } from 'drizzle-orm';
import { PeriodService } from '../../common/period/period.service';
import { addDays, diffDays, toDocDate, todayJakarta } from '../../common/utils/dates';
import { D, Dec, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { get, loadAccounts, natural, sumByAccount } from '../accounting/ledger-data';
import { StatementsService } from '../accounting/statements.service';
import { AssetsService } from '../assets/assets.module';
import { ThresholdsService } from './thresholds.service';

type Status = 'OK' | 'WARN' | 'ERROR' | 'INFO';
export interface Check {
  key: string;
  category: 'Integritas' | 'Rekonsiliasi' | 'Kelengkapan' | 'Kewajaran' | 'Kepatuhan';
  title: string;
  status: Status;
  message: string;
  detail?: { label: string; value: string }[];
  link?: string;
}

const rp = (d: Dec) => `Rp${d.toNumber().toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;

@Injectable()
export class HealthService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly statements: StatementsService,
    private readonly assets: AssetsService,
    private readonly period: PeriodService,
    private readonly thresholds: ThresholdsService,
  ) {}

  async run(tenantId: string, asOfInput?: string) {
    const asOf = toDocDate(asOfInput);
    const yearStart = `${asOf.slice(0, 4)}-01-01`;
    const accs = await loadAccounts(this.db, tenantId);
    const bal = await sumByAccount(this.db, tenantId, { to: asOf });
    const sys = (k: string) => accs.find((a) => a.systemKey === k);
    const bySys = (k: string) => {
      const a = sys(k);
      return a ? natural(a.type, get(bal, a.id)) : ZERO;
    };
    const groupTotal = (groups: string[]) =>
      accs
        .filter((a) => groups.includes(a.reportGroup))
        .reduce<Dec>((s, a) => s.plus(natural(a.type, get(bal, a.id))), ZERO);
    const checks: Check[] = [];
    const q = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
      this.db.execute<T>(query).then((r) => r.rows);

    // 1. Neraca saldo seimbang
    const totD = [...bal.values()].reduce<Dec>((s, x) => s.plus(x.debit), ZERO);
    const totC = [...bal.values()].reduce<Dec>((s, x) => s.plus(x.credit), ZERO);
    checks.push({
      key: 'trial-balance',
      category: 'Integritas',
      title: 'Neraca saldo seimbang',
      status: totD.eq(totC) ? 'OK' : 'ERROR',
      message: totD.eq(totC)
        ? `Total debit = total kredit (${rp(totD)})`
        : `Selisih ${rp(totD.minus(totC))} — hubungi dukungan`,
      link: '/trial-balance',
    });

    // 2. Persamaan akuntansi
    const fp = await this.statements.financialPosition(tenantId, asOf);
    checks.push({
      key: 'equation',
      category: 'Integritas',
      title: 'Aset = Liabilitas + Ekuitas',
      status: fp.balanced ? 'OK' : 'ERROR',
      message: fp.balanced
        ? `Aset ${rp(D(fp.totals.assets.amount))} seimbang`
        : 'Laporan posisi keuangan tidak seimbang',
      link: '/reports?tab=position',
    });

    // 3. Piutang: buku besar vs buku pembantu faktur
    const [arSub] = await q<{ v: string }>(sql`
      SELECT COALESCE(SUM(total - paid_amount - returned_amount), 0) AS v FROM invoices WHERE tenant_id = ${tenantId} AND date <= ${asOf}`);
    const arGl = bySys('AR');
    checks.push(
      this.reconCheck(
        'ar',
        'Piutang usaha: buku besar = rincian faktur',
        arGl,
        D(arSub.v),
        '/invoices',
        'Kemungkinan ada jurnal manual langsung ke akun piutang, atau pembayaran tanggal setelah laporan.',
      ),
    );

    // 3b. Uang muka pelanggan: buku besar = DPP uang muka yang belum dipakai
    const [dep] = await q<{ v: string; n: number }>(sql`
      SELECT COALESCE(SUM(d.dpp - COALESCE((SELECT SUM(a.dpp) FROM deposit_applications a WHERE a.deposit_id = d.id AND a.date <= ${asOf}), 0)), 0) AS v,
             COUNT(*)::int AS n
      FROM customer_deposits d WHERE d.tenant_id = ${tenantId} AND d.date <= ${asOf}`);
    const depGl = bySys('CUSTOMER_DEPOSIT');
    if (dep.n || !depGl.isZero()) {
      checks.push(
        this.reconCheck(
          'customer-deposits',
          'Uang muka pelanggan: buku besar = rincian uang muka',
          depGl,
          D(dep.v),
          '/customer-deposits',
          'Ada jurnal manual ke akun Uang Muka Pelanggan. Catat DP lewat menu Uang muka pelanggan agar bisa dipakai melunasi faktur.',
        ),
      );
    }

    // 3b'. Proyek berjalan: kemajuan pekerjaan dicatat tiap akhir bulan (pengakuan pendapatan SAK EP Bab 23)
    if (asOf >= todayJakarta()) {
      const stale = await q<{ code: string; name: string; last: string | null }>(sql`
        SELECT p.code, p.name, (SELECT MAX(g.date)::text FROM project_progress g WHERE g.project_id = p.id) AS last
        FROM projects p
        WHERE p.tenant_id = ${tenantId} AND p.status = 'ACTIVE' AND p.contract_value > 0
          AND COALESCE(p.start_date, p.created_at::date) <= ${addDays(asOf, -30)}
          AND COALESCE((SELECT MAX(g.date) FROM project_progress g WHERE g.project_id = p.id), '1900-01-01') < ${addDays(asOf, -35)}`);
      if (stale.length) {
        checks.push({
          key: 'project-progress',
          category: 'Kelengkapan',
          title: 'Kemajuan proyek belum diperbarui',
          status: 'WARN',
          message: `${stale.length} proyek berjalan belum dicatat kemajuan pekerjaannya lebih dari sebulan. Catat % selesai di halaman proyek agar pendapatan yang sudah dikerjakan tetapi belum ditagih ikut terakui.`,
          detail: stale.map((p) => ({ label: `${p.code} ${p.name}`, value: p.last ? `terakhir ${p.last}` : 'belum pernah' })),
          link: '/projects',
        });
      }
    }

    // 3c. Bukti potong PPh dari pelanggan (syarat kredit pajak PPh 23)
    const [slip] = await q<{ n: number; v: string }>(sql`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(withholding_amount), 0) AS v FROM invoices
      WHERE tenant_id = ${tenantId} AND withholding_type = 'PPH23' AND withholding_amount > 0 AND withholding_slip_no IS NULL
        AND date <= ${addDays(asOf, -45)}`);
    if (slip.n) {
      checks.push({
        key: 'withholding-slips',
        category: 'Kepatuhan',
        title: 'Bukti potong PPh 23 dari pelanggan',
        status: 'WARN',
        message: `${slip.n} faktur jasa (PPh 23 Rp${D(slip.v).toFixed(0)}) belum dicatat nomor bukti potongnya lebih dari 45 hari. Tanpa bukti potong, PPh 23 tidak bisa dikreditkan di SPT Tahunan — minta ke pelanggan.`,
        link: '/tax/withheld',
      });
    }

    // 4. Utang usaha
    const [ap] = await q<{ v: string }>(sql`
      SELECT COALESCE(SUM(total - paid_amount - returned_amount), 0) AS v FROM purchase_invoices WHERE tenant_id = ${tenantId} AND date <= ${asOf}`);
    checks.push(
      this.reconCheck(
        'ap',
        'Utang usaha: buku besar = rincian faktur supplier',
        bySys('AP'),
        D(ap.v),
        '/purchase-invoices',
        'Periksa jurnal manual ke akun utang usaha.',
      ),
    );

    // 5. Persediaan: buku besar vs kartu stok (hanya bila per hari ini)
    if (asOf >= todayJakarta()) {
      const [inv] = await q<{ v: string }>(
        sql`SELECT COALESCE(SUM(qty * avg_cost), 0) AS v FROM stock_balances WHERE tenant_id = ${tenantId}`,
      );
      checks.push(
        this.reconCheck(
          'inventory',
          'Persediaan: buku besar = nilai kartu stok',
          bySys('INVENTORY'),
          D(inv.v),
          '/inventory',
          'Selisih kecil wajar karena pembulatan HPP; selisih besar berarti ada jurnal manual ke akun persediaan.',
          D(1000),
        ),
      );
    }

    // 5a. Indikasi penurunan nilai persediaan (SAK EP 13): harga jual di bawah biaya rata-rata
    if (asOf >= todayJakarta()) {
      const [nrv] = await q<{ n: number; v: string }>(sql`
        SELECT COUNT(*)::int AS n, COALESCE(SUM(b.qty * (b.avg_cost - p.sell_price)), 0) AS v
        FROM stock_balances b JOIN products p ON p.id = b.product_id
        WHERE b.tenant_id = ${tenantId} AND b.qty > 0 AND p.sell_price > 0 AND p.sell_price < b.avg_cost`);
      if (nrv.n) {
        checks.push({
          key: 'inventory-nrv',
          category: 'Kewajaran',
          title: 'Persediaan: harga jual di bawah harga pokok',
          status: 'WARN',
          message: `${nrv.n} barang dijual lebih murah dari biaya rata-ratanya (taksiran rugi ${D(nrv.v).toFixed(0)}). Bila harga itu memang wajar, turunkan nilainya di Inventori › Penurunan nilai.`,
          link: '/inventory/writedowns',
        });
      }
    }

    // 5a'. Barang dalam proses produksi: buku besar = bahan pada perintah produksi yang sedang berjalan
    const [wip] = await q<{ v: string; n: number }>(sql`
      SELECT COALESCE(SUM(material_cost), 0) AS v, COUNT(*)::int AS n FROM production_orders
      WHERE tenant_id = ${tenantId} AND started_date <= ${asOf}
        AND (status = 'IN_PROGRESS' OR (status = 'COMPLETED' AND completed_date > ${asOf}) OR (status = 'CANCELLED' AND cancelled_date > ${asOf}))`);
    const wipGl = bySys('WIP');
    if (wip.n || !wipGl.isZero()) {
      checks.push(
        this.reconCheck(
          'wip',
          'Barang dalam proses: buku besar = produksi berjalan',
          wipGl,
          D(wip.v),
          '/production/orders',
          'Ada jurnal manual ke akun Barang dalam Proses Produksi. Catat produksi lewat menu Produksi.',
        ),
      );
    }

    // 5b. Barang dalam perjalanan antar gudang
    const [tr] = await q<{ v: string; n: number }>(sql`
      SELECT COALESCE(SUM(total_value), 0) AS v, COUNT(*)::int AS n FROM stock_transfers WHERE tenant_id = ${tenantId} AND date <= ${asOf} AND (received_date IS NULL OR received_date > ${asOf})`);
    const trGl = bySys('INVENTORY_TRANSIT');
    if (tr.n || !trGl.isZero()) {
      checks.push(
        this.reconCheck(
          'transit',
          'Barang dalam perjalanan: buku besar = kiriman belum diterima',
          trGl,
          D(tr.v),
          '/inventory/transfers',
          'Ada jurnal manual ke akun Persediaan dalam Perjalanan, atau kiriman diterima setelah tanggal laporan.',
        ),
      );
    }

    // 5c. Opname kas rutin (kas fisik, bukan rekening bank)
    if (asOf >= todayJakarta()) {
      const kas = await q<{ name: string; last: string | null; active: boolean }>(sql`
        SELECT a.name, (SELECT MAX(c.date)::text FROM cash_counts c WHERE c.account_id = a.id AND c.status = 'POSTED') AS last,
               EXISTS (SELECT 1 FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
                       WHERE l.account_id = a.id AND j.date > ${addDays(asOf, -90)}) AS active
        FROM accounts a
        WHERE a.tenant_id = ${tenantId} AND a.is_cash_account AND a.is_postable AND a.is_active AND COALESCE(a.system_key, '') <> 'BANK'
          AND a.name !~* '(bank|rekening|giro|tabungan|deposito|qris|wallet|virtual)'
          AND NOT EXISTS (SELECT 1 FROM bank_statements b WHERE b.cash_account_id = a.id)`);
      const due = kas.filter((k) => k.active && (!k.last || diffDays(k.last, asOf) > 35));
      if (kas.some((k) => k.active)) {
        checks.push({
          key: 'cash-count',
          category: 'Kelengkapan',
          title: 'Opname kas bulanan',
          status: due.length ? 'WARN' : 'OK',
          message: due.length
            ? `${due.map((k) => k.name).join(', ')} belum diopname lebih dari sebulan. Hitung fisik uang di Kas & Bank › Opname kas.`
            : 'Semua kas sudah diopname dalam sebulan terakhir',
          detail: kas.filter((k) => k.active).map((k) => ({ label: k.name, value: k.last ? `opname terakhir ${k.last}` : 'belum pernah' })),
          link: '/cash/counts',
        });
      }
    }

    // 6. Aset tetap: buku besar vs daftar aset
    const reg = await this.assets.registerTotals(tenantId, asOf);
    const faGl = groupTotal(['FIXED_ASSET', 'INTANGIBLE_ASSET']);
    const accGl = groupTotal(['ACCUMULATED_DEPRECIATION', 'ACCUMULATED_AMORTIZATION']).negated();
    if (reg.count || !faGl.isZero()) {
      checks.push(
        this.reconCheck(
          'fixed-assets',
          'Aset tetap: buku besar = daftar aset',
          faGl,
          reg.cost,
          '/fixed-assets',
          'Aset yang dibeli lewat kas keluar/jurnal manual belum didaftarkan di menu Aset Tetap (pilih "aset lama" agar tidak dijurnal dua kali).',
        ),
      );
      checks.push(
        this.reconCheck(
          'accumulated',
          'Akumulasi penyusutan: buku besar = daftar aset',
          accGl,
          reg.accumulated,
          '/fixed-assets',
          'Penyusutan dicatat manual atau saldo awal akumulasi belum diisi di daftar aset.',
        ),
      );
    }

    // 7. Penyusutan bulan lalu sudah diproses
    const lastMonth = addDays(`${asOf.slice(0, 7)}-01`, -1).slice(0, 7);
    if (reg.count) {
      const [dep] = await q<{ n: number }>(
        sql`SELECT COUNT(*)::int AS n FROM asset_depreciations WHERE tenant_id = ${tenantId} AND period = ${lastMonth}`,
      );
      const due = reg.pendingPeriods > 0 && dep.n === 0;
      checks.push({
        key: 'depreciation',
        category: 'Kelengkapan',
        title: `Penyusutan ${lastMonth} sudah diproses`,
        status: due ? 'WARN' : 'OK',
        message: due
          ? 'Ada aset aktif yang belum disusutkan. Jalankan penyusutan agar laba tidak terlalu tinggi.'
          : 'Penyusutan sudah mutakhir',
        link: '/fixed-assets',
      });
    }

    // 8. Saldo kas / bank negatif
    const negCash = accs.filter(
      (a) => a.reportGroup === 'CASH_EQUIVALENT' && natural(a.type, get(bal, a.id)).isNegative(),
    );
    checks.push({
      key: 'cash-negative',
      category: 'Kewajaran',
      title: 'Tidak ada saldo kas / bank minus',
      status: negCash.length ? 'ERROR' : 'OK',
      message: negCash.length
        ? 'Uang fisik tidak mungkin minus: ada penerimaan yang belum dicatat atau pengeluaran tercatat ganda.'
        : 'Semua saldo kas & bank wajar',
      detail: negCash.map((a) => ({ label: `${a.code} ${a.name}`, value: rp(natural(a.type, get(bal, a.id))) })),
      link: '/cash',
    });

    // 9. Akun bersaldo tidak normal
    const ALLOW = [
      'PREPAID_TAX',
      'TAX_PAYABLE',
      'OTHER_EQUITY',
      'RETAINED_EARNINGS',
      'DEFERRED_TAX_ASSET',
      'DEFERRED_TAX_LIABILITY',
    ];
    const abnormal = accs.filter((a) => {
      if (
        !a.isPostable ||
        ['REVENUE', 'EXPENSE'].includes(a.type) ||
        ALLOW.includes(a.reportGroup) ||
        a.reportGroup === 'CASH_EQUIVALENT'
      )
        return false;
      const n = natural(a.type, get(bal, a.id));
      const contra = (REPORT_GROUPS[a.reportGroup] as { contra?: boolean }).contra === true;
      return contra ? n.gt(0) : n.lt(-1);
    });
    checks.push({
      key: 'abnormal',
      category: 'Kewajaran',
      title: 'Saldo akun sesuai saldo normalnya',
      status: abnormal.length ? 'WARN' : 'OK',
      message: abnormal.length
        ? 'Akun berikut bersaldo terbalik (mis. piutang bersaldo kredit = pelanggan bayar lebih / salah posting).'
        : 'Tidak ada saldo terbalik',
      detail: abnormal
        .slice(0, 10)
        .map((a) => ({ label: `${a.code} ${a.name}`, value: rp(natural(a.type, get(bal, a.id))) })),
      link: '/ledger',
    });

    // 10. Jurnal manual tanpa nomor bukti
    const [noRef] = await q<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM journal_entries
      WHERE tenant_id = ${tenantId} AND source_type IN ('MANUAL', 'ADJUSTMENT') AND reversal_of_id IS NULL
        AND (reference IS NULL OR reference = '') AND date BETWEEN ${yearStart} AND ${asOf}`);
    checks.push({
      key: 'no-reference',
      category: 'Kepatuhan',
      title: 'Jurnal manual memiliki nomor bukti',
      status: noRef.n ? 'WARN' : 'OK',
      message: noRef.n
        ? `${noRef.n} jurnal manual tahun ini tanpa nomor bukti. Auditor & pemeriksa pajak meminta bukti untuk setiap jurnal.`
        : 'Semua jurnal manual berbukti',
      link: '/journals',
    });

    // 11. Jurnal bertanggal di masa depan
    const [future] = await q<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM journal_entries WHERE tenant_id = ${tenantId} AND date > ${todayJakarta()}`,
    );
    checks.push({
      key: 'future',
      category: 'Kewajaran',
      title: 'Tidak ada transaksi bertanggal di masa depan',
      status: future.n ? 'WARN' : 'OK',
      message: future.n
        ? `${future.n} jurnal bertanggal setelah hari ini — kemungkinan salah ketik tahun.`
        : 'Tanggal transaksi wajar',
      link: '/journals',
    });

    // 11b. Rekonsiliasi bank: mutasi rekening koran yang belum dicocokkan / belum pernah diimpor
    const bankRows = await q<{
      code: string;
      name: string;
      last_date: string | null;
      unmatched: number;
      book_n: number;
    }>(sql`
      SELECT a.code, a.name, MAX(l.date)::text AS last_date,
             COUNT(l.id) FILTER (WHERE l.status = 'UNMATCHED' AND l.date <= ${asOf})::int AS unmatched,
             (SELECT COUNT(*)::int FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id
               WHERE jl.account_id = a.id AND je.date <= ${asOf}) AS book_n
      FROM accounts a
      LEFT JOIN bank_statements s ON s.cash_account_id = a.id
      LEFT JOIN bank_statement_lines l ON l.statement_id = s.id
      WHERE a.tenant_id = ${tenantId} AND a.is_cash_account = true AND a.is_postable = true AND a.system_key IS DISTINCT FROM 'CASH'
        AND a.name NOT ILIKE '%kas kecil%'
      GROUP BY a.id ORDER BY a.code`);
    const banks = bankRows.filter((b) => b.book_n > 0);
    if (banks.length) {
      const unmatched = banks.reduce((n, b) => n + b.unmatched, 0);
      const stale = banks.filter((b) => !b.last_date || diffDays(b.last_date, asOf) > 40);
      checks.push({
        key: 'bank-recon',
        category: 'Rekonsiliasi',
        title: 'Rekening bank direkonsiliasi dengan rekening koran',
        status: unmatched ? 'WARN' : stale.length ? 'WARN' : 'OK',
        message: unmatched
          ? `${unmatched} mutasi bank belum cocok dengan transaksi di buku.`
          : stale.length
            ? `Mutasi rekening ${stale.map((b) => b.name).join(', ')} belum diimpor ${stale.some((b) => b.last_date) ? 'lebih dari 40 hari' : 'sama sekali'}.`
            : 'Semua mutasi bank sudah cocok dengan buku',
        detail: banks.map((b) => ({
          label: `${b.code} ${b.name}`,
          value: b.last_date ? `mutasi s/d ${b.last_date}, ${b.unmatched} belum cocok` : 'belum pernah diimpor',
        })),
        link: '/bank',
      });
    }

    // 11c. Setoran pajak masa lalu yang terlewat (PPh 21 / PPN)
    const prevPeriod = addDays(`${asOf.slice(0, 7)}-01`, -1).slice(0, 7);
    const prevPrev = addDays(`${prevPeriod}-01`, -1).slice(0, 7);
    const missedTax: string[] = [];
    for (const [type, key, period, label] of [
      ['PPH21', 'PPH21_PAYABLE', prevPeriod, 'PPh 21'],
      ['PPN', 'VAT_OUT', prevPrev, 'PPN'],
    ] as const) {
      const due =
        type === 'PPN'
          ? addDays(`${addDays(`${period}-28`, 10).slice(0, 7)}-01`, 30)
          : `${addDays(`${period}-28`, 10).slice(0, 7)}-15`;
      if (asOf <= due) continue;
      const [acc] = await q<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
        WHERE j.tenant_id = ${tenantId} AND a.system_key = ${key} AND l.credit > 0 AND j.source_type <> 'TAX_PAYMENT'
          AND j.date BETWEEN ${`${period}-01`} AND ${addDays(`${addDays(`${period}-28`, 10).slice(0, 7)}-01`, -1)}`);
      const [paid] = await q<{ n: number }>(
        sql`SELECT COUNT(*)::int AS n FROM tax_payments WHERE tenant_id = ${tenantId} AND type = ${type} AND period = ${period}`,
      );
      if (acc.n && !paid.n) missedTax.push(`${label} masa ${period}`);
    }
    checks.push({
      key: 'tax-payments',
      category: 'Kepatuhan',
      title: 'Setoran pajak tepat waktu',
      status: missedTax.length ? 'WARN' : 'OK',
      message: missedTax.length
        ? `Belum ada catatan setoran: ${missedTax.join(', ')}. Lewat jatuh tempo bisa kena sanksi bunga.`
        : 'Setoran PPh 21 & PPN masa sebelumnya sudah dicatat',
      link: '/tax',
    });

    // Ambang pajak: batas PKP / PPh final Rp4,8 miliar, fasilitas Pasal 31E, kriteria UMKM
    for (const a of (await this.thresholds.evaluate(tenantId, asOf)).alerts) {
      checks.push({ key: `threshold-${a.key}`, category: 'Kepatuhan', title: a.title, status: a.level, message: a.message, link: a.link });
    }

    // 12. Kunci periode
    const locked = await this.period.lockedUntil(this.db, tenantId);
    const prevMonthEnd = addDays(`${todayJakarta().slice(0, 7)}-01`, -1);
    const lockLate = (!locked || locked < prevMonthEnd) && diffDays(prevMonthEnd, todayJakarta()) > 15;
    checks.push({
      key: 'lock',
      category: 'Kepatuhan',
      title: 'Periode bulan lalu sudah dikunci',
      status: lockLate ? 'WARN' : 'OK',
      message: lockLate
        ? `Periode s/d ${prevMonthEnd} belum dikunci. Laporan yang sudah dilaporkan bisa berubah bila transaksi lama diedit.`
        : locked
          ? `Terkunci s/d ${locked}`
          : 'Belum perlu dikunci',
      link: '/closing',
    });

    // 13. Tutup buku tahun lalu
    const lastYear = Number(asOf.slice(0, 4)) - 1;
    const [closed] = await q<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM journal_entries WHERE tenant_id = ${tenantId} AND source_type = 'CLOSING' AND source_id = ${String(lastYear)}`,
    );
    // Jurnal saldo awal (mulai memakai SANSU) tidak perlu ditutup
    const [hadTx] = await q<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM journal_entries j
      WHERE j.tenant_id = ${tenantId} AND j.date BETWEEN ${`${lastYear}-01-01`} AND ${`${lastYear}-12-31`} AND j.source_type <> 'OPENING'
        AND NOT EXISTS (SELECT 1 FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.journal_id = j.id AND a.system_key = 'OPENING_EQUITY')`);
    if (hadTx.n) {
      checks.push({
        key: 'close-year',
        category: 'Kelengkapan',
        title: `Tutup buku ${lastYear}`,
        status: closed.n ? 'OK' : 'WARN',
        message: closed.n
          ? 'Sudah ditutup ke saldo laba'
          : `Tahun ${lastYear} memiliki transaksi tetapi belum ditutup.`,
        link: '/closing',
      });
    }

    // 14. Piutang macet > 90 hari
    const [overdue] = await q<{ v: string; n: number }>(sql`
      SELECT COALESCE(SUM(total - paid_amount - returned_amount), 0) AS v, COUNT(*)::int AS n FROM invoices
      WHERE tenant_id = ${tenantId} AND status <> 'PAID' AND due_date < ${addDays(asOf, -90)}`);
    const allowance = groupTotal(['ALLOWANCE_RECEIVABLE']).negated();
    checks.push({
      key: 'bad-debt',
      category: 'Kewajaran',
      title: 'Piutang lewat 90 hari sudah dicadangkan',
      status: D(overdue.v).gt(0) && allowance.lt(D(overdue.v)) ? 'WARN' : 'OK',
      message: D(overdue.v).gt(0)
        ? `${overdue.n} faktur senilai ${rp(D(overdue.v))} lewat 90 hari; cadangan kerugian saat ini ${rp(allowance)}. SAK EP mensyaratkan penurunan nilai bila ada bukti objektif.`
        : 'Tidak ada piutang lewat 90 hari',
      link: '/invoices',
    });

    // 15. Defisiensi modal
    const equity = D(fp.totals.equity.amount);
    checks.push({
      key: 'equity',
      category: 'Kewajaran',
      title: 'Ekuitas positif',
      status: equity.isNegative() ? 'ERROR' : 'OK',
      message: equity.isNegative()
        ? `Ekuitas negatif ${rp(equity)}: kewajiban melebihi aset (defisiensi modal).`
        : `Ekuitas ${rp(equity)}`,
    });

    // 16. Arus kas terekonsiliasi
    const cf = await this.statements.cashFlow(tenantId, { from: yearStart, to: asOf });
    checks.push({
      key: 'cash-flow',
      category: 'Integritas',
      title: 'Laporan arus kas cocok dengan saldo kas',
      status: D(cf.current.difference).isZero() ? 'OK' : 'ERROR',
      message: D(cf.current.difference).isZero()
        ? 'Kenaikan kas di laporan = perubahan saldo kas & bank'
        : `Selisih ${rp(D(cf.current.difference))}`,
      link: '/reports?tab=position',
    });

    // ---------- Rasio ----------
    const income = await this.statements.income(tenantId, { from: yearStart, to: asOf }, 'SAK_EP');
    const L = (k: string) => D(income.lines.find((l) => l.key === k)?.amount ?? 0);
    const sec = (k: string) => D(fp.sections.find((s) => s.key === k)?.total ?? 0);
    const grp = (k: string) =>
      fp.sections
        .flatMap((s) => s.lines)
        .filter((l) => l.key === k)
        .reduce<Dec>((s, l) => s.plus(l.amount), ZERO);
    const days = Math.max(1, diffDays(yearStart, asOf) + 1);
    const ca = sec('CURRENT_ASSET');
    const cl = sec('CURRENT_LIABILITY');
    const liab = D(fp.totals.liabilities.amount);
    const assets = D(fp.totals.assets.amount);
    const revenue = L('NET_REVENUE');
    const cogs = L('COST_OF_SALES').abs();
    const net = L('NET_PROFIT');
    const div = (a: Dec, b: Dec) => (b.isZero() ? null : a.div(b).toNumber());
    const ratio = (
      key: string,
      group: string,
      label: string,
      value: number | null,
      unit: 'x' | '%' | 'hari',
      good: (v: number) => Status,
      explain: (v: number) => string,
    ) => ({
      key,
      group,
      label,
      value:
        value == null
          ? null
          : unit === '%'
            ? Math.round(value * 1000) / 10
            : unit === 'hari'
              ? Math.round(value)
              : Math.round(value * 100) / 100,
      unit,
      status: value == null ? 'INFO' : good(unit === '%' ? value * 100 : value),
      explanation: value == null ? 'Belum ada data untuk dihitung.' : explain(unit === '%' ? value * 100 : value),
    });
    const fmtx = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: 2 });
    const annual = 365 / days;
    const inventory = grp('INVENTORY');
    const ar = grp('TRADE_RECEIVABLE').plus(grp('ALLOWANCE_RECEIVABLE'));
    const apBal = grp('TRADE_PAYABLE');
    const ratios = [
      ratio(
        'current',
        'Likuiditas',
        'Rasio lancar',
        div(ca, cl),
        'x',
        (v) => (v >= 1.5 ? 'OK' : v >= 1 ? 'WARN' : 'ERROR'),
        (v) => `Setiap Rp1 utang jangka pendek dijamin Rp${fmtx(v)} aset lancar. Ideal di atas 1,5.`,
      ),
      ratio(
        'quick',
        'Likuiditas',
        'Rasio cepat',
        div(ca.minus(inventory).minus(grp('PREPAID')), cl),
        'x',
        (v) => (v >= 1 ? 'OK' : v >= 0.5 ? 'WARN' : 'ERROR'),
        (v) => `Tanpa menjual stok, tersedia Rp${fmtx(v)} untuk tiap Rp1 utang jangka pendek.`,
      ),
      ratio(
        'cash',
        'Likuiditas',
        'Rasio kas',
        div(grp('CASH_EQUIVALENT'), cl),
        'x',
        (v) => (v >= 0.3 ? 'OK' : v >= 0.1 ? 'WARN' : 'ERROR'),
        (v) => `Uang tunai & bank cukup membayar ${fmtx(v * 100)}% utang jangka pendek hari ini.`,
      ),
      ratio(
        'der',
        'Solvabilitas',
        'Utang terhadap ekuitas (DER)',
        div(liab, equity),
        'x',
        (v) => (v < 0 ? 'ERROR' : v <= 1 ? 'OK' : v <= 2 ? 'WARN' : 'ERROR'),
        (v) =>
          `Usaha dibiayai Rp${fmtx(v)} utang untuk setiap Rp1 modal sendiri.${v > 2 ? ' Ketergantungan pada utang tinggi.' : ''}`,
      ),
      ratio(
        'debt',
        'Solvabilitas',
        'Utang terhadap aset',
        div(liab, assets),
        '%',
        (v) => (v <= 50 ? 'OK' : v <= 70 ? 'WARN' : 'ERROR'),
        (v) => `${fmtx(v)}% aset dibiayai oleh utang.`,
      ),
      ratio(
        'gpm',
        'Profitabilitas',
        'Margin laba kotor',
        div(L('GROSS_PROFIT'), revenue),
        '%',
        (v) => (v >= 10 ? 'OK' : v >= 5 ? 'WARN' : 'ERROR'),
        (v) =>
          `Dari setiap Rp100 penjualan, tersisa Rp${fmtx(v)} setelah harga pokok barang. Distributor umumnya 8–20%.`,
      ),
      ratio(
        'npm',
        'Profitabilitas',
        'Margin laba bersih',
        div(net, revenue),
        '%',
        (v) => (v >= 3 ? 'OK' : v >= 0 ? 'WARN' : 'ERROR'),
        (v) => (v < 0 ? 'Usaha masih rugi pada periode ini.' : `Laba bersih Rp${fmtx(v)} dari setiap Rp100 penjualan.`),
      ),
      ratio(
        'roa',
        'Profitabilitas',
        'Imbal hasil aset (ROA, disetahunkan)',
        div(net.times(annual), assets),
        '%',
        (v) => (v >= 5 ? 'OK' : v >= 0 ? 'WARN' : 'ERROR'),
        (v) => `Setiap Rp100 aset menghasilkan laba Rp${fmtx(v)} per tahun.`,
      ),
      ratio(
        'roe',
        'Profitabilitas',
        'Imbal hasil ekuitas (ROE, disetahunkan)',
        equity.gt(0) ? div(net.times(annual), equity) : null,
        '%',
        (v) => (v >= 10 ? 'OK' : v >= 0 ? 'WARN' : 'ERROR'),
        (v) => `Modal pemilik menghasilkan ${fmtx(v)}% per tahun — bandingkan dengan bunga deposito.`,
      ),
      ratio(
        'dso',
        'Aktivitas',
        'Lama penagihan piutang (DSO)',
        revenue.gt(0) ? ar.div(revenue).times(days).toNumber() : null,
        'hari',
        (v) => (v <= 45 ? 'OK' : v <= 75 ? 'WARN' : 'ERROR'),
        (v) => `Rata-rata pelanggan membayar ${Math.round(v)} hari setelah faktur.`,
      ),
      ratio(
        'dio',
        'Aktivitas',
        'Lama stok tersimpan (DIO)',
        cogs.gt(0) ? inventory.div(cogs).times(days).toNumber() : null,
        'hari',
        (v) => (v <= 45 ? 'OK' : v <= 90 ? 'WARN' : 'ERROR'),
        (v) => `Stok saat ini cukup untuk ${Math.round(v)} hari penjualan.`,
      ),
      ratio(
        'dpo',
        'Aktivitas',
        'Lama pembayaran ke supplier (DPO)',
        cogs.gt(0) ? apBal.div(cogs).times(days).toNumber() : null,
        'hari',
        () => 'INFO',
        (v) => `Rata-rata supplier dibayar ${Math.round(v)} hari setelah faktur.`,
      ),
    ];
    const dso = ratios.find((r) => r.key === 'dso')!.value;
    const dio = ratios.find((r) => r.key === 'dio')!.value;
    const dpo = ratios.find((r) => r.key === 'dpo')!.value;
    if (dso != null && dio != null && dpo != null) {
      const ccc = dso + dio - dpo;
      ratios.push({
        key: 'ccc',
        group: 'Aktivitas',
        label: 'Siklus konversi kas',
        value: ccc,
        unit: 'hari',
        status: ccc <= 45 ? 'OK' : ccc <= 90 ? 'WARN' : 'ERROR',
        explanation: `Uang tertahan ${ccc} hari sejak membayar supplier sampai ditagih dari pelanggan. Makin pendek makin sehat.`,
      });
    }

    const errors = checks.filter((c) => c.status === 'ERROR').length;
    const warns = checks.filter((c) => c.status === 'WARN').length;
    const ratioPenalty =
      ratios.filter((r) => r.status === 'ERROR').length * 3 + ratios.filter((r) => r.status === 'WARN').length;
    const score = Math.max(0, 100 - errors * 15 - warns * 5 - ratioPenalty);
    return {
      asOf,
      score,
      grade: score >= 85 ? 'Sehat' : score >= 65 ? 'Perlu perhatian' : 'Bermasalah',
      summary: { ok: checks.filter((c) => c.status === 'OK').length, warn: warns, error: errors },
      checks,
      ratios,
    };
  }

  private reconCheck(
    key: string,
    title: string,
    gl: Dec,
    sub: Dec,
    link: string,
    hint: string,
    tolerance = D(1),
  ): Check {
    const diff = gl.minus(sub);
    const ok = diff.abs().lte(tolerance);
    return {
      key,
      category: 'Rekonsiliasi',
      title,
      status: ok ? 'OK' : 'ERROR',
      message: ok ? `Cocok (${rp(gl)})` : `Selisih ${rp(diff)}. ${hint}`,
      detail: [
        { label: 'Buku besar', value: rp(gl) },
        { label: 'Rincian / buku pembantu', value: rp(sub) },
      ],
      link,
    };
  }
}
