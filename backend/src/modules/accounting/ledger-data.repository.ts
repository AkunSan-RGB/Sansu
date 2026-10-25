import { DbOrTx } from '../../db/db';
import { accounts } from '../../db/schema';
import { eq, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

/** Dipakai oleh ledger-data.loadAccounts */
export function listAccountsByCode(db: DbOrTx, tenantId: NonNullable<(typeof accounts.$inferSelect)['tenantId']>) {
  return db.select().from(accounts).where(eq(accounts.tenantId, tenantId)).orderBy(accounts.code);
}

/** Dipakai oleh ledger-data.sumByAccountRaw */
export function queryJournalLine(db: DbOrTx, conds: SQL<unknown>[]) {
  return db.execute<{ account_id: string; debit: string; credit: string }>(sql`
    SELECT l.account_id, SUM(l.debit) AS debit, SUM(l.credit) AS credit
    FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
    WHERE ${sql.join(conds, sql` AND `)}
    GROUP BY l.account_id`);
}
