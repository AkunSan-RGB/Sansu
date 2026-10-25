import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, eq, and, desc, inArray } from 'drizzle-orm';
import { cashCounts, accounts, users, journalEntries } from '../../db/schema';

/** Akses data untuk CashCount: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class CashCountRepository {
  /** Dipakai oleh CashCountService.bookBalance */
  queryJournalLine(db: DbOrTx, tenantId: string, accountId: string, date: string) {
    return db.execute<{ v: string }>(sql`
      SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
      WHERE j.tenant_id = ${tenantId} AND l.account_id = ${accountId} AND j.date <= ${date}`);
  }

  /** Dipakai oleh CashCountService.list */
  listCashCountsWithAccountsByAccountIdAndDateAndNumber(db: DbOrTx, tenantId: string, accountId: string | undefined) {
    return db
      .select({ c: cashCounts, code: accounts.code, name: accounts.name })
      .from(cashCounts)
      .innerJoin(accounts, eq(accounts.id, cashCounts.accountId))
      .where(and(eq(cashCounts.tenantId, tenantId), accountId ? eq(cashCounts.accountId, accountId) : undefined))
      .orderBy(desc(cashCounts.date), desc(cashCounts.number))
      .limit(300);
  }

  /** Dipakai oleh CashCountService.get */
  findCashCountsWithAccountsById(db: DbOrTx, id: string, tenantId: string) {
    return db
      .select({ c: cashCounts, code: accounts.code, name: accounts.name })
      .from(cashCounts)
      .innerJoin(accounts, eq(accounts.id, cashCounts.accountId))
      .where(and(eq(cashCounts.id, id), eq(cashCounts.tenantId, tenantId)));
  }

  /** Dipakai oleh CashCountService.get */
  listUsersById(db: DbOrTx, ids: string[]) {
    return db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  }

  /** Dipakai oleh CashCountService.get */
  listJournalEntriesById(db: DbOrTx, journalId: string) {
    return db.select({ number: journalEntries.number }).from(journalEntries).where(eq(journalEntries.id, journalId));
  }

  /** Dipakai oleh CashCountService.create */
  listCashCountsByAccountIdAndStatus(db: DbOrTx, accountId: string) {
    return db
      .select({ number: cashCounts.number })
      .from(cashCounts)
      .where(and(eq(cashCounts.accountId, accountId), inArray(cashCounts.status, ['DRAFT', 'WAITING_APPROVAL'])));
  }

  /** Dipakai oleh CashCountService.create */
  findCashCountsByAccountIdAndStatusAndDate(db: DbOrTx, accountId: string) {
    return db
      .select({ date: cashCounts.date, number: cashCounts.number })
      .from(cashCounts)
      .where(and(eq(cashCounts.accountId, accountId), eq(cashCounts.status, 'POSTED')))
      .orderBy(desc(cashCounts.date))
      .limit(1);
  }

  /** Dipakai oleh CashCountService.lock */
  queryCashCount(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<{ id: string }>(
      sql`SELECT id FROM cash_counts WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
  }

  /** Dipakai oleh CashCountService.lock */
  findCashCountsById(db: DbOrTx, id: string) {
    return db.select().from(cashCounts).where(eq(cashCounts.id, id));
  }

  /** Dipakai oleh CashCountService.post */
  findAccountsById(db: DbOrTx, accountId: string) {
    return db.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, accountId));
  }

  /** Dipakai oleh CashCountService.cancel */
  findCashCountsByAccountIdAndStatusAndDateForCancel(db: DbOrTx, accountId: string, date: string) {
    return db
      .select({ number: cashCounts.number })
      .from(cashCounts)
      .where(
        and(eq(cashCounts.accountId, accountId), eq(cashCounts.status, 'POSTED'), sql`${cashCounts.date} > ${date}`),
      )
      .limit(1);
  }
}
