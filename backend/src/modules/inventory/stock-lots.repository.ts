import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';
import { Dec, qty4 } from '../../common/utils/money';
import type { SQL } from 'drizzle-orm';

/** Dipakai oleh stock-lots.trackLots */
export function queryStockLot(
  db: DbOrTx,
  tenantId: string,
  productId: string,
  warehouseId: string,
  lotNo: string | null,
  expiryDate: string | null,
  date: string,
  q: Dec,
  refType: string,
  refId: string,
) {
  return db.execute<{ id: string }>(sql`
          INSERT INTO stock_lots (tenant_id, product_id, warehouse_id, lot_no, expiry_date, received_date, qty_received, qty_remaining, source_type, source_ref)
          VALUES (${tenantId}, ${productId}, ${warehouseId}, ${lotNo}, ${expiryDate}, ${date}, ${q.toFixed(4)}, ${q.toFixed(4)}, ${refType}, ${refId}) RETURNING id`);
}

/** Dipakai oleh stock-lots.trackLots */
export function queryStockLotTransit(db: DbOrTx, refId: string, productId: string) {
  return db.execute<{
    id: string;
    lot_no: string | null;
    expiry_date: string | null;
    received_date: string;
    qty_left: string;
  }>(sql`
        SELECT id, lot_no, expiry_date, received_date, qty_left FROM stock_lot_transit
        WHERE ref_id = ${refId} AND product_id = ${productId} AND qty_left > 0
        ORDER BY expiry_date NULLS LAST, id FOR UPDATE`);
}

/** Dipakai oleh stock-lots.trackLots */
export function queryStockLotForTrackLots(
  db: DbOrTx,
  tenantId: string,
  productId: string,
  warehouseId: string,
  lot_no: string | null,
  expiry_date: string | null,
  received_date: string,
  take: Dec,
  refType: 'STOCK_TRANSFER',
  refId: string,
) {
  return db.execute<{ id: string }>(sql`
          INSERT INTO stock_lots (tenant_id, product_id, warehouse_id, lot_no, expiry_date, received_date, qty_received, qty_remaining, source_type, source_ref)
          VALUES (${tenantId}, ${productId}, ${warehouseId}, ${lot_no}, ${expiry_date}, ${received_date}, ${take.toFixed(4)}, ${take.toFixed(4)}, ${refType}, ${refId}) RETURNING id`);
}

/** Dipakai oleh stock-lots.trackLots */
export function queryTrackLots(db: DbOrTx, left: Dec, take: Dec, id: string) {
  return db.execute(sql`UPDATE stock_lot_transit SET qty_left = ${qty4(left.minus(take)).toFixed(4)} WHERE id = ${id}`);
}

/** Dipakai oleh stock-lots.deplete */
export function queryStockLotForDeplete(db: DbOrTx, productId: string, warehouseId: string, extra: SQL<unknown>) {
  return db.execute<{
    id: string;
    lot_no: string | null;
    expiry_date: string | null;
    received_date: string;
    qty_remaining: string;
  }>(sql`
    SELECT id, lot_no, expiry_date, received_date, qty_remaining FROM stock_lots
    WHERE product_id = ${productId} AND warehouse_id = ${warehouseId} AND qty_remaining > 0 ${extra}
    ORDER BY expiry_date NULLS LAST, received_date, id FOR UPDATE`);
}

/** Dipakai oleh stock-lots.deplete */
export function queryDeplete(db: DbOrTx, have: Dec, take: Dec, id: string) {
  return db.execute(sql`UPDATE stock_lots SET qty_remaining = ${qty4(have.minus(take)).toFixed(4)} WHERE id = ${id}`);
}

/** Dipakai oleh stock-lots.deplete */
export function queryStockLotIssue(
  db: DbOrTx,
  tenantId: string,
  id: string,
  productId: string,
  warehouseId: string,
  take: Dec,
  type: string,
  refType: string,
  refId: string,
  date: string,
) {
  return db.execute(sql`
        INSERT INTO stock_lot_issues (tenant_id, lot_id, product_id, warehouse_id, qty, move_type, ref_type, ref_id, date)
        VALUES (${tenantId}, ${id}, ${productId}, ${warehouseId}, ${take.toFixed(4)}, ${type}, ${refType}, ${refId}, ${date})`);
}

/** Dipakai oleh stock-lots.deplete */
export function queryStockLotTransitForDeplete(
  db: DbOrTx,
  tenantId: string,
  refId: string,
  productId: string,
  lot_no: string | null,
  expiry_date: string | null,
  received_date: string,
  take: Dec,
) {
  return db.execute(sql`
        INSERT INTO stock_lot_transit (tenant_id, ref_id, product_id, lot_no, expiry_date, received_date, qty_left)
        VALUES (${tenantId}, ${refId}, ${productId}, ${lot_no}, ${expiry_date}, ${received_date}, ${take.toFixed(4)})`);
}
