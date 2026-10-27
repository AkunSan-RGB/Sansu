import { CASH_IN_SOURCES, CASH_OUT_SOURCES, type CashTxType } from '@sansu/shared';
import type { CashTransaction } from '@/api/types';

export interface CounterAccount {
  id: string;
  code: string;
  name: string;
  type: string;
}
export interface CashFormValues {
  cashAccountId: string;
  toCashAccountId?: string;
  amount?: number;
  date: string;
  description: string;
  reference?: string;
  branchId?: string;
  lines?: { accountId?: string; source?: string; amount?: number; memo?: string; projectId?: string; assetCategoryId?: string; assetName?: string; assetUsefulLifeMonths?: number; assetTotalUnits?: number; assetUnitLabel?: string; assetLocation?: string }[];
}
export type AssetCatsByAccount = Map<string, { id: string; name: string; method: string }[]>;

export interface CashListFilter {
  typeFilter: 'ALL' | CashTxType;
  branchFilter?: string;
  noProofOnly: boolean;
  search: string;
}

/** Daftar transaksi sesuai filter layar (jenis, cabang, "belum ada bukti", pencarian teks) */
export function filterCashTx(txs: CashTransaction[], f: CashListFilter): CashTransaction[] {
  const q = f.search.trim().toLowerCase();
  return txs.filter(
    (t) =>
      (f.typeFilter === 'ALL' || t.type === f.typeFilter) &&
      (!f.branchFilter || (f.branchFilter === 'NONE' ? !t.branchId : t.branchId === f.branchFilter)) &&
      (!f.noProofOnly || (t.type !== 'IN' && t.status !== 'VOID' && !t.reference?.trim())) &&
      (!q || `${t.number} ${t.description} ${t.reference ?? ''} ${t.cashAccount.name}`.toLowerCase().includes(q)),
  );
}

/** Ringkasan arus: transaksi yang dibatalkan tidak dihitung; transfer tidak mengubah total kas */
export function cashFlow(shown: CashTransaction[]) {
  const live = shown.filter((t) => t.status !== 'VOID');
  const inn = live.filter((t) => t.type === 'IN').reduce((a, t) => a + Number(t.amount), 0);
  const out = live.filter((t) => t.type === 'OUT').reduce((a, t) => a + Number(t.amount), 0);
  return { inn, out, net: inn - out, missing: live.filter((t) => t.type !== 'IN' && !t.reference?.trim()).length };
}

/** Isi permintaan simpan transaksi kas. Pilihan berawalan "src:" = sumber uang (sistem menentukan akun). */
export function buildCashBody(mode: CashTxType | null, v: CashFormValues, assetCatsByAccount: AssetCatsByAccount, budgetOverrideReason?: string) {
  return {
    budgetOverrideReason,
    type: mode,
    cashAccountId: v.cashAccountId,
    date: v.date,
    description: v.description,
    reference: v.reference || undefined,
    branchId: v.branchId || undefined,
    ...(mode === 'TRANSFER'
      ? { toCashAccountId: v.toCashAccountId, amount: String(v.amount) }
      : {
          lines: (v.lines ?? []).map((l) => ({
            accountId: l.accountId?.startsWith('src:') ? undefined : l.accountId,
            source: l.accountId?.startsWith('src:') ? l.accountId.slice(4) : undefined,
            amount: String(l.amount),
            memo: l.memo || undefined,
            projectId: mode === 'OUT' ? l.projectId || undefined : undefined,
            ...(mode === 'OUT' && l.accountId && assetCatsByAccount.has(l.accountId)
              ? { assetCategoryId: l.assetCategoryId, assetName: l.assetName || undefined, assetUsefulLifeMonths: l.assetUsefulLifeMonths, assetLocation: l.assetLocation || undefined, assetTotalUnits: l.assetTotalUnits ? String(l.assetTotalUnits) : undefined, assetUnitLabel: l.assetUnitLabel || undefined }
              : {}),
          })),
        }),
  };
}

/** Pilihan akun/sumber pada formulir: Keuangan hanya boleh biaya atau aset; akun pembukuan penuh khusus Pemilik/Admin */
export function cashAccountOptions(m: CashTxType | null, role: string | undefined, counter: CounterAccount[] | undefined, assetCatsByAccount: AssetCatsByAccount) {
  const isFin = role === 'FINANCE';
  const accs = counter?.filter((a) => m !== 'OUT' || !isFin || a.type === 'EXPENSE' || assetCatsByAccount.has(a.id)).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })) ?? [];
  if (m === 'OUT') {
    const outs = CASH_OUT_SOURCES.map((s) => ({ value: `src:${s.key}`, label: `${s.label} — ${s.hint}` }));
    return [{ label: 'Jenis biaya (disarankan; sistem menentukan akun)', options: outs }, { label: isFin ? 'Akun biaya / aset' : 'Akun pembukuan', options: accs }];
  }
  if (m !== 'IN') return accs;
  const sources = CASH_IN_SOURCES.map((s) => ({ value: `src:${s.key}`, label: `${s.label} — ${s.hint}` }));
  return role && ['OWNER', 'ADMIN'].includes(role) ? [{ label: 'Sumber uang (disarankan)', options: sources }, { label: 'Akun pembukuan (khusus Pemilik/Admin)', options: accs }] : sources;
}
