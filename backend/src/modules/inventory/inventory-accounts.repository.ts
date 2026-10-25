import { DbOrTx } from '../../db/db';
import { products } from '../../db/schema';
import { and, eq, inArray } from 'drizzle-orm';

/** Dipakai oleh inventory-accounts.semiSet */
export function listProductsByInventoryKindAndId(
  db: DbOrTx,
  tenantId: NonNullable<(typeof products.$inferSelect)['tenantId']>,
  uniq: NonNullable<(typeof products.$inferSelect)['id']>[],
) {
  return db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), eq(products.inventoryKind, 'SEMI'), inArray(products.id, uniq)));
}
