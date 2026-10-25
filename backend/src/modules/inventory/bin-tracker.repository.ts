import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';
import { auditContext } from '../../common/audit/audit-context';
import { Dec } from '../../common/utils/money';
import type { SQL } from 'drizzle-orm';

/** Urutan prioritas rak saat mengambil barang (juga dipakai daftar ambil agar saran = pembukuan): simpan/penyiapan, lalu belum ditempatkan, lalu rusak/karantina */
export const BIN_PICK_TIER = sql`CASE b.kind WHEN 'STORAGE' THEN 0 WHEN 'STAGING' THEN 0 WHEN 'UNASSIGNED' THEN 1 ELSE 2 END`;

export const NO_LOT = '00000000-0000-0000-0000-000000000000';

export const actor = () => auditContext.getStore()?.user?.sub ?? null;

/** Dipakai oleh bin-tracker.logBinMove */
export function queryBinMove(
  db: DbOrTx,
  mValues: string,
  mMValues: string,
  mValues2: string,
  mValues3: string | null,
  mValues4: string | null,
  mValues5: string | null,
  mValues6: string,
  mValues7: string,
  mValues8: string | null | undefined,
  mValues9: string | null | undefined,
  mValues10: string | null | undefined,
) {
  return db.execute(sql`
    INSERT INTO bin_moves (tenant_id, warehouse_id, product_id, lot_id, from_bin_id, to_bin_id, qty, kind, ref_type, ref_id, note, created_by_id)
    VALUES (${mValues}, ${mMValues}, ${mValues2}, ${mValues3}, ${mValues4}, ${mValues5}, ${mValues6}, ${mValues7}, ${mValues8 ?? null}, ${mValues9 ?? null}, ${mValues10 ?? null}, ${actor()})`);
}

/** Dipakai oleh bin-tracker.addToBin */
export function queryStockBinBalance(
  db: DbOrTx,
  tenantId: string,
  warehouseId: string,
  binId: string,
  productId: string,
  lotId: string | null,
  qty: Dec,
) {
  return db.execute(sql`
    INSERT INTO stock_bin_balances (tenant_id, warehouse_id, bin_id, product_id, lot_id, qty)
    VALUES (${tenantId}, ${warehouseId}, ${binId}, ${productId}, ${lotId}, ${qty.toFixed(4)})
    ON CONFLICT (bin_id, product_id, (COALESCE(lot_id, ${NO_LOT}::uuid))) DO UPDATE SET qty = stock_bin_balances.qty + EXCLUDED.qty`);
}

/** Dipakai oleh bin-tracker.unassignedBinId */
export function queryWarehouseBin(db: DbOrTx, warehouseId: string) {
  return db.execute<{ id: string }>(
    sql`SELECT id FROM warehouse_bins WHERE warehouse_id = ${warehouseId} AND kind = 'UNASSIGNED'`,
  );
}

/** Dipakai oleh bin-tracker.takeFrom */
export function queryStockBinBalanceForTakeFrom(
  db: DbOrTx,
  warehouseId: string,
  productId: string,
  cond: SQL<unknown>,
  prefer: string | null,
) {
  return db.execute<{ id: string; bin_id: string; lot_id: string | null; qty: string }>(sql`
    SELECT s.id, s.bin_id, s.lot_id, s.qty FROM stock_bin_balances s JOIN warehouse_bins b ON b.id = s.bin_id
    WHERE s.warehouse_id = ${warehouseId} AND s.product_id = ${productId} AND s.qty > 0 AND ${cond}
    ORDER BY COALESCE(s.bin_id = ${prefer}::uuid, false) DESC,
             ${BIN_PICK_TIER},
             (s.lot_id IS NOT NULL) ASC, s.qty ASC, b.code, s.id
    FOR UPDATE OF s`);
}

/** Dipakai oleh bin-tracker.takeFrom */
export function queryTakeFrom(db: DbOrTx, have: Dec, take: Dec, id: string) {
  return db.execute(sql`UPDATE stock_bin_balances SET qty = ${have.minus(take).toFixed(4)} WHERE id = ${id}`);
}

/** Dipakai oleh bin-tracker.takeFrom */
export function queryStockBinBalanceForTakeFrom2(db: DbOrTx, id: string) {
  return db.execute(sql`DELETE FROM stock_bin_balances WHERE id = ${id} AND qty = 0`);
}

/** Dipakai oleh bin-tracker.trackBins */
export function queryWarehouse(db: DbOrTx, warehouseId: string) {
  return db.execute<{ enabled: boolean }>(
    sql`SELECT bins_enabled AS enabled FROM warehouses WHERE id = ${warehouseId} FOR SHARE`,
  );
}

/** Dipakai oleh bin-tracker.trackBins */
export function queryWarehouseBinForTrackBins(db: DbOrTx, binId: string, warehouseId: string, tenantId: string) {
  return db.execute<{ id: string; is_active: boolean; code: string }>(
    sql`SELECT id, is_active, code FROM warehouse_bins WHERE id = ${binId} AND warehouse_id = ${warehouseId} AND tenant_id = ${tenantId}`,
  );
}

/** Dipakai oleh bin-tracker.relabelAsLot */
export function queryStockBinBalanceForRelabelAsLot(db: DbOrTx, warehouseId: string, productId: string) {
  return db.execute<{ id: string; bin_id: string; qty: string }>(sql`
    SELECT s.id, s.bin_id, s.qty FROM stock_bin_balances s JOIN warehouse_bins b ON b.id = s.bin_id
    WHERE s.warehouse_id = ${warehouseId} AND s.product_id = ${productId} AND s.lot_id IS NULL AND s.qty > 0
    ORDER BY CASE b.kind WHEN 'UNASSIGNED' THEN 0 ELSE 1 END, s.qty DESC, s.id FOR UPDATE OF s`);
}
