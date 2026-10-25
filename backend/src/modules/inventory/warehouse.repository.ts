import { Injectable } from '@nestjs/common';
import { eq, and, inArray, sql, or, isNull, isNotNull } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import {
  stockTransfers,
  products,
  warehouses,
  stockTransferLines,
  stockCounts,
  stockBalances,
  stockCountLines,
  stockMinimums,
} from '../../db/schema';
import { CreateTransferDto, CreateCountDto } from './warehouse-ops.dto';
import { type Dec, D } from '../../common/utils/money';
import type { CountLineDto } from './warehouse-ops.dto';

export const q4 = (v: string | number) => D(v).toFixed(4);

/** Akses data transfer gudang. */
@Injectable()
export class WarehouseRepository {
  async transferById(db: DbOrTx, id: string) {
    const [t] = await db.select().from(stockTransfers).where(eq(stockTransfers.id, id));
    return t;
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh WarehouseOpsService.createTransfer */
  listProductsById(db: DbOrTx, tenantId: string, ids: string[]) {
    return db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), inArray(products.id, ids)));
  }

  /** Dipakai oleh WarehouseOpsService.createTransfer */
  insertStockTransfers(
    db: DbOrTx,
    id: `${string}-${string}-${string}-${string}-${string}`,
    tenantId: string,
    number: string,
    date: string,
    fromId: string,
    to: typeof warehouses.$inferSelect,
    dto: CreateTransferDto,
    sub: string,
    transit: boolean,
  ) {
    return db.insert(stockTransfers).values({
      id: id,
      tenantId: tenantId,
      number: number,
      date: date,
      fromWarehouseId: fromId,
      toWarehouseId: to.id,
      notes: dto.notes ?? null,
      createdById: sub,
      status: transit ? 'IN_TRANSIT' : 'RECEIVED',
      ...(transit ? {} : { receivedDate: date, receivedAt: new Date(), receivedById: sub }),
    });
  }

  /** Dipakai oleh WarehouseOpsService.createTransfer */
  insertStockTransferLines(
    db: DbOrTx,
    id: `${string}-${string}-${string}-${string}-${string}`,
    productId: string,
    qty: Dec,
    unitCost: Dec,
    writedownUnit: Dec,
  ) {
    return db.insert(stockTransferLines).values({
      transferId: id,
      productId: productId,
      qty: qty.toFixed(4),
      unitCost: unitCost.toFixed(4),
      writedownUnit: writedownUnit.toFixed(4),
    });
  }

  /** Dipakai oleh WarehouseOpsService.createTransfer */
  insertStockTransferLinesForCreateTransfer(
    db: DbOrTx,
    id: `${string}-${string}-${string}-${string}-${string}`,
    productId: string,
    qty: Dec,
    unitCost: Dec,
    writedownUnit: Dec,
  ) {
    return db.insert(stockTransferLines).values({
      transferId: id,
      productId: productId,
      qty: qty.toFixed(4),
      unitCost: unitCost.toFixed(4),
      writedownUnit: writedownUnit.toFixed(4),
      receivedQty: qty.toFixed(4),
    });
  }

  /** Dipakai oleh WarehouseOpsService.lockTransit */
  queryStockTransfer(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<{ id: string }>(
      sql`SELECT id FROM stock_transfers WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
  }

  /** Dipakai oleh WarehouseOpsService.lockTransit */
  listStockTransferLinesByTransferId(db: DbOrTx, id: string) {
    return db.select().from(stockTransferLines).where(eq(stockTransferLines.transferId, id));
  }

  /** Dipakai oleh WarehouseOpsService.createCount */
  queryWarehouseBin(db: DbOrTx, binId: string, id: string, tenantId: string) {
    return db.execute<{ id: string }>(
      sql`SELECT id FROM warehouse_bins WHERE id = ${binId} AND warehouse_id = ${id} AND tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh WarehouseOpsService.createCount */
  findStockCountsByWarehouseIdAndStatusAndBinId(db: DbOrTx, tenantId: string, id: string, dto: CreateCountDto) {
    return db
      .select({ number: stockCounts.number })
      .from(stockCounts)
      .where(
        and(
          eq(stockCounts.tenantId, tenantId),
          eq(stockCounts.warehouseId, id),
          eq(stockCounts.status, 'DRAFT'),
          dto.binId ? or(isNull(stockCounts.binId), eq(stockCounts.binId, dto.binId)) : undefined,
        ),
      );
  }

  /** Dipakai oleh WarehouseOpsService.createCount */
  queryStockBinBalance(db: DbOrTx, dto: CreateCountDto, tenantId: string) {
    return db.execute<{ id: string; qty: string }>(sql`
              SELECT p.id, SUM(s.qty)::text AS qty FROM stock_bin_balances s JOIN products p ON p.id = s.product_id
              WHERE s.bin_id = ${dto.binId} AND s.qty > 0 AND p.tenant_id = ${tenantId} ${dto.category ? sql`AND p.category = ${dto.category}` : sql``}
              GROUP BY p.id`);
  }

  /** Dipakai oleh WarehouseOpsService.createCount */
  listProductsWithStockBalancesByIsActiveAndCategory(db: DbOrTx, id: string, tenantId: string, dto: CreateCountDto) {
    return db
      .select({ id: products.id, qty: sql<string>`COALESCE(${stockBalances.qty}, 0)` })
      .from(products)
      .leftJoin(stockBalances, and(eq(stockBalances.productId, products.id), eq(stockBalances.warehouseId, id)))
      .where(
        and(
          eq(products.tenantId, tenantId),
          or(eq(products.isActive, true), sql`COALESCE(${stockBalances.qty}, 0) <> 0`),
          dto.category ? eq(products.category, dto.category) : undefined,
        ),
      );
  }

  /** Dipakai oleh WarehouseOpsService.createCount */
  insertStockCounts(
    db: DbOrTx,
    id: `${string}-${string}-${string}-${string}-${string}`,
    tenantId: string,
    number: string,
    date: string,
    whId: string,
    dto: CreateCountDto,
    sub: string,
  ) {
    return db.insert(stockCounts).values({
      id: id,
      tenantId: tenantId,
      number: number,
      date: date,
      warehouseId: whId,
      binId: dto.binId ?? null,
      category: dto.category ?? null,
      notes: dto.notes ?? null,
      createdById: sub,
    });
  }

  /** Dipakai oleh WarehouseOpsService.postCount */
  sumStockCountLinesWithStockBalancesByCountIdAndCountedQty(
    db: DbOrTx,
    cur: typeof stockCounts.$inferSelect,
    id: string,
  ) {
    return db
      .select({
        counted: stockCountLines.countedQty,
        qty: cur.binId
          ? sql<string>`COALESCE((SELECT SUM(b.qty) FROM stock_bin_balances b WHERE b.bin_id = ${cur.binId} AND b.product_id = ${stockCountLines.productId}), 0)`
          : sql<string>`COALESCE(${stockBalances.qty}, 0)`,
        avg: sql<string>`COALESCE(${stockBalances.avgCost}, 0)`,
      })
      .from(stockCountLines)
      .leftJoin(
        stockBalances,
        and(eq(stockBalances.productId, stockCountLines.productId), eq(stockBalances.warehouseId, cur.warehouseId)),
      )
      .where(and(eq(stockCountLines.countId, id), isNotNull(stockCountLines.countedQty)));
  }

  /** Dipakai oleh WarehouseOpsService.postCountTx */
  sumStockCountLinesByCountIdAndCountedQty(db: DbOrTx, c: typeof stockCounts.$inferSelect, id: string) {
    return db
      .select({
        productId: stockCountLines.productId,
        countedQty: stockCountLines.countedQty,
        qty: c.binId
          ? sql<string>`COALESCE((SELECT SUM(b.qty) FROM stock_bin_balances b WHERE b.bin_id = ${c.binId} AND b.product_id = ${stockCountLines.productId}), 0)`
          : sql<string>`COALESCE(${stockBalances.qty}, 0)`,
        avgCost: sql<string>`COALESCE(${stockBalances.avgCost}, 0)`,
      })
      .from(stockCountLines)
      .leftJoin(
        stockBalances,
        and(eq(stockBalances.productId, stockCountLines.productId), eq(stockBalances.warehouseId, c.warehouseId)),
      )
      .where(and(eq(stockCountLines.countId, id), isNotNull(stockCountLines.countedQty)));
  }

  /** Dipakai oleh WarehouseOpsService.postCountTx */
  queryStockBinBalanceForPostCountTx(db: DbOrTx, binId: string, productId: string) {
    return db.execute<{ lot_id: string | null; qty: string }>(sql`
            SELECT s.lot_id, s.qty FROM stock_bin_balances s LEFT JOIN stock_lots l ON l.id = s.lot_id
            WHERE s.bin_id = ${binId} AND s.product_id = ${productId} AND s.qty > 0
            ORDER BY (s.lot_id IS NOT NULL), l.expiry_date NULLS LAST, l.received_date, s.id FOR UPDATE OF s`);
  }

  /** Dipakai oleh WarehouseOpsService.saveMinimums */
  listProductsByIdForSaveMinimums(db: DbOrTx, tenantId: string, ids: string[]) {
    return db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), inArray(products.id, ids)));
  }

  /** Dipakai oleh WarehouseOpsService.saveMinimums */
  deleteStockMinimumsByProductIdAndWarehouseId(db: DbOrTx, productId: string, warehouseId: string) {
    return db
      .delete(stockMinimums)
      .where(and(eq(stockMinimums.productId, productId), eq(stockMinimums.warehouseId, warehouseId)));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh WarehouseOpsService.createCount */
  insertStockCountLines(
    db: DbOrTx,
    rows: { id: string; qty: string }[],
    i: number,
    id: `${string}-${string}-${string}-${string}-${string}`,
  ) {
    return db
      .insert(stockCountLines)
      .values(rows.slice(i, i + 1000).map((r) => ({ countId: id, productId: r.id, systemQty: q4(r.qty) })));
  }

  /** Dipakai oleh WarehouseOpsService.updateCount */
  updateStockCountLinesByCountIdAndProductId(
    db: DbOrTx,
    l: CountLineDto,
    id: NonNullable<(typeof stockCountLines.$inferSelect)['countId']>,
  ) {
    return db
      .update(stockCountLines)
      .set({ countedQty: l.countedQty === null ? null : q4(l.countedQty) })
      .where(and(eq(stockCountLines.countId, id), eq(stockCountLines.productId, l.productId)));
  }

  /** Dipakai oleh WarehouseOpsService.postCountTx */
  updateStockCountLinesByCountIdAndProductIdForPostCountTx(
    db: DbOrTx,
    qty: string,
    diff: Dec,
    id: NonNullable<(typeof stockCountLines.$inferSelect)['countId']>,
    productId: NonNullable<(typeof stockCountLines.$inferSelect)['productId']>,
  ) {
    return db
      .update(stockCountLines)
      .set({ postedSystemQty: q4(qty), difference: diff.toFixed(4) })
      .where(and(eq(stockCountLines.countId, id), eq(stockCountLines.productId, productId)));
  }

  /** Dipakai oleh WarehouseOpsService.saveMinimums */
  insertStockMinimums(db: DbOrTx, tenantId: string, productId: string, warehouseId: string, minQty: string) {
    return db
      .insert(stockMinimums)
      .values({
        tenantId: tenantId,
        productId: productId,
        warehouseId: warehouseId,
        minQty: q4(minQty),
      })
      .onConflictDoUpdate({
        target: [stockMinimums.productId, stockMinimums.warehouseId],
        set: { minQty: q4(minQty) },
      });
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh WarehouseOpsService.ownCount */
  listStockCountsById(
    db: DbOrTx,
    id: NonNullable<(typeof stockCounts.$inferSelect)['id']>,
    tenantId: NonNullable<(typeof stockCounts.$inferSelect)['tenantId']>,
  ) {
    return db
      .select()
      .from(stockCounts)
      .where(and(eq(stockCounts.id, id), eq(stockCounts.tenantId, tenantId)));
  }
}
