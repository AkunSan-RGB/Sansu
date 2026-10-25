import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { tenants } from '../../db/schema';
import { eq, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

/** Akses data untuk Statements: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class StatementsRepository {
  /** Dipakai oleh StatementsService.framework */
  findTenantsById(db: DbOrTx, tenantId: NonNullable<(typeof tenants.$inferSelect)['id']>) {
    return db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  }

  /** Dipakai oleh StatementsService.cashDirect */
  queryJournalLine(db: DbOrTx, tenantId: string, from: string, to: string, brL: SQL<unknown>, brL2: SQL<unknown>) {
    return db.execute<{ journal_id: string; account_id: string; debit: string; credit: string }>(sql`
      SELECT l.journal_id, l.account_id, l.debit, l.credit
      FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
      WHERE j.tenant_id = ${tenantId} AND j.date BETWEEN ${from} AND ${to} AND j.source_type NOT IN ('CLOSING', 'OPENING') ${brL}
        AND EXISTS (SELECT 1 FROM journal_lines l2 JOIN accounts a2 ON a2.id = l2.account_id
                    WHERE l2.journal_id = j.id ${brL2} AND (a2.is_cash_account = true OR a2.report_group = 'CASH_EQUIVALENT'))`);
  }
}
