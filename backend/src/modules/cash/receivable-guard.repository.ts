import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';

/** Dipakai oleh receivable-guard.findReceivableLookalike */
export function queryInvoice(db: Pick<DbOrTx, 'execute'>, tenantId: string, amount: number, t: string) {
  return db.execute<{ number: string; name: string; outstanding: string }>(sql`
    SELECT i.number, c.name, (i.total - i.paid_amount - i.returned_amount)::text AS outstanding
    FROM invoices i JOIN customers c ON c.id = i.customer_id
    WHERE i.tenant_id = ${tenantId} AND i.status <> 'PAID' AND i.is_opening = false AND (i.total - i.paid_amount - i.returned_amount) > 0.005
      AND (
        ABS((i.total - i.paid_amount - i.returned_amount) - ${amount}) < 0.005
        OR (length(c.name) >= 4 AND position(lower(c.name) in ${t}) > 0)
        OR position(lower(i.number) in ${t}) > 0
      )
    ORDER BY (ABS((i.total - i.paid_amount - i.returned_amount) - ${amount}) < 0.005) DESC, i.date DESC
    LIMIT 1`);
}
