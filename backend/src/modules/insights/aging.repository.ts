import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

/** Dipakai oleh aging.openBalanceAging */
export function queryOpenBalanceAging(
  db: DbOrTx,
  to: string,
  doc: SQL<unknown>,
  party: SQL<unknown>,
  partyKey: SQL<unknown>,
  tenantId: string,
) {
  return db.execute<{ code: string; name: string; bucket: number; v: string }>(sql`
    SELECT p.code, p.name,
           CASE WHEN d.due_date >= ${to}::date THEN 0
                WHEN d.due_date >= (${to}::date - 30) THEN 1
                WHEN d.due_date >= (${to}::date - 60) THEN 2
                WHEN d.due_date >= (${to}::date - 90) THEN 3
                ELSE 4 END AS bucket,
           SUM(d.total - d.paid_amount - d.returned_amount) AS v
    FROM ${doc} d JOIN ${party} p ON p.id = d.${partyKey}
    WHERE d.tenant_id = ${tenantId} AND d.date <= ${to} AND d.status <> 'PAID'
    GROUP BY p.code, p.name, 3
    ORDER BY p.name`);
}
