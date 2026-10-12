import { D, Dec, DecValue, money, ZERO } from '../../common/utils/money';

export interface DraftLine {
  accountId: string;
  debit?: DecValue;
  credit?: DecValue;
  memo?: string;
  projectId?: string | null;
}

export interface NormalizedLine {
  accountId: string;
  debit: Dec;
  credit: Dec;
  memo?: string;
  projectId?: string | null;
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
    out.push({ accountId: l.accountId, debit, credit, memo: l.memo, projectId: l.projectId ?? null });
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
