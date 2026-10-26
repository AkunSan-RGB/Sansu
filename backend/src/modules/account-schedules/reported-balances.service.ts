import { Injectable } from '@nestjs/common';
import { D, Dec, ZERO } from '../../common/utils/money';
import type { AccountType } from '../../db/schema';
import { StatementsService } from '../accounting/statements.service';

export const UNCLOSED_KEY = 'unclosed';

export interface ReportedBalances {
  /** Saldo akhir per akun sebagaimana tercetak di laporan keuangan (tanda alami: aset/beban = debit−kredit, lainnya kredit−debit) */
  byAccount: Map<string, Dec>;
  /** Laba (rugi) belum ditutup yang disajikan di ekuitas */
  unclosedEarnings: Dec;
}

/**
 * Membaca angka akun dari laporan keuangan itu sendiri (laporan posisi keuangan per 31 Desember dan laba rugi 1 Januari–31 Desember),
 * bukan dari buku besar, sehingga pembandingan jadwal dengan laporan memeriksa angka yang benar-benar tersaji.
 */
@Injectable()
export class ReportedBalanceService {
  constructor(private readonly statements: StatementsService) {}

  async forYear(tenantId: string, year: number, typeOf: (accountId: string) => AccountType | undefined): Promise<ReportedBalances> {
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const [position, income] = await Promise.all([this.statements.financialPosition(tenantId, to), this.statements.income(tenantId, { from, to })]);
    const byAccount = new Map<string, Dec>();
    let unclosedEarnings = ZERO;
    for (const section of position.sections)
      for (const line of section.lines)
        for (const a of line.accounts ?? []) {
          if (a.id === UNCLOSED_KEY) unclosedEarnings = D(a.amount);
          else byAccount.set(a.id, D(a.amount));
        }
    for (const line of income.lines)
      for (const a of line.accounts ?? []) {
        // laba rugi menyajikan beban sebagai pengurang laba; jadwal memakai tanda alami akun
        byAccount.set(a.id, typeOf(a.id) === 'EXPENSE' ? D(a.amount).negated() : D(a.amount));
      }
    return { byAccount, unclosedEarnings };
  }
}
