import { DbOrTx } from '../../db/db';
import { warehouses } from '../../db/schema';
import { and, eq, inArray } from 'drizzle-orm';

/** Dipakai oleh warehouse-ids.normalizeWarehouseIds */
export function listWarehousesById(
  db: DbOrTx,
  tenantId: NonNullable<(typeof warehouses.$inferSelect)['tenantId']>,
  uniq: NonNullable<(typeof warehouses.$inferSelect)['id']>[],
) {
  return db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), inArray(warehouses.id, uniq)));
}
