import { DbOrTx } from '../../../db/db';
import { sql } from 'drizzle-orm';

/** Dipakai oleh category.categorySpellings */
export function queryProduct(db: DbOrTx, tenantId: string) {
  return db.execute<{ category: string; n: number }>(sql`
    SELECT category, COUNT(*)::int AS n FROM products WHERE tenant_id = ${tenantId} AND category IS NOT NULL AND btrim(category) <> ''
    GROUP BY category ORDER BY COUNT(*) DESC, category`);
}
