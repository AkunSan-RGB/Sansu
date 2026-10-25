import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, and, eq, inArray, asc } from 'drizzle-orm';
import {
  accounts,
  projects,
  cashTransactions,
  cashTransactionLines,
  journalEntries,
  fixedAssets,
  branches,
} from '../../db/schema';
import { addDays } from '../../common/utils/dates';
import { money } from '../../common/utils/money';
import { CashLineDto, CreateCashTxDto } from './cash.dto';
import type { SQL } from 'drizzle-orm';

/** Kas yang sudah melewati penentuan sumber: setiap baris punya akun */
export type ResolvedCashTx = Omit<CreateCashTxDto, 'lines'> & {
  lines?: (Omit<CashLineDto, 'accountId'> & { accountId: string; sourceKey?: string })[];
};

/** Akses data untuk Cash: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class CashRepository {
  /** Dipakai oleh CashService.accounts */
  queryAccount(db: DbOrTx, tenantId: string) {
    return db.execute<{ id: string; code: string; name: string; balance: string }>(sql`
      SELECT a.id, a.code, a.name,
             COALESCE((SELECT SUM(l.debit - l.credit) FROM journal_lines l WHERE l.account_id = a.id), 0) AS balance
      FROM accounts a
      WHERE a.tenant_id = ${tenantId} AND a.is_cash_account = true AND a.is_postable = true
      ORDER BY a.code`);
  }

  /** Dipakai oleh CashService.create */
  listAccountsById(db: DbOrTx, tenantId: string, ids: string[]) {
    return db
      .select()
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, ids)));
  }

  /** Dipakai oleh CashService.create */
  listProjectsById(db: DbOrTx, tenantId: string, pids: string[]) {
    return db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.tenantId, tenantId), inArray(projects.id, pids)));
  }

  /** Dipakai oleh CashService.create */
  queryBranche(db: DbOrTx, branchId: string, tenantId: string) {
    return db.execute<{ id: string }>(sql`SELECT id FROM branches WHERE id = ${branchId} AND tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh CashService.create */
  queryCreate(db: DbOrTx, id: string) {
    return db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`cash-balance:${id}`}))`);
  }

  /** Dipakai oleh CashService.create */
  queryJournalLine(db: DbOrTx, id: string) {
    return db.execute<{ bal: string }>(
      sql`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS bal FROM journal_lines l WHERE l.account_id = ${id}`,
    );
  }

  /** Dipakai oleh CashService.assertNotPettyCash */
  queryPettyCashFund(db: DbOrTx, tenantId: string) {
    return db.execute<{ account_id: string; imprest_amount: string }>(
      sql`SELECT account_id, imprest_amount FROM petty_cash_funds WHERE tenant_id = ${tenantId} AND status = 'ACTIVE'`,
    );
  }

  /** Dipakai oleh CashService.assertNotPettyCash */
  queryJournalLineForAssertNotPettyCash(db: DbOrTx, toId: string) {
    return db.execute<{ bal: string }>(
      sql`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS bal FROM journal_lines l WHERE l.account_id = ${toId}`,
    );
  }

  /** Dipakai oleh CashService.void */
  queryCashTransaction(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<{ id: string }>(
      sql`SELECT id FROM cash_transactions WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
  }

  /** Dipakai oleh CashService.void */
  findCashTransactionsById(db: DbOrTx, id: string) {
    return db.select().from(cashTransactions).where(eq(cashTransactions.id, id));
  }

  /** Dipakai oleh CashService.void */
  queryVoid(db: DbOrTx, journalId: string) {
    return db.execute<{ n: number }>(sql`
        SELECT (SELECT COUNT(*) FROM bank_statement_lines b
                WHERE b.status IN ('MATCHED', 'CREATED')
                  AND (b.journal_id = ${journalId} OR b.journal_line_id IN (SELECT id FROM journal_lines WHERE journal_id = ${journalId})))::int
             + (SELECT COUNT(*) FROM bank_line_extra_matches x WHERE x.journal_line_id IN (SELECT id FROM journal_lines WHERE journal_id = ${journalId}))::int AS n`);
  }

  /** Dipakai oleh CashService.void */
  queryFixedAsset(db: DbOrTx, tenantId: string, journalId: string) {
    return db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM fixed_assets WHERE tenant_id = ${tenantId} AND acquisition_journal_id = ${journalId}`,
    );
  }

  /** Dipakai oleh CashService.controls */
  queryAccountForControls(db: DbOrTx, tenantId: string) {
    return db.execute<{ id: string; code: string; name: string; last: string | null }>(sql`
      SELECT a.id, a.code, a.name, (SELECT MAX(s.period_to) FROM bank_statements s WHERE s.cash_account_id = a.id) AS last
      FROM accounts a
      WHERE a.tenant_id = ${tenantId} AND a.is_cash_account = true AND a.is_postable = true
        AND EXISTS (SELECT 1 FROM bank_statements s WHERE s.cash_account_id = a.id)`);
  }

  /** Dipakai oleh CashService.controls */
  queryBankStatementLine(db: DbOrTx, tenantId: string, since: string, today: string, sign: '<' | '>') {
    return db.execute<{ d: string; amt: string; descr: string; acc: string }>(sql`
      SELECT b.date::text AS d, b.amount::text AS amt, b.description AS descr, a.name AS acc
      FROM bank_statement_lines b JOIN bank_statements s ON s.id = b.statement_id JOIN accounts a ON a.id = s.cash_account_id
      WHERE b.tenant_id = ${tenantId} AND b.status = 'UNMATCHED' AND b.date >= ${since} AND b.date <= ${addDays(today, -7)}
        AND ${sign === '<' ? sql`b.amount < 0` : sql`b.amount > 0`}
      ORDER BY ABS(b.amount) DESC LIMIT 30`);
  }

  /** Dipakai oleh CashService.controls */
  queryJournalLineForControls(db: DbOrTx, tenantId: string, since: string, today: string) {
    return db.execute<{ number: string; d: string; v: string; acc: string }>(sql`
      SELECT j.number, j.date::text AS d, jl.credit::text AS v, a.name AS acc
      FROM journal_lines jl JOIN journal_entries j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
      WHERE j.tenant_id = ${tenantId} AND a.is_cash_account AND jl.credit > 0 AND j.date >= ${since} AND j.date <= ${addDays(today, -3)}
        AND j.source_type NOT IN ('TRANSFER', 'CLOSING', 'OPENING', 'REVERSAL')
        AND EXISTS (SELECT 1 FROM bank_statements s WHERE s.tenant_id = ${tenantId} AND s.cash_account_id = a.id AND j.date BETWEEN s.period_from AND s.period_to)
        AND NOT EXISTS (SELECT 1 FROM bank_statement_lines b WHERE b.journal_line_id = jl.id)
        AND NOT EXISTS (SELECT 1 FROM bank_line_extra_matches x WHERE x.journal_line_id = jl.id)
        AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = j.id OR r.id = j.reversal_of_id)
      ORDER BY jl.credit DESC LIMIT 30`);
  }

  /** Dipakai oleh CashService.controls */
  queryBankStatement(db: DbOrTx, tenantId: string) {
    return db.execute<{ acc: string; to_d: string; closing: string; book: string }>(sql`
      SELECT a.name AS acc, s.period_to::text AS to_d, s.closing_balance::text AS closing,
        (SELECT COALESCE(SUM(jl.debit - jl.credit), 0) FROM journal_lines jl JOIN journal_entries j ON j.id = jl.journal_id WHERE jl.account_id = a.id AND j.tenant_id = ${tenantId} AND j.date <= s.period_to)::text AS book
      FROM bank_statements s JOIN accounts a ON a.id = s.cash_account_id
      WHERE s.tenant_id = ${tenantId} AND s.closing_balance IS NOT NULL
        AND s.period_to = (SELECT MAX(s2.period_to) FROM bank_statements s2 WHERE s2.cash_account_id = s.cash_account_id AND s2.closing_balance IS NOT NULL)`);
  }

  /** Dipakai oleh CashService.controls */
  queryPayrollRun(db: DbOrTx, tenantId: string) {
    return db.execute<{ period: string; net: string }>(
      sql`SELECT period, total_net::text AS net FROM payroll_runs WHERE tenant_id = ${tenantId} ORDER BY period DESC LIMIT 2`,
    );
  }

  /** Dipakai oleh CashService.controls */
  queryPayslip(db: DbOrTx, tenantId: string) {
    return db.execute<{ period: string; name: string; resign: string }>(sql`
      SELECT r.period, e.name, e.resign_date::text AS resign FROM payslips p JOIN payroll_runs r ON r.id = p.run_id JOIN employees e ON e.id = p.employee_id
      WHERE r.tenant_id = ${tenantId} AND e.resign_date IS NOT NULL AND (r.period || '-01')::date > e.resign_date AND p.net_pay > 0
      ORDER BY r.period DESC LIMIT 30`);
  }

  /** Dipakai oleh CashService.controls */
  queryPayslipForControls(db: DbOrTx, tenantId: string, today: string) {
    return db.execute<{ period: string; name: string; v: string }>(sql`
      SELECT r.period, e.name, p.other_income::text AS v FROM payslips p JOIN payroll_runs r ON r.id = p.run_id JOIN employees e ON e.id = p.employee_id
      WHERE r.tenant_id = ${tenantId} AND r.period >= to_char(${addDays(today, -90)}::date, 'YYYY-MM') AND p.other_income >= GREATEST(1000000, p.base_salary * 0.2)
      ORDER BY p.other_income DESC LIMIT 30`);
  }

  /** Dipakai oleh CashService.controls */
  queryEmployee(db: DbOrTx, tenantId: string) {
    return db.execute<{ name: string }>(sql`
      SELECT name FROM employees WHERE tenant_id = ${tenantId} AND is_active AND base_salary > 0 AND COALESCE(NULLIF(TRIM(bank_account), ''), '') = '' ORDER BY name LIMIT 30`);
  }

  /** Dipakai oleh CashService.controls */
  queryCashCount(db: DbOrTx, tenantId: string, today: string) {
    return db.execute<{ number: string }>(sql`
      SELECT number FROM cash_counts WHERE tenant_id = ${tenantId} AND date >= ${addDays(today, -30)} AND status = 'POSTED' AND difference <> 0`);
  }

  /** Dipakai oleh CashService.incomeSources */
  queryJournalLineForIncomeSources(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ st: string; amount: string; n: number }>(sql`
      SELECT j.source_type AS st, COALESCE(SUM(l.debit), 0) AS amount, COUNT(DISTINCT j.id)::int AS n
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND a.is_cash_account AND l.debit > 0 AND j.date BETWEEN ${from} AND ${to}
        AND j.source_type NOT IN ('TRANSFER', 'CLOSING', 'OPENING', 'REVERSAL', 'CASH_COUNT', 'CASH_IN', 'BANK')
      GROUP BY j.source_type`);
  }

  /** Dipakai oleh CashService.incomeSources */
  queryJournalEntry(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{
      st: string;
      code: string;
      name: string;
      type: string;
      system_key: string | null;
      amount: string;
      n: number;
    }>(sql`
      SELECT j.source_type AS st, ca.code, ca.name, ca.type, ca.system_key, COALESCE(SUM(lc.credit), 0) AS amount, COUNT(DISTINCT j.id)::int AS n
      FROM journal_entries j
      JOIN journal_lines l ON l.journal_id = j.id AND l.debit > 0 JOIN accounts a ON a.id = l.account_id AND a.is_cash_account
      JOIN journal_lines lc ON lc.journal_id = j.id AND lc.credit > 0 JOIN accounts ca ON ca.id = lc.account_id AND NOT ca.is_cash_account
      WHERE j.tenant_id = ${tenantId} AND j.source_type IN ('CASH_IN', 'BANK') AND j.date BETWEEN ${from} AND ${to}
      GROUP BY j.source_type, ca.code, ca.name, ca.type, ca.system_key`);
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh CashService.resolveSources */
  queryAccountForResolveSources(db: DbOrTx, tenantId: string, keysValues: SQL<unknown>[]) {
    return db.execute<{ id: string; code: string }>(
      sql`SELECT id, code FROM accounts WHERE tenant_id = ${tenantId} AND is_postable AND code IN (${sql.join(keysValues, sql`, `)})`,
    );
  }

  /** Dipakai oleh CashService.create */
  insertCashTransactionLines(
    db: DbOrTx,
    lines: (Omit<CashLineDto, 'accountId'> & { accountId: string; sourceKey?: string })[],
    id: string,
    dto: ResolvedCashTx,
  ) {
    return db.insert(cashTransactionLines).values(
      lines.map((l) => ({
        transactionId: id,
        accountId: l.accountId as string,
        amount: money(l.amount).toFixed(2),
        memo: l.memo,
        projectId: dto.type === 'OUT' ? l.projectId : undefined,
        sourceKey: (l as { sourceKey?: string }).sourceKey,
      })),
    );
  }

  /** Dipakai oleh CashService.controls */
  queryControls(db: DbOrTx, q: SQL<unknown>) {
    return db.execute<{ number: string; d: string; v: string }>(q);
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh CashService.list */
  listJournalEntriesById(db: DbOrTx, jids: NonNullable<(typeof journalEntries.$inferSelect)['id']>[]) {
    return db
      .select({ id: journalEntries.id, number: journalEntries.number })
      .from(journalEntries)
      .where(inArray(journalEntries.id, jids));
  }

  /** Dipakai oleh CashService.list */
  listFixedAssetsByAcquisitionJournalId(
    db: DbOrTx,
    tenantId: NonNullable<(typeof fixedAssets.$inferSelect)['tenantId']>,
    jids: NonNullable<(typeof fixedAssets.$inferSelect)['acquisitionJournalId']>[],
  ) {
    return db
      .select({
        journalId: fixedAssets.acquisitionJournalId,
        id: fixedAssets.id,
        code: fixedAssets.code,
        name: fixedAssets.name,
      })
      .from(fixedAssets)
      .where(and(eq(fixedAssets.tenantId, tenantId), inArray(fixedAssets.acquisitionJournalId, jids)));
  }

  /** Dipakai oleh CashService.list */
  listBranches(db: DbOrTx, tenantId: NonNullable<(typeof branches.$inferSelect)['tenantId']>) {
    return db
      .select({ id: branches.id, code: branches.code, name: branches.name })
      .from(branches)
      .where(eq(branches.tenantId, tenantId));
  }

  /** Dipakai oleh CashService.counterAccounts */
  listAccountsByIsPostableAndIsCashAccountAndSystemKey(
    db: DbOrTx,
    tenantId: NonNullable<(typeof accounts.$inferSelect)['tenantId']>,
  ) {
    return db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name, type: accounts.type })
      .from(accounts)
      .where(
        and(
          eq(accounts.tenantId, tenantId),
          eq(accounts.isPostable, true),
          eq(accounts.isCashAccount, false),
          sql`COALESCE(${accounts.systemKey}, '') NOT IN ('AR', 'AP', 'INVENTORY', 'INVENTORY_SEMI')`,
        ),
      )
      .orderBy(asc(accounts.code));
  }
}
