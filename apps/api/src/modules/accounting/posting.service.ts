import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { PeriodService } from '../../common/period/period.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { DocDate } from '../../common/utils/dates';
import { DecValue } from '../../common/utils/money';
import { DbOrTx, Tx } from '../../db/db';
import { accounts, journalEntries, journalLines } from '../../db/schema';
import { DEFAULT_COA, SystemKey } from './default-coa';
import { JournalValidationError, normalizeJournalLines } from './journal-rules';

export interface PostLine {
  /** Salah satu: id akun, atau kunci akun sistem (AR, SALES, ...) */
  accountId?: string;
  key?: SystemKey;
  debit?: DecValue;
  credit?: DecValue;
  memo?: string;
  /** Proyek (usaha jasa) — dipakai jurnal umum untuk biaya langsung proyek */
  projectId?: string | null;
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
  ) {}

  async post(tx: Tx, input: PostJournalInput) {
    await this.period.assertOpen(tx, input.tenantId, input.date);
    const accountIds = await this.resolveAccounts(tx, input.tenantId, input.lines);

    let normalized;
    try {
      normalized = normalizeJournalLines(input.lines.map((l, i) => ({ ...l, accountId: accountIds[i] })));
    } catch (e) {
      if (e instanceof JournalValidationError) throw new BadRequestException(e.message);
      throw e;
    }
    const pids = [...new Set(normalized.lines.map((l) => l.projectId).filter((x): x is string => !!x))];
    if (pids.length) {
      const found = await tx.execute(sql`SELECT id FROM projects WHERE tenant_id = ${input.tenantId} AND id IN (${sql.join(pids.map((p) => sql`${p}`), sql`, `)})`);
      if (found.rows.length !== pids.length) throw new BadRequestException('Proyek tidak ditemukan');
    }
    if (input.sourceType !== 'CASH_COUNT') await this.assertCashNotCounted(tx, input.tenantId, input.date, normalized.lines.map((l) => l.accountId));

    const number = await this.seq.next(tx, input.tenantId, 'JOURNAL', input.date);
    const [entry] = await tx
      .insert(journalEntries)
      .values({
        tenantId: input.tenantId,
        number,
        date: input.date,
        description: input.description,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        reference: input.reference,
        createdById: input.createdById,
      })
      .returning();
    const lines = await tx
      .insert(journalLines)
      .values(
        normalized.lines.map((l) => ({
          journalId: entry.id,
          accountId: l.accountId,
          debit: l.debit.toFixed(2),
          credit: l.credit.toFixed(2),
          memo: l.memo,
          projectId: l.projectId ?? null,
        })),
      )
      .returning();
    return { ...entry, lines };
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
    const [entry] = await tx
      .insert(journalEntries)
      .values({
        tenantId,
        number,
        date,
        description: `Pembalikan ${original.number}: ${original.description}`,
        sourceType: 'REVERSAL',
        sourceId: original.id,
        reversalOfId: original.id,
        createdById: userId,
      })
      .returning();
    const lines = await tx
      .insert(journalLines)
      .values(
        original.lines.map((l) => ({
          journalId: entry.id,
          accountId: l.accountId,
          debit: l.credit,
          credit: l.debit,
          memo: l.memo,
          projectId: l.projectId,
        })),
      )
      .returning();
    return { ...entry, lines };
  }

  /**
   * Kas yang sudah diopname (selesai) terkunci sampai tanggal opname: transaksi baru ke akun itu
   * harus bertanggal sesudahnya, agar hasil opname yang sudah ditandatangani tidak berubah.
   */
  async assertCashNotCounted(tx: DbOrTx, tenantId: string, date: DocDate, accountIds: string[]) {
    const ids = [...new Set(accountIds)];
    if (!ids.length) return;
    const r = await tx.execute<{ number: string; date: string; name: string }>(sql`
      SELECT c.number, c.date::text AS date, a.name FROM cash_counts c JOIN accounts a ON a.id = c.account_id
      WHERE c.tenant_id = ${tenantId} AND c.status = 'POSTED' AND c.date >= ${date}
        AND c.account_id = ANY(${`{${ids.join(',')}}`}::uuid[])
      ORDER BY c.date DESC LIMIT 1`);
    const c = r.rows[0];
    if (c) {
      const [y, m, d] = c.date.split('-');
      throw new BadRequestException(`${c.name} sudah diopname per ${d}/${m}/${y} (${c.number}). Transaksi ke akun ini harus bertanggal sesudah tanggal opname.`);
    }
  }

  /**
   * Akun kas/bank untuk penerimaan/pembayaran.
   * Jika id diberikan harus akun kas milik perusahaan; jika tidak, pakai akun sistem (Kas atau Bank).
   */
  async resolveCashAccount(db: DbOrTx, tenantId: string, accountId: string | undefined, fallback: 'CASH' | 'BANK') {
    if (accountId) {
      const [acc] = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.tenantId, tenantId)));
      if (!acc || !acc.isCashAccount || !acc.isPostable) throw new BadRequestException('Akun kas/bank tidak valid');
      return acc;
    }
    const [acc] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.systemKey, fallback)));
    if (!acc) throw new BadRequestException(`Akun sistem ${fallback} tidak ditemukan`);
    return acc;
  }

  private async resolveAccounts(tx: Tx, tenantId: string, lines: PostLine[]): Promise<string[]> {
    const keys = [...new Set(lines.filter((l) => l.key).map((l) => l.key!))];
    const ids = [...new Set(lines.filter((l) => l.accountId).map((l) => l.accountId!))];
    if (keys.length) await this.ensureSystemAccounts(tx, tenantId, keys);

    const conds = [];
    if (keys.length) conds.push(inArray(accounts.systemKey, keys));
    if (ids.length) conds.push(inArray(accounts.id, ids));
    if (!conds.length) throw new BadRequestException('Jurnal tanpa akun');

    const found = await tx
      .select({ id: accounts.id, systemKey: accounts.systemKey, isPostable: accounts.isPostable, code: accounts.code })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), or(...conds)));
    const byKey = new Map(found.filter((a) => a.systemKey).map((a) => [a.systemKey!, a]));
    const byId = new Map(found.map((a) => [a.id, a]));

    return lines.map((l) => {
      const acc = l.key ? byKey.get(l.key) : byId.get(l.accountId!);
      if (!acc) throw new BadRequestException(`Akun ${l.key ?? l.accountId} tidak ditemukan`);
      if (!acc.isPostable) throw new BadRequestException(`Akun ${acc.code} adalah akun induk dan tidak bisa diposting`);
      return acc.id;
    });
  }

  /**
   * Perusahaan lama mungkin belum punya akun sistem yang ditambahkan di versi baru
   * (mis. Retur Penjualan). Buat otomatis dari bagan akun standar saat pertama dibutuhkan.
   */
  private async ensureSystemAccounts(tx: Tx, tenantId: string, keys: SystemKey[]) {
    const existing = await tx
      .select({ systemKey: accounts.systemKey })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.systemKey, keys)));
    const have = new Set(existing.map((e) => e.systemKey));
    for (const key of keys.filter((k) => !have.has(k))) {
      const row = DEFAULT_COA.find((r) => r.key === key);
      if (!row) continue;
      const [parent] = row.parent
        ? await tx
            .select({ id: accounts.id })
            .from(accounts)
            .where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, row.parent)))
        : [];
      const [sameCode] = await tx
        .select({ id: accounts.id, systemKey: accounts.systemKey, type: accounts.type, isPostable: accounts.isPostable })
        .from(accounts)
        .where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, row.code)));
      // Akun dengan kode sama yang belum bertanda sistem (mis. 6-1000 Beban Gaji lama) dipakai langsung
      if (sameCode && !sameCode.systemKey && sameCode.type === row.type && sameCode.isPostable) {
        await tx.update(accounts).set({ systemKey: key }).where(eq(accounts.id, sameCode.id));
        continue;
      }
      await tx.insert(accounts).values({
        tenantId,
        code: sameCode ? `${row.code}-S` : row.code,
        name: row.name,
        type: row.type,
        parentId: parent?.id,
        systemKey: key,
        isCashAccount: !!row.cash,
      });
    }
  }
}
