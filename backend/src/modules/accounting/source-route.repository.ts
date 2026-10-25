import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';

/** Dipakai oleh source-route.resolveSourceRoutes */
export function queryPayment(db: DbOrTx, tenantId: string, paymentIds: string[]) {
  return db.execute<{ id: string; invoice_id: string }>(
    sql`SELECT id, invoice_id FROM payments WHERE tenant_id = ${tenantId} AND id IN (${sql.join(
      paymentIds.map((p) => sql`${p}`),
      sql`, `,
    )})`,
  );
}
