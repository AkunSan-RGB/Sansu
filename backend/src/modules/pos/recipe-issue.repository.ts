import { DbOrTx } from '../../db/db';
import { boms, stockBalances, bomLines } from '../../db/schema';
import { and, eq, inArray, desc } from 'drizzle-orm';

/** Dipakai oleh recipe-issue.recipesFor */
export function listBomsByIsActiveAndProductIdAndCreatedAt(
  db: DbOrTx,
  tenantId: NonNullable<(typeof boms.$inferSelect)['tenantId']>,
  menu: { id: string; sku: string }[],
) {
  return db
    .select()
    .from(boms)
    .where(
      and(
        eq(boms.tenantId, tenantId),
        eq(boms.isActive, true),
        inArray(
          boms.productId,
          menu.map((m) => m.id),
        ),
      ),
    )
    .orderBy(desc(boms.createdAt));
}

/** Dipakai oleh recipe-issue.portionsAvailable */
export function listStockBalancesByWarehouseIdAndProductId(
  db: DbOrTx,
  tenantId: NonNullable<(typeof stockBalances.$inferSelect)['tenantId']>,
  warehouseId: NonNullable<(typeof stockBalances.$inferSelect)['warehouseId']>,
  ids: NonNullable<(typeof stockBalances.$inferSelect)['productId']>[],
) {
  return db
    .select({ productId: stockBalances.productId, qty: stockBalances.qty })
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.tenantId, tenantId),
        eq(stockBalances.warehouseId, warehouseId),
        inArray(stockBalances.productId, ids),
      ),
    );
}

// ---- kueri yang dipindah dari berkas pemanggil ----
/** Dipakai oleh recipe-issue.recipesFor */
export function listBomLinesByBomId(db: DbOrTx, bomIds: NonNullable<(typeof bomLines.$inferSelect)['bomId']>[]) {
  return db.select().from(bomLines).where(inArray(bomLines.bomId, bomIds));
}
