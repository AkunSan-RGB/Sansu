import { AsyncLocalStorage } from 'node:async_hooks';
/**
 * Akses data buku besar untuk laporan: saldo / mutasi per akun dengan filter tanggal & sumber jurnal.
 * Semua angka Decimal; tanda "natural" mengikuti tipe akun (aset & beban = debit − kredit).
 */
import { DEFAULT_REPORT_GROUP, REPORT_GROUPS, type ReportGroup } from '@sansu/shared';
import { eq, sql } from 'drizzle-orm';
import { addDays, DocDate } from '../../common/utils/dates';
import { D, Dec, ZERO } from '../../common/utils/money';
import { DbOrTx } from '../../db/db';
import { AccountType, accounts } from '../../db/schema';
import { guessReportGroup } from './default-coa';

export interface AccountMeta {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  isPostable: boolean;
  systemKey: string | null;
  isCashAccount: boolean;
  reportGroup: ReportGroup;
  fiscalTreatment: string;
}

export interface Sum {
  debit: Dec;
  credit: Dec;
}

/** Jurnal penyesuaian akhir periode (untuk neraca lajur) */
export const ADJUSTING_SOURCES = ['ADJUSTMENT', 'DEPRECIATION', 'INCOME_TAX'];

export const DEBIT_NORMAL: AccountType[] = ['ASSET', 'EXPENSE'];
export const natural = (type: AccountType, s: Sum) => (DEBIT_NORMAL.includes(type) ? s.debit.minus(s.credit) : s.credit.minus(s.debit));
export const ZERO_SUM: Sum = { debit: ZERO, credit: ZERO };

export async function loadAccounts(db: DbOrTx, tenantId: string): Promise<AccountMeta[]> {
  const rows = await db.select().from(accounts).where(eq(accounts.tenantId, tenantId)).orderBy(accounts.code);
  return rows.map((a) => {
    let group = (a.reportGroup as ReportGroup | null) ?? (a.isCashAccount ? 'CASH_EQUIVALENT' : guessReportGroup(a.code, a.type));
    if (!REPORT_GROUPS[group] || REPORT_GROUPS[group].type !== a.type) group = DEFAULT_REPORT_GROUP[a.type];
    if (a.isCashAccount) group = 'CASH_EQUIVALENT';
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      parentId: a.parentId,
      isPostable: a.isPostable,
      systemKey: a.systemKey,
      isCashAccount: a.isCashAccount,
      reportGroup: group,
      fiscalTreatment: a.fiscalTreatment,
    };
  });
}

export interface SumFilter {
  from?: DocDate;
  to?: DocDate;
  excludeSources?: string[];
  onlySources?: string[];
  /**
   * Jurnal "saldo awal": sumber OPENING atau jurnal apa pun yang memakai akun Ekuitas Saldo Awal
   * (mis. stok awal dari penyesuaian persediaan). Bukan arus kas — 'exclude' membuangnya, 'only' mengambil itu saja.
   */
  openingLike?: 'exclude' | 'only';
  /**
   * Jurnal balik (REVERSAL) dihitung menurut jenis jurnal yang dibalik untuk filter sumber. Dipakai neraca lajur agar pembalikan
   * jurnal penyesuaian tetap berada di kolom penyesuaian (bukan mengotori kolom neraca saldo sebelum penyesuaian).
   */
  reversalInheritsSource?: boolean;
  /** Hanya baris jurnal cabang ini; 'NONE' = pusat / tanpa cabang */
  branchId?: string;
}

// satu sub-kueri (di-hash sekali) — jauh lebih cepat daripada EXISTS per baris jurnal pada data besar
const openingLike = (tenantId: string) => sql`(j.source_type = 'OPENING' OR j.id IN (
  SELECT ol.journal_id FROM journal_lines ol JOIN accounts oa ON oa.id = ol.account_id
  WHERE oa.tenant_id = ${tenantId} AND oa.system_key = 'OPENING_EQUITY'))`;

/**
 * Cache per permintaan baca (GET): laporan & cek kesehatan memanggil penjumlahan yang sama berkali-kali.
 * Hanya aktif di dalam ledgerCache.run(...) — permintaan yang menulis data tidak memakai cache.
 */
export const ledgerCache = new AsyncLocalStorage<Map<string, Promise<Map<string, Sum>>>>();

/** Cakupan cabang untuk seluruh penjumlahan dalam satu laporan (id cabang, 'NONE' = pusat; kosong = konsolidasi semua cabang) */
export const branchScope = new AsyncLocalStorage<string | undefined>();

/** Total debit & kredit per akun sesuai filter */
export function sumByAccount(db: DbOrTx, tenantId: string, rawFilter: SumFilter): Promise<Map<string, Sum>> {
  const scoped = branchScope.getStore();
  const f = rawFilter.branchId === undefined && scoped ? { ...rawFilter, branchId: scoped } : rawFilter;
  const cache = ledgerCache.getStore();
  if (!cache) return sumByAccountRaw(db, tenantId, f);
  const key = JSON.stringify([tenantId, f]);
  let hit = cache.get(key);
  if (!hit) {
    hit = sumByAccountRaw(db, tenantId, f);
    cache.set(key, hit);
    hit.catch(() => cache.delete(key));
  }
  return hit;
}

async function sumByAccountRaw(db: DbOrTx, tenantId: string, f: SumFilter): Promise<Map<string, Sum>> {
  const conds = [sql`j.tenant_id = ${tenantId}`];
  if (f.from) conds.push(sql`j.date >= ${f.from}`);
  if (f.to) conds.push(sql`j.date <= ${f.to}`);
  const src = f.reversalInheritsSource
    ? sql`(CASE WHEN j.source_type = 'REVERSAL' THEN COALESCE((SELECT o.source_type FROM journal_entries o WHERE o.id = j.reversal_of_id), 'REVERSAL') ELSE j.source_type END)`
    : sql`j.source_type`;
  if (f.excludeSources?.length) conds.push(sql`${src} NOT IN (${sql.join(f.excludeSources.map((s) => sql`${s}`), sql`, `)})`);
  if (f.onlySources?.length) conds.push(sql`${src} IN (${sql.join(f.onlySources.map((s) => sql`${s}`), sql`, `)})`);
  if (f.branchId) conds.push(f.branchId === 'NONE' ? sql`l.branch_id IS NULL` : sql`l.branch_id = ${f.branchId}`);
  if (f.openingLike === 'exclude') conds.push(sql`NOT ${openingLike(tenantId)}`);
  if (f.openingLike === 'only') conds.push(openingLike(tenantId));
  const res = await db.execute<{ account_id: string; debit: string; credit: string }>(sql`
    SELECT l.account_id, SUM(l.debit) AS debit, SUM(l.credit) AS credit
    FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
    WHERE ${sql.join(conds, sql` AND `)}
    GROUP BY l.account_id`);
  return new Map(res.rows.map((r) => [r.account_id, { debit: D(r.debit), credit: D(r.credit) }]));
}

export const get = (m: Map<string, Sum>, id: string) => m.get(id) ?? ZERO_SUM;
export const dayBefore = (d: DocDate) => addDays(d, -1);

/** Laba (rugi) yang belum ditutup ke saldo laba sampai tanggal tertentu (jurnal penutup ikut dihitung) */
export function unclosedEarnings(accs: AccountMeta[], bal: Map<string, Sum>) {
  return accs.reduce<Dec>((a, acc) => {
    if (acc.type === 'REVENUE') return a.plus(natural(acc.type, get(bal, acc.id)));
    if (acc.type === 'EXPENSE') return a.minus(natural(acc.type, get(bal, acc.id)));
    return a;
  }, ZERO);
}
