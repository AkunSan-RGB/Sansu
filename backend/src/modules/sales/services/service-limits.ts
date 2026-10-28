import { D, Dec, money, ZERO } from '../../../common/utils/money';

export type BudgetStatus = 'NONE' | 'OK' | 'WARN' | 'OVER';

/** Ambang peringatan pemakaian anggaran biaya proyek */
export const BUDGET_WARN_PCT = 80;

/** Pemakaian anggaran biaya proyek: tanpa anggaran (0) tidak dipantau; ≥80% peringatan; >100% melampaui */
export function budgetUsage(cost: string | Dec, budget: string | Dec): { status: BudgetStatus; usedPct: number | null; remaining: string } {
  const b = D(budget);
  if (b.lte(0)) return { status: 'NONE', usedPct: null, remaining: '0.00' };
  const c = D(cost);
  const pct = Math.round(c.div(b).times(1000).toNumber()) / 10;
  return { status: c.gt(b) ? 'OVER' : pct >= BUDGET_WARN_PCT ? 'WARN' : 'OK', usedPct: pct, remaining: b.minus(c).toFixed(2) };
}

/** Kelebihan jam retainer: hanya jam di atas jatah yang ditagih dengan tarif kelebihan */
export function retainerOverage(hours: string | Dec, included: string | Dec, rate: string | Dec): { used: string; over: string; amount: Dec } {
  const used = D(hours);
  const over = Dec0(used.minus(included));
  return { used: used.toFixed(2), over: over.toFixed(2), amount: over.gt(0) ? money(over.times(rate)) : ZERO };
}

const Dec0 = (v: Dec) => (v.gt(0) ? v : ZERO);
