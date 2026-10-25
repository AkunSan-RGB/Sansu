import { Injectable } from '@nestjs/common';
import { and, eq, sql, inArray, desc } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import {
  accounts,
  recurringJournals,
  scheduledReversals,
  journalLines,
  assetCategories,
  journalEntries,
  AccountType,
} from '../../db/schema';
import { UpdateAccountDto } from './dto/accounting.dto';
import { addDays } from '../../common/utils/dates';
import { Dec } from '../../common/utils/money';
import type { SQL } from 'drizzle-orm';

/** Akses data akuntansi: akun, jurnal berulang, dan pembalikan terjadwal. */
@Injectable()
export class AccountingRepository {
  async accountOfTenant(db: DbOrTx, tenantId: string, id: string) {
    const [a] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.tenantId, tenantId)));
    return a;
  }

  /** Kunci baris (FOR UPDATE) agar dua proses tidak menjalankan jurnal berulang yang sama */
  async recurringForUpdate(db: DbOrTx, tenantId: string, id: string) {
    const [r] = await db
      .select()
      .from(recurringJournals)
      .where(and(eq(recurringJournals.id, id), eq(recurringJournals.tenantId, tenantId)))
      .for('update');
    return r;
  }

  async scheduledReversalForUpdate(db: DbOrTx, id: string) {
    const [r] = await db.select().from(scheduledReversals).where(eq(scheduledReversals.id, id)).for('update');
    return r;
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh AccountingService.updateAccount */
  updateAccountsById(db: DbOrTx, dto: UpdateAccountDto, id: string) {
    return db.update(accounts).set(dto).where(eq(accounts.id, id)).returning();
  }

  /** Dipakai oleh AccountingService.deleteAccount */
  findJournalLinesByAccountId(db: DbOrTx, id: string) {
    return db.select({ id: journalLines.id }).from(journalLines).where(eq(journalLines.accountId, id)).limit(1);
  }

  /** Dipakai oleh AccountingService.deleteAccount */
  findAccountsByParentId(db: DbOrTx, id: string) {
    return db.select({ id: accounts.id }).from(accounts).where(eq(accounts.parentId, id)).limit(1);
  }

  /** Dipakai oleh AccountingService.deleteAccount */
  deleteAccountsById(db: DbOrTx, id: string) {
    return db.delete(accounts).where(eq(accounts.id, id));
  }

  /** Dipakai oleh AccountingService.createManualJournal */
  insertScheduledReversals(db: DbOrTx, tenantId: string, id: string, scheduledReversal: string, sub: string) {
    return db
      .insert(scheduledReversals)
      .values({ tenantId: tenantId, journalId: id, reverseOn: scheduledReversal, createdById: sub });
  }

  /** Dipakai oleh AccountingService.assertNotDuplicate */
  queryJournalEntry(db: DbOrTx, tenantId: string, date: string, total: Dec, ids: string[]) {
    return db.execute<{ number: string; date: string; description: string }>(sql`
      SELECT j.number, j.date::text AS date, j.description
      FROM journal_entries j
      WHERE j.tenant_id = ${tenantId} AND j.reversal_of_id IS NULL
        AND j.date BETWEEN ${addDays(date, -7)} AND ${addDays(date, 7)}
        AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = j.id)
        AND (SELECT COALESCE(SUM(l.debit), 0) FROM journal_lines l WHERE l.journal_id = j.id) = ${total.toFixed(2)}
        AND (SELECT array_agg(DISTINCT l.account_id) FROM journal_lines l WHERE l.journal_id = j.id) @> ${`{${ids.join(',')}}`}::uuid[]
        AND (SELECT array_agg(DISTINCT l.account_id) FROM journal_lines l WHERE l.journal_id = j.id) <@ ${`{${ids.join(',')}}`}::uuid[]
      ORDER BY j.date DESC LIMIT 3`);
  }

  /** Dipakai oleh AccountingService.reverseJournal */
  queryReverseJournal(db: DbOrTx, id: string) {
    return db.execute(
      sql`UPDATE bank_statement_lines SET status = 'UNMATCHED', journal_id = NULL, journal_line_id = NULL, matched_by = NULL WHERE status = 'CREATED' AND journal_id = ${id}`,
    );
  }

  /** Dipakai oleh AccountingService.openingBalance */
  listAccounts(db: DbOrTx, tenantId: string) {
    return db.select().from(accounts).where(eq(accounts.tenantId, tenantId));
  }

  /** Dipakai oleh AccountingService.assertNoControlAccounts */
  listAccountsById(db: DbOrTx, tenantId: string, ids: string[]) {
    return db
      .select()
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, ids)));
  }

  /** Dipakai oleh AccountingService.assertNoControlAccounts */
  listAssetCategories(db: DbOrTx, tenantId: string) {
    return db
      .select({ a: assetCategories.assetAccountId, b: assetCategories.accumulatedAccountId })
      .from(assetCategories)
      .where(eq(assetCategories.tenantId, tenantId));
  }

  /** Dipakai oleh AccountingService.assertNoControlAccounts */
  queryPettyCashFund(db: DbOrTx, tenantId: string) {
    return db.execute<{ account_id: string }>(
      sql`SELECT account_id FROM petty_cash_funds WHERE tenant_id = ${tenantId} AND status = 'ACTIVE'`,
    );
  }

  /** Dipakai oleh AccountingService.periodStatus */
  listJournalEntriesBySourceTypeAndDate(db: DbOrTx, tenantId: string) {
    return db
      .select({ year: journalEntries.sourceId, number: journalEntries.number, date: journalEntries.date })
      .from(journalEntries)
      .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceType, 'CLOSING')))
      .orderBy(desc(journalEntries.date));
  }

  /** Dipakai oleh AccountingService.closeYear */
  queryCloseYear(db: DbOrTx, tenantId: string) {
    return db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`close:${tenantId}`}))`);
  }

  /** Dipakai oleh AccountingService.closeYear */
  findJournalEntriesBySourceTypeAndSourceId(db: DbOrTx, tenantId: string, year: number) {
    return db
      .select({ number: journalEntries.number })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.tenantId, tenantId),
          eq(journalEntries.sourceType, 'CLOSING'),
          eq(journalEntries.sourceId, String(year)),
        ),
      );
  }

  /** Dipakai oleh AccountingService.closeYear */
  queryJournalLine(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ account_id: string; type: string; b: string | null; d: string; c: string }>(sql`
        SELECT l.account_id, a.type, l.branch_id::text AS b, SUM(l.debit) AS d, SUM(l.credit) AS c
        FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
        WHERE j.tenant_id = ${tenantId} AND j.date >= ${from} AND j.date <= ${to} AND j.source_type <> 'CLOSING' AND a.type IN ('REVENUE', 'EXPENSE')
        GROUP BY l.account_id, a.type, l.branch_id`);
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh AccountingService.listJournals */
  listScheduledReversalsByStatusAndJournalId(
    db: DbOrTx,
    tenantId: NonNullable<(typeof scheduledReversals.$inferSelect)['tenantId']>,
    ids: NonNullable<(typeof scheduledReversals.$inferSelect)['journalId']>[],
  ) {
    return db
      .select({ journalId: scheduledReversals.journalId, reverseOn: scheduledReversals.reverseOn })
      .from(scheduledReversals)
      .where(
        and(
          eq(scheduledReversals.tenantId, tenantId),
          eq(scheduledReversals.status, 'PENDING'),
          inArray(scheduledReversals.journalId, ids),
        ),
      );
  }

  /** Dipakai oleh AccountingService.reverseJournal */
  queryReverseJournalForReverseJournal(db: DbOrTx, idList: SQL<unknown>) {
    return db.execute<{ n: number }>(sql`
          SELECT (SELECT COUNT(*) FROM bank_statement_lines WHERE status = 'MATCHED' AND journal_line_id IN (${idList}))::int
               + (SELECT COUNT(*) FROM bank_line_extra_matches WHERE journal_line_id IN (${idList}))::int AS n`);
  }

  /** Dipakai oleh AccountingService.openingStatus */
  queryJournalLineForOpeningStatus(db: DbOrTx, tenantId: string, isOpening: SQL<unknown>) {
    return db.execute<{ component: string; amount: string; accounts: number }>(sql`
      SELECT CASE
          WHEN a.system_key = 'OPENING_EQUITY' THEN 'balancing'
          WHEN a.is_cash_account THEN 'cash'
          WHEN a.system_key = 'AR' THEN 'receivables'
          WHEN a.system_key = 'AP' THEN 'payables'
          WHEN a.system_key IN ('INVENTORY', 'INVENTORY_SEMI') THEN 'inventory'
          WHEN a.type = 'ASSET' THEN 'otherAssets'
          WHEN a.type = 'LIABILITY' THEN 'liabilities'
          WHEN a.type = 'EQUITY' THEN 'equity'
          ELSE 'profitLoss' END AS component,
        SUM(l.debit - l.credit)::text AS amount,
        COUNT(DISTINCT a.id)::int AS accounts
      FROM journal_lines l
      JOIN journal_entries j ON j.id = l.journal_id
      JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND ${isOpening} AND j.reversal_of_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = j.id)
      GROUP BY 1`);
  }

  /** Dipakai oleh AccountingService.openingStatus */
  queryOpeningStatus(db: DbOrTx, tenantId: string, isOpening: SQL<unknown>) {
    return db.execute<{
      opening_date: string | null;
      first_tx: string | null;
      before_count: number;
      assets: number;
      assets_cost: string | null;
    }>(sql`
      SELECT
        (SELECT MAX(j.date)::text FROM journal_entries j WHERE j.tenant_id = ${tenantId} AND ${isOpening}) AS opening_date,
        (SELECT MIN(j.date)::text FROM journal_entries j WHERE j.tenant_id = ${tenantId} AND NOT ${isOpening}
           AND j.source_type NOT IN ('CLOSING')) AS first_tx,
        (SELECT COUNT(*)::int FROM journal_entries j WHERE j.tenant_id = ${tenantId} AND NOT ${isOpening}
           AND j.source_type NOT IN ('CLOSING')
           AND j.date <= (SELECT MAX(o.date) FROM journal_entries o WHERE o.tenant_id = ${tenantId}
                           AND (o.source_type = 'OPENING' OR (o.source_type = 'STOCK_ADJUSTMENT' AND o.description LIKE '%(OPENING)%')))) AS before_count,
        (SELECT COUNT(*)::int FROM fixed_assets f WHERE f.tenant_id = ${tenantId} AND f.opening_accumulated::numeric > 0) AS assets,
        (SELECT SUM(f.cost)::text FROM fixed_assets f WHERE f.tenant_id = ${tenantId} AND f.opening_accumulated::numeric > 0) AS assets_cost`);
  }

  /** Dipakai oleh AccountingService.balances */
  queryAccount(
    db: DbOrTx,
    tenantId: string,
    fromCond: SQL<unknown>,
    toCond: SQL<unknown>,
    closingCond: SQL<unknown>,
    brCond: SQL<unknown>,
  ) {
    return db.execute<{ id: string; code: string; name: string; type: AccountType; debit: string; credit: string }>(sql`
      SELECT a.id, a.code, a.name, a.type,
             COALESCE(t.debit, 0) AS debit, COALESCE(t.credit, 0) AS credit
      FROM accounts a
      LEFT JOIN (
        SELECT l.account_id, SUM(l.debit) AS debit, SUM(l.credit) AS credit
        FROM journal_lines l
        JOIN journal_entries j ON j.id = l.journal_id
        WHERE j.tenant_id = ${tenantId} ${fromCond} ${toCond} ${closingCond} ${brCond}
        GROUP BY l.account_id
      ) t ON t.account_id = a.id
      WHERE a.tenant_id = ${tenantId} AND a.is_postable = true
      ORDER BY a.code`);
  }
}
