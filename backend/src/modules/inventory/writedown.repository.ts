import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { inventoryWritedowns, warehouses, users, products } from '../../db/schema';
import { eq, and, inArray, desc, sql } from 'drizzle-orm';

/** Akses data untuk Writedown: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class WritedownRepository {
  /** Dipakai oleh WritedownService.list */
  listInventoryWritedownsWithWarehousesAndUsersByWarehouseIdAndDateAndNumber(
    db: DbOrTx,
    tenantId: string,
    allowed: string[] | null,
  ) {
    return db
      .select({
        id: inventoryWritedowns.id,
        number: inventoryWritedowns.number,
        kind: inventoryWritedowns.kind,
        date: inventoryWritedowns.date,
        warehouseId: inventoryWritedowns.warehouseId,
        warehouseName: warehouses.name,
        reason: inventoryWritedowns.reason,
        lines: inventoryWritedowns.lines,
        total: inventoryWritedowns.total,
        journalId: inventoryWritedowns.journalId,
        createdByName: users.name,
        createdAt: inventoryWritedowns.createdAt,
      })
      .from(inventoryWritedowns)
      .innerJoin(warehouses, eq(warehouses.id, inventoryWritedowns.warehouseId))
      .leftJoin(users, eq(users.id, inventoryWritedowns.createdById))
      .where(
        and(
          eq(inventoryWritedowns.tenantId, tenantId),
          allowed ? inArray(inventoryWritedowns.warehouseId, allowed) : undefined,
        ),
      )
      .orderBy(desc(inventoryWritedowns.date), desc(inventoryWritedowns.number))
      .limit(300);
  }

  /** Dipakai oleh WritedownService.candidates */
  queryStockBalance(
    db: DbOrTx,
    tenantId: string,
    pct: number,
    warehouseId: string | undefined,
    allowed: string[] | null,
  ) {
    return db.execute<{
      product_id: string;
      sku: string;
      name: string;
      unit: string;
      warehouse_id: string;
      warehouse_name: string;
      qty: string;
      avg_cost: string;
      sell_price: string;
    }>(sql`
      SELECT b.product_id, p.sku, p.name, p.base_uom AS unit, b.warehouse_id, w.name AS warehouse_name,
             b.qty, b.avg_cost, p.sell_price
      FROM stock_balances b
      JOIN products p ON p.id = b.product_id
      JOIN warehouses w ON w.id = b.warehouse_id
      WHERE b.tenant_id = ${tenantId} AND b.qty > 0 AND p.sell_price > 0
        AND p.sell_price * (100 - ${pct}) / 100 < b.avg_cost
        ${warehouseId ? sql`AND b.warehouse_id = ${warehouseId}` : sql``}
        ${
          allowed
            ? sql`AND b.warehouse_id IN (${sql.join(
                allowed.map((a) => sql`${a}`),
                sql`, `,
              )})`
            : sql``
        }
      ORDER BY (b.avg_cost - p.sell_price * (100 - ${pct}) / 100) * b.qty DESC
      LIMIT 500`);
  }

  /** Dipakai oleh WritedownService.recoverable */
  queryStockBalanceForRecoverable(
    db: DbOrTx,
    tenantId: string,
    warehouseId: string | undefined,
    allowed: string[] | null,
  ) {
    return db.execute<{
      product_id: string;
      sku: string;
      name: string;
      unit: string;
      warehouse_id: string;
      warehouse_name: string;
      qty: string;
      avg_cost: string;
      writedown_unit: string;
      sell_price: string;
    }>(sql`
      SELECT b.product_id, p.sku, p.name, p.base_uom AS unit, b.warehouse_id, w.name AS warehouse_name,
             b.qty, b.avg_cost, b.writedown_unit, p.sell_price
      FROM stock_balances b
      JOIN products p ON p.id = b.product_id
      JOIN warehouses w ON w.id = b.warehouse_id
      WHERE b.tenant_id = ${tenantId} AND b.qty > 0 AND b.writedown_unit > 0
        ${warehouseId ? sql`AND b.warehouse_id = ${warehouseId}` : sql``}
        ${
          allowed
            ? sql`AND b.warehouse_id IN (${sql.join(
                allowed.map((a) => sql`${a}`),
                sql`, `,
              )})`
            : sql``
        }
      ORDER BY b.writedown_unit * b.qty DESC
      LIMIT 500`);
  }

  /** Dipakai oleh WritedownService.create */
  findWarehousesById(db: DbOrTx, warehouseId: string, tenantId: string) {
    return db
      .select({ id: warehouses.id, name: warehouses.name })
      .from(warehouses)
      .where(and(eq(warehouses.id, warehouseId), eq(warehouses.tenantId, tenantId)));
  }

  /** Dipakai oleh WritedownService.create */
  listProductsById(db: DbOrTx, tenantId: string, ids: string[]) {
    return db
      .select({ id: products.id, sku: products.sku, name: products.name, unit: products.baseUom })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), inArray(products.id, ids)));
  }
}
