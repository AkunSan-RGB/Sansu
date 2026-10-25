import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { stockBalances, products, warehouses } from '../../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { StockQueryDto } from './dto/inventory.dto';

/** Akses data untuk Inventory: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class InventoryRepository {
  /** Dipakai oleh InventoryService.balances */
  listStockBalancesWithProductsAndWarehousesByWarehouseIdAndProductId(
    db: DbOrTx,
    tenantId: string,
    q: StockQueryDto,
    allowed: string[] | null,
  ) {
    return db
      .select({
        productId: stockBalances.productId,
        warehouseId: stockBalances.warehouseId,
        qty: stockBalances.qty,
        avgCost: stockBalances.avgCost,
        sku: products.sku,
        productName: products.name,
        baseUom: products.baseUom,
        warehouseCode: warehouses.code,
      })
      .from(stockBalances)
      .innerJoin(products, eq(products.id, stockBalances.productId))
      .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
      .where(
        and(
          eq(stockBalances.tenantId, tenantId),
          q.warehouseId
            ? eq(stockBalances.warehouseId, q.warehouseId)
            : allowed
              ? inArray(stockBalances.warehouseId, allowed)
              : undefined,
          q.productId ? eq(stockBalances.productId, q.productId) : undefined,
        ),
      )
      .orderBy(products.sku);
  }

  /** Dipakai oleh InventoryService.adjust */
  listProductsById(db: DbOrTx, tenantId: string, productIds: string[]) {
    return db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), inArray(products.id, productIds)));
  }

  /** Dipakai oleh InventoryService.adjust */
  listStockBalancesByWarehouseIdAndProductId(db: DbOrTx, tenantId: string, warehouseId: string, productIds: string[]) {
    return db
      .select({ productId: stockBalances.productId, avg: stockBalances.avgCost })
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.tenantId, tenantId),
          eq(stockBalances.warehouseId, warehouseId),
          inArray(stockBalances.productId, productIds),
        ),
      );
  }
}
