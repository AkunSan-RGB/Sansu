import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, eq, asc, and, inArray } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import {
  stockTransferLines,
  products,
  users,
  stockCountLines,
  stockCounts,
  stockBalances,
  warehouses,
  stockMinimums,
} from '../../db/schema';

/** Akses data untuk WarehouseQuery: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class WarehouseQueryRepository {
  /** Dipakai oleh WarehouseQueryService.listTransfers */
  queryStockTransfer(db: DbOrTx, u: AuthUser, warehouseId: string | undefined, allowed: string[] | null) {
    return db.execute<Record<string, unknown>>(sql`
      SELECT t.id, t.number, t.date, t.notes, t.total_value AS "totalValue", t.created_at AS "createdAt",
             t.status, t.received_date AS "receivedDate",
             t.from_warehouse_id AS "fromWarehouseId", fw.code AS "fromCode", fw.name AS "fromName",
             t.to_warehouse_id AS "toWarehouseId", tw.code AS "toCode", tw.name AS "toName",
             (SELECT COUNT(*) FROM stock_transfer_lines l WHERE l.transfer_id = t.id)::int AS lines,
             u.name AS "createdBy"
      FROM stock_transfers t
      JOIN warehouses fw ON fw.id = t.from_warehouse_id
      JOIN warehouses tw ON tw.id = t.to_warehouse_id
      LEFT JOIN users u ON u.id = t.created_by_id
      WHERE t.tenant_id = ${u.tenantId}
        ${warehouseId ? sql`AND (t.from_warehouse_id = ${warehouseId} OR t.to_warehouse_id = ${warehouseId})` : sql``}
        ${allowed ? sql`AND (t.from_warehouse_id = ANY(${`{${allowed.join(',')}}`}::uuid[]) OR t.to_warehouse_id = ANY(${`{${allowed.join(',')}}`}::uuid[]))` : sql``}
      ORDER BY (t.status = 'IN_TRANSIT') DESC, t.date DESC, t.number DESC
      LIMIT 500`);
  }

  /** Dipakai oleh WarehouseQueryService.getTransfer */
  listStockTransferLinesWithProductsByTransferId(db: DbOrTx, id: string) {
    return db
      .select({
        productId: stockTransferLines.productId,
        sku: products.sku,
        name: products.name,
        baseUom: products.baseUom,
        qty: stockTransferLines.qty,
        unitCost: stockTransferLines.unitCost,
        receivedQty: stockTransferLines.receivedQty,
      })
      .from(stockTransferLines)
      .innerJoin(products, eq(products.id, stockTransferLines.productId))
      .where(eq(stockTransferLines.transferId, id))
      .orderBy(asc(products.sku));
  }

  /** Dipakai oleh WarehouseQueryService.getTransfer */
  listUsersById(db: DbOrTx, createdById: string) {
    return db.select({ name: users.name }).from(users).where(eq(users.id, createdById));
  }

  /** Dipakai oleh WarehouseQueryService.getTransfer */
  listUsersByIdForGetTransfer(db: DbOrTx, receivedById: string) {
    return db.select({ name: users.name }).from(users).where(eq(users.id, receivedById));
  }

  /** Dipakai oleh WarehouseQueryService.getCount */
  sumStockCountLinesWithProductsByCountId(db: DbOrTx, c: typeof stockCounts.$inferSelect, id: string) {
    return db
      .select({
        productId: stockCountLines.productId,
        sku: products.sku,
        name: products.name,
        category: products.category,
        baseUom: products.baseUom,
        systemQty: stockCountLines.systemQty,
        currentQty: c.binId
          ? sql<string>`COALESCE((SELECT SUM(b.qty) FROM stock_bin_balances b WHERE b.bin_id = ${c.binId} AND b.product_id = ${stockCountLines.productId}), 0)`
          : sql<string>`COALESCE(${stockBalances.qty}, 0)`,
        avgCost: sql<string>`COALESCE(${stockBalances.avgCost}, 0)`,
        countedQty: stockCountLines.countedQty,
        postedSystemQty: stockCountLines.postedSystemQty,
        difference: stockCountLines.difference,
      })
      .from(stockCountLines)
      .innerJoin(products, eq(products.id, stockCountLines.productId))
      .leftJoin(
        stockBalances,
        and(eq(stockBalances.productId, stockCountLines.productId), eq(stockBalances.warehouseId, c.warehouseId)),
      )
      .where(eq(stockCountLines.countId, id))
      .orderBy(asc(products.category), asc(products.sku));
  }

  /** Dipakai oleh WarehouseQueryService.getCount */
  queryWarehouseBin(db: DbOrTx, binId: string) {
    return db.execute<{ code: string }>(sql`SELECT code FROM warehouse_bins WHERE id = ${binId}`);
  }

  /** Dipakai oleh WarehouseQueryService.matrix */
  listWarehousesByIdAndCode(db: DbOrTx, tenantId: string, allowed: string[] | null) {
    return db
      .select({ id: warehouses.id, code: warehouses.code, name: warehouses.name, isActive: warehouses.isActive })
      .from(warehouses)
      .where(and(eq(warehouses.tenantId, tenantId), allowed ? inArray(warehouses.id, allowed) : undefined))
      .orderBy(asc(warehouses.code));
  }

  /** Dipakai oleh WarehouseQueryService.matrix */
  listStockBalancesByWarehouseId(db: DbOrTx, tenantId: string, ids: string[]) {
    return db
      .select({
        productId: stockBalances.productId,
        warehouseId: stockBalances.warehouseId,
        qty: stockBalances.qty,
        avgCost: stockBalances.avgCost,
      })
      .from(stockBalances)
      .where(and(eq(stockBalances.tenantId, tenantId), inArray(stockBalances.warehouseId, ids)));
  }

  /** Dipakai oleh WarehouseQueryService.matrix */
  listStockMinimumsByWarehouseId(db: DbOrTx, tenantId: string, ids: string[]) {
    return db
      .select({
        productId: stockMinimums.productId,
        warehouseId: stockMinimums.warehouseId,
        minQty: stockMinimums.minQty,
      })
      .from(stockMinimums)
      .where(and(eq(stockMinimums.tenantId, tenantId), inArray(stockMinimums.warehouseId, ids)));
  }

  /** Dipakai oleh WarehouseQueryService.matrix */
  listProductsByCategoryAndSku(db: DbOrTx, tenantId: string, opts: { includeZero?: boolean; category?: string }) {
    return db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        category: products.category,
        baseUom: products.baseUom,
        isActive: products.isActive,
      })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), opts.category ? eq(products.category, opts.category) : undefined))
      .orderBy(asc(products.sku));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh WarehouseQueryService.minimums */
  listProductsByIsActiveAndSku(
    db: DbOrTx,
    warehouseId: NonNullable<(typeof stockBalances.$inferSelect)['warehouseId']>,
    tenantId: NonNullable<(typeof products.$inferSelect)['tenantId']>,
  ) {
    return db
      .select({
        productId: products.id,
        sku: products.sku,
        name: products.name,
        category: products.category,
        baseUom: products.baseUom,
        qty: sql<string>`COALESCE(${stockBalances.qty}, 0)`,
        minQty: stockMinimums.minQty,
      })
      .from(products)
      .leftJoin(
        stockBalances,
        and(eq(stockBalances.productId, products.id), eq(stockBalances.warehouseId, warehouseId)),
      )
      .leftJoin(
        stockMinimums,
        and(eq(stockMinimums.productId, products.id), eq(stockMinimums.warehouseId, warehouseId)),
      )
      .where(and(eq(products.tenantId, tenantId), eq(products.isActive, true)))
      .orderBy(asc(products.sku));
  }
}
