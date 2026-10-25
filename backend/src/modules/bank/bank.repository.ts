import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql, desc } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import {
  accounts,
  bankLineExtraMatches,
  bankRules,
  bankStatementLines,
  bankStatements,
  journalLines,
  bankReconciliations,
} from '../../db/schema';
import { money, Dec } from '../../common/utils/money';
import { addDays } from '../../common/utils/dates';

type LinePatch = Partial<typeof bankStatementLines.$inferInsert>;
type RuleValues = Partial<typeof bankRules.$inferInsert>;

/** Akses data rekening koran, mutasi, pencocokan, dan aturan bank. Setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class BankRepository {
  // ---- rekening koran ----
  async statementById(db: DbOrTx, id: string) {
    const [st] = await db.select().from(bankStatements).where(eq(bankStatements.id, id));
    return st;
  }

  async deleteStatement(db: DbOrTx, id: string) {
    await db.delete(bankStatements).where(eq(bankStatements.id, id));
  }

  // ---- mutasi ----
  unmatchedLines(db: DbOrTx, statementId: string) {
    return db
      .select()
      .from(bankStatementLines)
      .where(and(eq(bankStatementLines.statementId, statementId), eq(bankStatementLines.status, 'UNMATCHED')))
      .orderBy(asc(bankStatementLines.date), asc(bankStatementLines.seq));
  }

  async patchLine(db: DbOrTx, lineId: string, patch: LinePatch) {
    await db.update(bankStatementLines).set(patch).where(eq(bankStatementLines.id, lineId));
  }

  // ---- pencocokan dengan transaksi buku ----
  async journalLineById(db: DbOrTx, id: string) {
    const [b] = await db.select().from(journalLines).where(eq(journalLines.id, id));
    return b;
  }

  /** Apakah transaksi buku sudah dipakai mutasi lain (sebagai pasangan utama atau tambahan) */
  async journalLineTaken(db: DbOrTx, journalLineId: string) {
    const [main] = await db
      .select({ id: bankStatementLines.id })
      .from(bankStatementLines)
      .where(eq(bankStatementLines.journalLineId, journalLineId));
    const [extra] = await db
      .select({ id: bankLineExtraMatches.id })
      .from(bankLineExtraMatches)
      .where(eq(bankLineExtraMatches.journalLineId, journalLineId));
    return !!(main || extra);
  }

  async insertExtraMatches(db: DbOrTx, tenantId: string, lineId: string, journalLineIds: string[]) {
    await db.insert(bankLineExtraMatches).values(journalLineIds.map((jl) => ({ tenantId, lineId, journalLineId: jl })));
  }

  async clearExtraMatches(db: DbOrTx, lineId: string) {
    await db.delete(bankLineExtraMatches).where(eq(bankLineExtraMatches.lineId, lineId));
  }

  // ---- aturan otomatis ----
  listRules(db: DbOrTx, tenantId: string) {
    return db.select().from(bankRules).where(eq(bankRules.tenantId, tenantId)).orderBy(asc(bankRules.name));
  }

  activeRules(db: DbOrTx, tenantId: string) {
    return db
      .select()
      .from(bankRules)
      .where(and(eq(bankRules.tenantId, tenantId), eq(bankRules.isActive, true)));
  }

  async insertRule(db: DbOrTx, values: typeof bankRules.$inferInsert) {
    const [row] = await db.insert(bankRules).values(values).returning();
    return row;
  }

  async updateRule(db: DbOrTx, tenantId: string, id: string, values: RuleValues) {
    const [row] = await db
      .update(bankRules)
      .set(values)
      .where(and(eq(bankRules.id, id), eq(bankRules.tenantId, tenantId)))
      .returning();
    return row;
  }

  async deleteRule(db: DbOrTx, tenantId: string, id: string) {
    const r = await db
      .delete(bankRules)
      .where(and(eq(bankRules.id, id), eq(bankRules.tenantId, tenantId)))
      .returning({ id: bankRules.id });
    return r.length > 0;
  }

  // ---- akun ----
  accountsOfTenant(db: DbOrTx, tenantId: string) {
    return db
      .select({ id: accounts.id, code: accounts.code, type: accounts.type, isPostable: accounts.isPostable })
      .from(accounts)
      .where(eq(accounts.tenantId, tenantId));
  }

  accountsByIds(db: DbOrTx, tenantId: string, ids: string[]) {
    return db
      .select()
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, ids)));
  }

  async postableAccountByCode(db: DbOrTx, tenantId: string, code: string) {
    const [a] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, code), eq(accounts.isPostable, true)));
    return a;
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh BankService.get */
  queryBankLineExtraMatche(db: DbOrTx, tenantId: string, id: string) {
    return db.execute<{ line_id: string; n: number }>(
      sql`SELECT line_id, COUNT(*)::int AS n FROM bank_line_extra_matches WHERE tenant_id = ${tenantId} AND line_id IN (SELECT id FROM bank_statement_lines WHERE statement_id = ${id}) GROUP BY line_id`,
    );
  }

  /** Dipakai oleh BankService.import */
  queryBankStatementLine(db: DbOrTx, tenantId: string, cashAccountId: string, dates: string[], datesCount: number) {
    return db.execute<{ k: string; n: number }>(sql`
        SELECT l.date::text || '|' || l.amount::text || '|' || l.description AS k, COUNT(*)::int AS n
        FROM bank_statement_lines l JOIN bank_statements s ON s.id = l.statement_id
        WHERE s.tenant_id = ${tenantId} AND s.cash_account_id = ${cashAccountId} AND l.date BETWEEN ${dates[0]} AND ${dates[datesCount - 1]}
        GROUP BY 1`);
  }

  /** Dipakai oleh BankService.import */
  insertBankStatementLines(
    db: DbOrTx,
    fresh: { date: string; amount: Dec; seq: number; description: string; balance?: string }[],
    tenantId: string,
    id: string,
  ) {
    return db.insert(bankStatementLines).values(
      fresh.map((r, i) => ({
        tenantId: tenantId,
        statementId: id,
        seq: i + 1,
        date: r.date,
        description: r.description.trim(),
        amount: r.amount.toFixed(2),
        balance: r.balance ? money(r.balance).toFixed(2) : null,
      })),
    );
  }

  /** Dipakai oleh BankService.import */
  queryBankStatementLineForImport(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<{ n: number; total: string }>(sql`
        SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0) AS total FROM bank_statement_lines
        WHERE statement_id = ${id} AND tenant_id = ${tenantId} AND amount > 0 AND status = 'UNMATCHED'`);
  }

  /** Dipakai oleh BankService.autoMatchTx */
  queryAutoMatchTx(db: DbOrTx, tenantId: string) {
    return db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`bank:${tenantId}`}))`);
  }

  /** Dipakai oleh BankService.matchMany */
  queryJournalLine(db: DbOrTx, ids: string[]) {
    return db.execute<{ id: string; account_id: string; debit: string; credit: string; tenant_id: string }>(sql`
        SELECT l.id, l.account_id, l.debit, l.credit, j.tenant_id FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
        WHERE l.id IN (${sql.join(
          ids.map((x) => sql`${x}`),
          sql`, `,
        )})`);
  }

  /** Dipakai oleh BankService.matchMany */
  queryBankStatementLineForMatchMany(db: DbOrTx, ids: string[]) {
    return db.execute(
      sql`SELECT 1 FROM bank_statement_lines WHERE journal_line_id IN (${sql.join(
        ids.map((x) => sql`${x}`),
        sql`, `,
      )}) LIMIT 1`,
    );
  }

  /** Dipakai oleh BankService.matchMany */
  queryBankLineExtraMatcheForMatchMany(db: DbOrTx, ids: string[]) {
    return db.execute(
      sql`SELECT 1 FROM bank_line_extra_matches WHERE journal_line_id IN (${sql.join(
        ids.map((x) => sql`${x}`),
        sql`, `,
      )}) LIMIT 1`,
    );
  }

  /** Dipakai oleh BankService.sign */
  queryBankStatement(db: DbOrTx, tenantId: string, cashAccountId: string, sub: string, end: string, start: string) {
    return db.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM bank_statements WHERE tenant_id = ${tenantId} AND cash_account_id = ${cashAccountId}
          AND imported_by_id = ${sub} AND period_from <= ${end} AND period_to >= ${start}`);
  }

  /** Dipakai oleh BankService.sign */
  insertBankReconciliations(
    db: DbOrTx,
    tenantId: string,
    cashAccountId: string,
    period: string,
    bookBalance: string,
    sub: string,
    notes: string | undefined,
  ) {
    return db
      .insert(bankReconciliations)
      .values({
        tenantId: tenantId,
        cashAccountId: cashAccountId,
        period: period,
        bookBalance: bookBalance,
        signedById: sub,
        notes: notes,
      })
      .onConflictDoNothing()
      .returning();
  }

  /** Dipakai oleh BankService.controls */
  queryBankStatementLineForControls(db: DbOrTx, tenantId: string, today: string, bankOutDays: number) {
    return db.execute<{ date: string; amount: string; description: string; name: string }>(sql`
      SELECT l.date::text, l.amount, l.description, a.name FROM bank_statement_lines l JOIN bank_statements s ON s.id = l.statement_id JOIN accounts a ON a.id = s.cash_account_id
      WHERE s.tenant_id = ${tenantId} AND l.status = 'UNMATCHED' AND l.amount < 0 AND l.date <= ${addDays(today, -bankOutDays)} ORDER BY l.date`);
  }

  /** Dipakai oleh BankService.controls */
  queryBankStatementLineForControls2(db: DbOrTx, tenantId: string, today: string, bankInDays: number) {
    return db.execute<{ date: string; amount: string; description: string }>(sql`
      SELECT l.date::text, l.amount, l.description FROM bank_statement_lines l JOIN bank_statements s ON s.id = l.statement_id
      WHERE s.tenant_id = ${tenantId} AND l.status = 'UNMATCHED' AND l.amount > 0 AND l.date <= ${addDays(today, -bankInDays)} ORDER BY l.date`);
  }

  /** Dipakai oleh BankService.controls */
  queryJournalLineForControls(db: DbOrTx, tenantId: string, today: string, bookNotInBankDays: number) {
    return db.execute<{ number: string; credit: string }>(sql`
      SELECT j.number, l.credit FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.is_cash_account AND a.code IN (SELECT a2.code FROM accounts a2 WHERE a2.tenant_id = ${tenantId} AND EXISTS (SELECT 1 FROM bank_statements s WHERE s.cash_account_id = a2.id))
        AND l.credit > 0 AND j.date <= ${addDays(today, -bookNotInBankDays)} AND j.source_type <> 'CLOSING'
        AND EXISTS (SELECT 1 FROM bank_statements s WHERE s.cash_account_id = l.account_id AND s.period_to >= j.date)
        AND NOT EXISTS (SELECT 1 FROM bank_statement_lines b WHERE b.journal_line_id = l.id)
        AND NOT EXISTS (SELECT 1 FROM bank_line_extra_matches x WHERE x.journal_line_id = l.id) ORDER BY j.date LIMIT 50`);
  }

  /** Dipakai oleh BankService.controls */
  queryBankStatementLineForControls3(db: DbOrTx, tenantId: string, today: string) {
    return db.execute<{ date: string; amount: string; note: string | null }>(sql`
      SELECT l.date::text, l.amount, l.note FROM bank_statement_lines l JOIN bank_statements s ON s.id = l.statement_id
      WHERE s.tenant_id = ${tenantId} AND l.status = 'IGNORED' AND l.date >= ${addDays(today, -60)} ORDER BY l.date DESC`);
  }

  /** Dipakai oleh BankService.controls */
  queryAccount(db: DbOrTx, tenantId: string, prev: string) {
    return db.execute<{ name: string }>(sql`
        SELECT a.name FROM accounts a WHERE a.tenant_id = ${tenantId} AND a.is_cash_account
          AND EXISTS (SELECT 1 FROM bank_statements s WHERE s.cash_account_id = a.id AND s.period_to >= ${`${prev}-01`})
          AND NOT EXISTS (SELECT 1 FROM bank_reconciliations r WHERE r.cash_account_id = a.id AND r.period = ${prev})`);
  }

  /** Dipakai oleh BankService.reconciliation */
  queryJournalLineForReconciliation(db: DbOrTx, tenantId: string, cashAccountId: string, asOf: string) {
    return db.execute<{ v: string }>(sql`
        SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
        WHERE j.tenant_id = ${tenantId} AND l.account_id = ${cashAccountId} AND j.date <= ${asOf}`);
  }

  /** Dipakai oleh BankService.reconciliation */
  findBankStatementLinesWithBankStatementsByDateAndBalanceAndSeq(db: DbOrTx, cashAccountId: string, asOf: string) {
    return db
      .select({ balance: bankStatementLines.balance, date: bankStatementLines.date })
      .from(bankStatementLines)
      .innerJoin(bankStatements, eq(bankStatements.id, bankStatementLines.statementId))
      .where(
        and(
          eq(bankStatements.cashAccountId, cashAccountId),
          sql`${bankStatementLines.date} <= ${asOf}`,
          sql`${bankStatementLines.balance} IS NOT NULL`,
        ),
      )
      .orderBy(desc(bankStatementLines.date), desc(bankStatementLines.seq))
      .limit(1);
  }

  /** Dipakai oleh BankService.reconciliation */
  findBankStatementsByCashAccountIdAndPeriodFrom(db: DbOrTx, cashAccountId: string) {
    return db
      .select({ from: bankStatements.periodFrom })
      .from(bankStatements)
      .where(eq(bankStatements.cashAccountId, cashAccountId))
      .orderBy(asc(bankStatements.periodFrom))
      .limit(1);
  }

  /** Dipakai oleh BankService.reconciliation */
  queryBankStatementLineForReconciliation(db: DbOrTx, tenantId: string, cashAccountId: string, asOf: string) {
    return db.execute<{ id: string; date: string; description: string; amount: string }>(sql`
      SELECT l.id, l.date, l.description, l.amount FROM bank_statement_lines l JOIN bank_statements s ON s.id = l.statement_id
      WHERE s.tenant_id = ${tenantId} AND s.cash_account_id = ${cashAccountId} AND l.status = 'UNMATCHED' AND l.date <= ${asOf}
      ORDER BY l.date`);
  }

  /** Dipakai oleh BankService.status */
  queryAccountForStatus(db: DbOrTx, tenantId: string) {
    return db.execute<{ id: string; code: string; name: string; last_date: string | null; unmatched: number }>(sql`
      SELECT a.id, a.code, a.name, MAX(l.date) AS last_date, COUNT(l.id) FILTER (WHERE l.status = 'UNMATCHED')::int AS unmatched
      FROM accounts a
      LEFT JOIN bank_statements s ON s.cash_account_id = a.id
      LEFT JOIN bank_statement_lines l ON l.statement_id = s.id
      WHERE a.tenant_id = ${tenantId} AND a.is_cash_account = true AND a.is_postable = true
      GROUP BY a.id ORDER BY a.code`);
  }
}
