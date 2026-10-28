import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, eq } from 'drizzle-orm';
import { stockLayers, warehouses, products, stockMoves } from '../../db/schema';
import { Dec } from '../../common/utils/money';

/** Akses data untuk Stock: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class StockRepository {
  /** Dipakai oleh StockService.methodOf */
  queryTenant(db: DbOrTx, tenantId: string) {
    return db.execute<{ m: string | null }>(
      sql`SELECT settings->'inventory'->>'method' AS m FROM tenants WHERE id = ${tenantId}`,
    );
  }

  /** Dipakai oleh StockService.fifoLayers */
  queryStockLayer(db: DbOrTx, productId: string, warehouseId: string) {
    return db.execute<{ id: string; qty: string; unit_cost: string }>(sql`
      SELECT id, qty_remaining AS qty, unit_cost FROM stock_layers
      WHERE product_id = ${productId} AND warehouse_id = ${warehouseId} AND qty_remaining > 0
      ORDER BY received_date, created_at, id FOR UPDATE`);
  }

  /** Dipakai oleh StockService.fifoLayers */
  queryStockLayerForFifoLayers(db: DbOrTx, productId: string, warehouseId: string) {
    return db.execute(sql`DELETE FROM stock_layers WHERE product_id = ${productId} AND warehouse_id = ${warehouseId}`);
  }

  /** Dipakai oleh StockService.fifoLayers */
  insertStockLayers(db: DbOrTx, tenantId: string, productId: string, warehouseId: string, balQty: Dec, balAvg: Dec) {
    return db
      .insert(stockLayers)
      .values({
        tenantId: tenantId,
        productId: productId,
        warehouseId: warehouseId,
        receivedDate: '1970-01-01',
        qtyRemaining: balQty.toFixed(4),
        unitCost: balAvg.toFixed(4),
      })
      .returning({ id: stockLayers.id });
  }

  /** Dipakai oleh StockService.move */
  findWarehousesById(db: DbOrTx, warehouseId: string) {
    return db
      .select({ isActive: warehouses.isActive, name: warehouses.name })
      .from(warehouses)
      .where(eq(warehouses.id, warehouseId));
  }

  /** Dipakai oleh StockService.move: layanan tidak boleh punya stok */
  findProductServiceFlag(db: DbOrTx, productId: string) {
    return db.select({ isService: products.isService, sku: products.sku }).from(products).where(eq(products.id, productId));
  }

  /** Dipakai oleh StockService.move */
  findWarehousesByIdForMove(db: DbOrTx, warehouseId: string) {
    return db
      .select({ q: warehouses.isQuarantine, name: warehouses.name })
      .from(warehouses)
      .where(eq(warehouses.id, warehouseId));
  }

  /** Dipakai oleh StockService.move */
  queryStockBalance(db: DbOrTx, tenantId: string, productId: string, warehouseId: string) {
    return db.execute(sql`
      INSERT INTO stock_balances (tenant_id, product_id, warehouse_id, qty, avg_cost)
      VALUES (${tenantId}, ${productId}, ${warehouseId}, 0, 0)
      ON CONFLICT (product_id, warehouse_id) DO NOTHING`);
  }

  /** Dipakai oleh StockService.move */
  queryStockBalanceForMove(db: DbOrTx, productId: string, warehouseId: string) {
    return db.execute<{ qty: string; avg_cost: string; writedown_unit: string }>(sql`
      SELECT qty, avg_cost, writedown_unit FROM stock_balances
      WHERE product_id = ${productId} AND warehouse_id = ${warehouseId}
      FOR UPDATE`);
  }

  /** Dipakai oleh StockService.move */
  insertStockLayersForMove(
    db: DbOrTx,
    tenantId: string,
    productId: string,
    warehouseId: string,
    date: string,
    qty: Dec,
    unitCost: Dec,
  ) {
    return db.insert(stockLayers).values({
      tenantId: tenantId,
      productId: productId,
      warehouseId: warehouseId,
      receivedDate: date,
      qtyRemaining: qty.toFixed(4),
      unitCost: unitCost.toFixed(4),
    });
  }

  /** Dipakai oleh StockService.move */
  findProductsById(db: DbOrTx, productId: string) {
    return db.select({ sku: products.sku, name: products.name }).from(products).where(eq(products.id, productId));
  }

  /** Dipakai oleh StockService.move */
  queryStockLayerForMove(db: DbOrTx, productId: string, warehouseId: string) {
    return db.execute(
      sql`DELETE FROM stock_layers WHERE product_id = ${productId} AND warehouse_id = ${warehouseId} AND qty_remaining <= 0`,
    );
  }

  /** Dipakai oleh StockService.move */
  queryMove(db: DbOrTx, qty: Dec, id: string) {
    return db.execute(sql`UPDATE stock_layers SET qty_remaining = ${qty.toFixed(4)} WHERE id = ${id}`);
  }

  /** Dipakai oleh StockService.move */
  queryStockMove(db: DbOrTx, productId: string, warehouseId: string) {
    return db.execute<{ v: string }>(sql`
        SELECT COALESCE(SUM(writedown_value), 0) AS v FROM stock_moves WHERE product_id = ${productId} AND warehouse_id = ${warehouseId}`);
  }

  /** Dipakai oleh StockService.move */
  queryStockBalanceForMove2(
    db: DbOrTx,
    balanceAfter: Dec,
    newAvg: Dec,
    newWu: Dec,
    productId: string,
    warehouseId: string,
  ) {
    return db.execute(sql`
      UPDATE stock_balances SET qty = ${balanceAfter.toFixed(4)}, avg_cost = ${newAvg.toFixed(4)}, writedown_unit = ${newWu.toFixed(4)}
      WHERE product_id = ${productId} AND warehouse_id = ${warehouseId}`);
  }

  /** Dipakai oleh StockService.revalue */
  queryStockBalanceForRevalue(db: DbOrTx, tenantId: string, productId: string, warehouseId: string) {
    return db.execute<{ qty: string; avg_cost: string; writedown_unit: string }>(sql`
      SELECT qty, avg_cost, writedown_unit FROM stock_balances
      WHERE tenant_id = ${tenantId} AND product_id = ${productId} AND warehouse_id = ${warehouseId}
      FOR UPDATE`);
  }

  /** Dipakai oleh StockService.revalue */
  queryStockBalanceForRevalue2(db: DbOrTx, newCost: Dec, newWu: Dec, productId: string, warehouseId: string) {
    return db.execute(sql`
      UPDATE stock_balances SET avg_cost = ${newCost.toFixed(4)}, writedown_unit = ${newWu.toFixed(4)}
      WHERE product_id = ${productId} AND warehouse_id = ${warehouseId}`);
  }

  /** Dipakai oleh StockService.revalue */
  queryStockLayerForRevalue(db: DbOrTx, newCost: Dec, oldCost: Dec, productId: string, warehouseId: string) {
    return db.execute(sql`
        UPDATE stock_layers SET unit_cost = round(unit_cost * ${newCost.toFixed(4)}::numeric / ${oldCost.toFixed(4)}::numeric, 4)
        WHERE product_id = ${productId} AND warehouse_id = ${warehouseId}`);
  }

  /** Dipakai oleh StockService.revalue */
  insertStockMoves(
    db: DbOrTx,
    tenantId: string,
    productId: string,
    warehouseId: string,
    newCost: Dec,
    qty: Dec,
    wdValue: Dec,
    refType: string,
    refId: string,
    refNumber: string | undefined,
    date: string,
  ) {
    return db.insert(stockMoves).values({
      tenantId: tenantId,
      productId: productId,
      warehouseId: warehouseId,
      type: 'REVALUATION',
      qty: '0',
      unitCost: newCost.toFixed(4),
      balanceAfter: qty.toFixed(4),
      writedownValue: wdValue.toFixed(2),
      refType: refType,
      refId: refId,
      refNumber: refNumber,
      date: date,
    });
  }

  /** Dipakai oleh StockService.adjustCost */
  queryStockBalanceForAdjustCost(db: DbOrTx, tenantId: string, productId: string, warehouseId: string) {
    return db.execute<{ qty: string; avg_cost: string }>(sql`
      SELECT qty, avg_cost FROM stock_balances
      WHERE tenant_id = ${tenantId} AND product_id = ${productId} AND warehouse_id = ${warehouseId}
      FOR UPDATE`);
  }

  /** Dipakai oleh StockService.adjustCost */
  queryStockLayerForAdjustCost(db: DbOrTx, newCost: Dec, oldCost: Dec, productId: string, warehouseId: string) {
    return db.execute(sql`
      UPDATE stock_layers SET unit_cost = GREATEST(0, unit_cost + ${newCost.minus(oldCost).toFixed(4)}::numeric)
      WHERE product_id = ${productId} AND warehouse_id = ${warehouseId}`);
  }

  /** Dipakai oleh StockService.adjustCost */
  queryStockLayerForAdjustCost2(db: DbOrTx, productId: string, warehouseId: string) {
    return db.execute<{ q: string; v: string }>(sql`
      SELECT COALESCE(SUM(qty_remaining), 0) AS q, COALESCE(SUM(qty_remaining * unit_cost), 0) AS v FROM stock_layers
      WHERE product_id = ${productId} AND warehouse_id = ${warehouseId} AND qty_remaining > 0`);
  }

  /** Dipakai oleh StockService.adjustCost */
  queryStockBalanceForAdjustCost2(db: DbOrTx, newCost: Dec, productId: string, warehouseId: string) {
    return db.execute(sql`
      UPDATE stock_balances SET avg_cost = ${newCost.toFixed(4)}
      WHERE product_id = ${productId} AND warehouse_id = ${warehouseId}`);
  }

  /** Dipakai oleh StockService.adjustCost */
  insertStockMovesForAdjustCost(
    db: DbOrTx,
    tenantId: string,
    productId: string,
    warehouseId: string,
    newCost: Dec,
    qty: Dec,
    refType: string,
    refId: string,
    refNumber: string | undefined,
    date: string,
  ) {
    return db.insert(stockMoves).values({
      tenantId: tenantId,
      productId: productId,
      warehouseId: warehouseId,
      type: 'REVALUATION',
      qty: '0',
      unitCost: newCost.toFixed(4),
      balanceAfter: qty.toFixed(4),
      writedownValue: '0',
      refType: refType,
      refId: refId,
      refNumber: refNumber,
      date: date,
    });
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh StockService.move */
  queryMoveForMove(db: DbOrTx, kept: Map<string, Dec>, id: string) {
    return db.execute(sql`UPDATE stock_layers SET qty_remaining = ${kept.get(id)!.toFixed(4)} WHERE id = ${id}`);
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh StockService.move */
  insertStockMovesForMove(db: DbOrTx, values: typeof stockMoves.$inferInsert) {
    return db.insert(stockMoves).values(values);
  }
}
