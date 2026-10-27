import { D, Dec, DecValue, money, ZERO } from '../../common/utils/money';

export interface DraftLine {
  accountId: string;
  debit?: DecValue;
  credit?: DecValue;
  /** Jumlah valas (positif) untuk akun bermata uang asing */
  foreignAmount?: DecValue | null;
  memo?: string;
  projectId?: string | null;
  branchId?: string | null;
}

export interface NormalizedLine {
  accountId: string;
  debit: Dec;
  credit: Dec;
  foreignAmount: Dec | null;
  memo?: string;
  projectId?: string | null;
  branchId?: string | null;
}

export class JournalValidationError extends Error {}

/**
 * Aturan double-entry (fungsi murni, dites di journal-rules.spec.ts):
 *  - setiap baris hanya debit ATAU kredit, tidak negatif
 *  - baris bernilai nol dibuang (mis. PPN 0)
 *  - total debit = total kredit, dan > 0
 */
export function normalizeJournalLines(lines: DraftLine[]): { lines: NormalizedLine[]; total: Dec } {
  const out: NormalizedLine[] = [];
  for (const l of lines) {
    const debit = money(D(l.debit));
    const credit = money(D(l.credit));
    if (debit.isNegative() || credit.isNegative()) throw new JournalValidationError('Nilai debit/kredit tidak boleh negatif');
    if (debit.gt(0) && credit.gt(0)) throw new JournalValidationError('Satu baris jurnal hanya boleh debit atau kredit');
    if (debit.isZero() && credit.isZero()) continue;
    const foreign = l.foreignAmount == null ? null : money(D(l.foreignAmount));
    if (foreign && foreign.lte(0)) throw new JournalValidationError('Jumlah valas harus lebih dari 0');
    out.push({ accountId: l.accountId, debit, credit, foreignAmount: foreign, memo: l.memo, projectId: l.projectId ?? null, branchId: l.branchId });
  }
  if (out.length < 2) throw new JournalValidationError('Jurnal minimal memiliki dua baris bernilai');

  const totalDebit = out.reduce<Dec>((a, l) => a.plus(l.debit), ZERO);
  const totalCredit = out.reduce<Dec>((a, l) => a.plus(l.credit), ZERO);
  if (!totalDebit.eq(totalCredit)) {
    throw new JournalValidationError(
      `Jurnal tidak seimbang: debit ${totalDebit.toFixed(2)} ≠ kredit ${totalCredit.toFixed(2)}`,
    );
  }
  return { lines: out, total: totalDebit };
}

/**
 * Jurnal lintas cabang: tiap cabang harus seimbang sendiri. Selisih (debit - kredit) per cabang ditutup dengan baris pada
 * Rekening Antar Cabang (piutang di satu cabang, utang di cabang lain; nol bila digabung). Fungsi murni: mengembalikan baris
 * penyeimbang, tidak mengubah masukan. Baris tanpa cabang eksplisit (`undefined`) memakai cabang jurnal; `null` berarti pusat.
 */
export function interBranchBalancingLines(lines: NormalizedLine[], entryBranch: string | null, interBranchAccountId: string): NormalizedLine[] {
  const labelOf = (l: { branchId?: string | null }) => (l.branchId === undefined ? entryBranch : l.branchId) ?? null;
  if (new Set(lines.map(labelOf)).size <= 1) return [];
  const net = new Map<string | null, Dec>();
  for (const l of lines) net.set(labelOf(l), (net.get(labelOf(l)) ?? D(0)).plus(l.debit).minus(l.credit));
  const out: NormalizedLine[] = [];
  for (const [branch, v] of net) {
    if (v.isZero()) continue;
    out.push({ accountId: interBranchAccountId, debit: v.isNegative() ? v.abs() : D(0), credit: v.isPositive() ? v : D(0), foreignAmount: null, memo: 'Antar cabang', projectId: null, branchId: branch });
  }
  return out;
}
