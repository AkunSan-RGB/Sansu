import { Injectable } from '@nestjs/common';
import { NON_AIR_CHARGE_KEYS } from '@sansu/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { accounts, utilityCharges } from '../../db/schema';

@Injectable()
export class UtilityChargesRepository {
  list(db: DbOrTx, tenantId: string) {
    return db.select().from(utilityCharges).where(eq(utilityCharges.tenantId, tenantId)).orderBy(asc(utilityCharges.name));
  }
  /** Tagihan layanan non-air terbaru (bukan tagihan meter bulanan), lengkap dengan status pembayarannya */
  recentInvoices(db: DbOrTx, tenantId: string) {
    return db.execute<{ id: string; number: string; date: string; customer: string; service: string; total: string; paid: string; open: string; status: string }>(sql`
      SELECT i.id, i.number, i.date::text AS date, cu.name AS customer, string_agg(DISTINCT sl.description, '; ') AS service, i.total::text AS total, i.paid_amount::text AS paid,
             (i.total - i.paid_amount - i.returned_amount)::text AS open, i.status::text AS status
      FROM invoices i JOIN customers cu ON cu.id = i.customer_id JOIN service_invoice_lines sl ON sl.invoice_id = i.id JOIN accounts sa ON sa.id = sl.account_id
      WHERE i.tenant_id = ${tenantId} AND NOT EXISTS (SELECT 1 FROM utility_bills ub WHERE ub.invoice_id = i.id)
        AND sa.system_key IN (${sql.join(NON_AIR_CHARGE_KEYS.map((k) => sql`${k}`), sql`, `)})
      GROUP BY i.id, cu.name ORDER BY i.date DESC, i.number DESC LIMIT 30`);
  }
  byId(db: DbOrTx, tenantId: string, id: string) {
    return db.select().from(utilityCharges).where(and(eq(utilityCharges.tenantId, tenantId), eq(utilityCharges.id, id)));
  }
  insert(db: DbOrTx, rows: (typeof utilityCharges.$inferInsert)[]) {
    return db.insert(utilityCharges).values(rows).onConflictDoNothing().returning();
  }
  update(db: DbOrTx, tenantId: string, id: string, set: Partial<typeof utilityCharges.$inferInsert>) {
    return db.update(utilityCharges).set(set).where(and(eq(utilityCharges.tenantId, tenantId), eq(utilityCharges.id, id))).returning();
  }
  accountByKey(db: DbOrTx, tenantId: string, key: string) {
    return db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.systemKey, key)));
  }
}
