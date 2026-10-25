import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';
import { UNASSIGNED_CODE, BIN_PICK_TIER } from './bin-tracker';
import { CreateBinsDto, UpdateBinDto } from './bins.dto';
import { AuthUser } from '../../common/auth/auth-user';
import { BinStockQuery } from './bins.shared';
import { Dec } from '../../common/utils/money';
import type { BinMoveLineDto } from './bins.dto';
import type { SQL } from 'drizzle-orm';

export const HEAVY_MOVES = 30;

export const MAX_ROWS = 500;

/** Akses data untuk Bins: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class BinsRepository {
  /** Dipakai oleh BinsService.warehouse */
  queryWarehouse(db: DbOrTx, lock: boolean, id: string, tenantId: string) {
    return db.execute<{
      id: string;
      code: string;
      name: string;
      kind: string;
      is_quarantine: boolean;
      is_active: boolean;
      bins_enabled: boolean;
    }>(
      lock
        ? sql`SELECT id, code, name, kind, is_quarantine, is_active, bins_enabled FROM warehouses WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`
        : sql`SELECT id, code, name, kind, is_quarantine, is_active, bins_enabled FROM warehouses WHERE id = ${id} AND tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh BinsService.bin */
  queryWarehouseBin(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<{ id: string; warehouse_id: string; code: string; kind: string; is_active: boolean }>(
      sql`SELECT id, warehouse_id, code, kind, is_active FROM warehouse_bins WHERE id = ${id} AND tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh BinsService.warehouses */
  queryWarehouseForWarehouses(db: DbOrTx, tenantId: string, allowed: string[] | null) {
    return db.execute(sql`
      SELECT w.id, w.code, w.name, w.bins_enabled AS "binsEnabled", w.kind, w.is_quarantine AS "isQuarantine",
             (SELECT COUNT(*)::int FROM warehouse_bins b WHERE b.warehouse_id = w.id AND b.kind <> 'UNASSIGNED' AND b.is_active) AS "binCount"
      FROM warehouses w WHERE w.tenant_id = ${tenantId} AND w.is_active
        ${
          allowed
            ? sql`AND w.id IN (${sql.join(
                allowed.map((a) => sql`${a}::uuid`),
                sql`, `,
              )})`
            : sql``
        }
      ORDER BY w.code`);
  }

  /** Dipakai oleh BinsService.list */
  queryWarehouseBinForList(db: DbOrTx, tenantId: string, warehouseId: string) {
    return db.execute(sql`
      SELECT b.id, b.code, b.zone, b.name, b.kind, b.is_active AS "isActive",
             COALESCE(SUM(s.qty), 0) AS qty, COUNT(DISTINCT s.product_id)::int AS products
      FROM warehouse_bins b LEFT JOIN stock_bin_balances s ON s.bin_id = b.id
      WHERE b.tenant_id = ${tenantId} AND b.warehouse_id = ${warehouseId}
      GROUP BY b.id ORDER BY (b.kind = 'UNASSIGNED') DESC, b.zone NULLS LAST, b.code`);
  }

  /** Dipakai oleh BinsService.activate */
  queryWarehouseBinForActivate(db: DbOrTx, warehouseId: string) {
    return db.execute<{ id: string }>(
      sql`SELECT id FROM warehouse_bins WHERE warehouse_id = ${warehouseId} AND kind = 'UNASSIGNED'`,
    );
  }

  /** Dipakai oleh BinsService.activate */
  queryWarehouseBinForActivate2(db: DbOrTx, tenantId: string, warehouseId: string, sub: string) {
    return db.execute<{ id: string }>(
      sql`INSERT INTO warehouse_bins (tenant_id, warehouse_id, code, name, kind, created_by_id) VALUES (${tenantId}, ${warehouseId}, ${UNASSIGNED_CODE}, 'Belum ditempatkan', 'UNASSIGNED', ${sub}) RETURNING id`,
    );
  }

  /** Dipakai oleh BinsService.activate */
  queryStockBalance(db: DbOrTx, warehouseId: string) {
    return db.execute(sql`SELECT 1 FROM stock_balances WHERE warehouse_id = ${warehouseId} AND qty > 0 FOR UPDATE`);
  }

  /** Dipakai oleh BinsService.activate */
  queryStockBinBalance(db: DbOrTx, warehouseId: string, tenantId: string, uid: string) {
    return db.execute(sql`
        WITH l AS (
          SELECT sl.id, sl.product_id, sl.qty_remaining, sb.qty AS bal,
                 SUM(sl.qty_remaining) OVER (PARTITION BY sl.product_id ORDER BY sl.expiry_date NULLS LAST, sl.received_date, sl.id) AS run
          FROM stock_lots sl JOIN stock_balances sb ON sb.product_id = sl.product_id AND sb.warehouse_id = sl.warehouse_id
          WHERE sl.warehouse_id = ${warehouseId} AND sl.qty_remaining > 0 AND sb.qty > 0)
        INSERT INTO stock_bin_balances (tenant_id, warehouse_id, bin_id, product_id, lot_id, qty)
        SELECT ${tenantId}, ${warehouseId}, ${uid}, product_id, id, LEAST(qty_remaining, bal - (run - qty_remaining))
        FROM l WHERE bal - (run - qty_remaining) > 0`);
  }

  /** Dipakai oleh BinsService.activate */
  queryStockBinBalanceForActivate(db: DbOrTx, tenantId: string, warehouseId: string, uid: string) {
    return db.execute(sql`
        INSERT INTO stock_bin_balances (tenant_id, warehouse_id, bin_id, product_id, lot_id, qty)
        SELECT ${tenantId}, ${warehouseId}, ${uid}, sb.product_id, NULL,
               sb.qty - COALESCE((SELECT SUM(x.qty) FROM stock_bin_balances x WHERE x.warehouse_id = ${warehouseId} AND x.product_id = sb.product_id), 0)
        FROM stock_balances sb
        WHERE sb.warehouse_id = ${warehouseId} AND sb.qty > 0
          AND sb.qty - COALESCE((SELECT SUM(x.qty) FROM stock_bin_balances x WHERE x.warehouse_id = ${warehouseId} AND x.product_id = sb.product_id), 0) > 0`);
  }

  /** Dipakai oleh BinsService.activate */
  queryBinMove(db: DbOrTx, tenantId: string, warehouseId: string, uid: string, sub: string) {
    return db.execute(sql`
        INSERT INTO bin_moves (tenant_id, warehouse_id, product_id, lot_id, from_bin_id, to_bin_id, qty, kind, note, created_by_id)
        SELECT ${tenantId}, ${warehouseId}, product_id, lot_id, NULL, ${uid}, qty, 'SEED', 'Stok awal saat lokasi rak diaktifkan', ${sub}
        FROM stock_bin_balances WHERE bin_id = ${uid}`);
  }

  /** Dipakai oleh BinsService.activate */
  queryActivate(db: DbOrTx, warehouseId: string) {
    return db.execute(sql`UPDATE warehouses SET bins_enabled = true WHERE id = ${warehouseId}`);
  }

  /** Dipakai oleh BinsService.deactivate */
  queryStockBinBalanceForDeactivate(db: DbOrTx, warehouseId: string) {
    return db.execute<{ code: string }>(sql`
        SELECT b.code FROM stock_bin_balances s JOIN warehouse_bins b ON b.id = s.bin_id
        WHERE s.warehouse_id = ${warehouseId} AND b.kind <> 'UNASSIGNED' AND s.qty > 0 GROUP BY b.code ORDER BY b.code LIMIT 3`);
  }

  /** Dipakai oleh BinsService.deactivate */
  queryStockBinBalanceForDeactivate2(db: DbOrTx, warehouseId: string) {
    return db.execute(sql`DELETE FROM stock_bin_balances WHERE warehouse_id = ${warehouseId}`);
  }

  /** Dipakai oleh BinsService.deactivate */
  queryDeactivate(db: DbOrTx, warehouseId: string) {
    return db.execute(sql`UPDATE warehouses SET bins_enabled = false WHERE id = ${warehouseId}`);
  }

  /** Dipakai oleh BinsService.createBins */
  queryWarehouseBinForCreateBins(db: DbOrTx, warehouseId: string, codes: string[]) {
    return db.execute<{ code: string }>(
      sql`SELECT code FROM warehouse_bins WHERE warehouse_id = ${warehouseId} AND code IN (${sql.join(
        codes.map((c) => sql`${c}`),
        sql`, `,
      )})`,
    );
  }

  /** Dipakai oleh BinsService.createBins */
  queryWarehouseBinForCreateBins2(db: DbOrTx, tenantId: string, dto: CreateBinsDto, code: string, sub: string) {
    return db.execute(
      sql`INSERT INTO warehouse_bins (tenant_id, warehouse_id, code, zone, kind, created_by_id) VALUES (${tenantId}, ${dto.warehouseId}, ${code}, ${dto.zone?.trim() || null}, ${dto.kind ?? 'STORAGE'}, ${sub})`,
    );
  }

  /** Dipakai oleh BinsService.importBins */
  queryWarehouseBinForImportBins(db: DbOrTx, warehouseId: string) {
    return db.execute<{ code: string }>(sql`SELECT code FROM warehouse_bins WHERE warehouse_id = ${warehouseId}`);
  }

  /** Dipakai oleh BinsService.importBins */
  queryWarehouseBinForImportBins2(
    db: DbOrTx,
    tenantId: string,
    warehouseId: string,
    code: string,
    zone: string | null,
    name: string | null,
    kind: 'DAMAGED' | 'STORAGE' | 'STAGING' | 'QUARANTINE',
    sub: string,
  ) {
    return db.execute(
      sql`INSERT INTO warehouse_bins (tenant_id, warehouse_id, code, zone, name, kind, created_by_id) VALUES (${tenantId}, ${warehouseId}, ${code}, ${zone}, ${name}, ${kind}, ${sub}) ON CONFLICT (tenant_id, warehouse_id, code) DO NOTHING`,
    );
  }

  /** Dipakai oleh BinsService.updateBin */
  queryStockBinBalanceForUpdateBin(db: DbOrTx, id: string) {
    return db.execute(sql`SELECT 1 FROM stock_bin_balances WHERE bin_id = ${id} AND qty > 0 LIMIT 1`);
  }

  /** Dipakai oleh BinsService.updateBin */
  queryWarehouseBinForUpdateBin(db: DbOrTx, dto: UpdateBinDto, is_active: boolean, id: string, u: AuthUser) {
    return db.execute(sql`
        UPDATE warehouse_bins SET name = ${dto.name === undefined ? sql`name` : dto.name.trim() || null}, zone = ${dto.zone === undefined ? sql`zone` : dto.zone.trim() || null}, is_active = ${dto.isActive ?? is_active}
        WHERE id = ${id} AND tenant_id = ${u.tenantId}`);
  }

  /** Dipakai oleh BinsService.history */
  queryBinMoveForHistory(db: DbOrTx, u: AuthUser, q: BinStockQuery, allowed: string[] | null) {
    return db.execute(sql`
      SELECT m.id, m.created_at AS "createdAt", m.kind, m.qty, p.sku, p.name, l.lot_no AS "lotNo", fb.code AS "fromCode", tb.code AS "toCode",
             m.ref_type AS "refType", m.note, usr.name AS "by"
      FROM bin_moves m
      JOIN products p ON p.id = m.product_id
      LEFT JOIN stock_lots l ON l.id = m.lot_id
      LEFT JOIN warehouse_bins fb ON fb.id = m.from_bin_id
      LEFT JOIN warehouse_bins tb ON tb.id = m.to_bin_id
      LEFT JOIN users usr ON usr.id = m.created_by_id
      WHERE m.tenant_id = ${u.tenantId}
        ${
          q.warehouseId
            ? sql`AND m.warehouse_id = ${q.warehouseId}`
            : allowed
              ? sql`AND m.warehouse_id IN (${sql.join(
                  allowed.map((a) => sql`${a}::uuid`),
                  sql`, `,
                )})`
              : sql``
        }
        ${q.binId ? sql`AND (m.from_bin_id = ${q.binId} OR m.to_bin_id = ${q.binId})` : sql``}
        ${q.productId ? sql`AND m.product_id = ${q.productId}` : sql``}
      ORDER BY m.created_at DESC, m.id DESC LIMIT 200`);
  }

  /** Dipakai oleh BinsService.move */
  queryStockBalanceForMove(db: DbOrTx, productId: string, warehouseId: string) {
    return db.execute<{ avg_cost: string }>(
      sql`SELECT avg_cost FROM stock_balances WHERE product_id = ${productId} AND warehouse_id = ${warehouseId}`,
    );
  }

  /** Dipakai oleh BinsService.move */
  queryWarehouseBinForMove(db: DbOrTx, id: string, warehouseId: string, tenantId: string) {
    return db.execute<{ id: string; code: string; kind: string; is_active: boolean }>(
      sql`SELECT id, code, kind, is_active FROM warehouse_bins WHERE id = ${id} AND warehouse_id = ${warehouseId} AND tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh BinsService.move */
  queryStockBalanceForMove2(db: DbOrTx, productId: string, warehouseId: string) {
    return db.execute(
      sql`SELECT 1 FROM stock_balances WHERE product_id = ${productId} AND warehouse_id = ${warehouseId} FOR UPDATE`,
    );
  }

  /** Dipakai oleh BinsService.move */
  queryProduct(db: DbOrTx, productId: string, tenantId: string) {
    return db.execute<{ sku: string }>(
      sql`SELECT sku FROM products WHERE id = ${productId} AND tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh BinsService.move */
  queryMove(db: DbOrTx, have: Dec, qty: Dec, id: string) {
    return db.execute(sql`UPDATE stock_bin_balances SET qty = ${have.minus(qty).toFixed(4)} WHERE id = ${id}`);
  }

  /** Dipakai oleh BinsService.move */
  queryStockBinBalanceForMove(db: DbOrTx, id: string) {
    return db.execute(sql`DELETE FROM stock_bin_balances WHERE id = ${id} AND qty = 0`);
  }

  /** Dipakai oleh BinsService.pickPlan */
  querySalesOrder(db: DbOrTx, salesOrderId: string, tenantId: string) {
    return db.execute<{ id: string; number: string; warehouse_id: string }>(
      sql`SELECT id, number, warehouse_id FROM sales_orders WHERE id = ${salesOrderId} AND tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh BinsService.pickPlan */
  querySalesOrderLine(db: DbOrTx, salesOrderId: string) {
    return db.execute<{ product_id: string; base: string }>(sql`
        SELECT sol.product_id, SUM((sol.qty - COALESCE(dl.q, 0)) * sol.uom_factor)::text AS base
        FROM sales_order_lines sol
        LEFT JOIN (SELECT x.order_line_id, SUM(x.qty) AS q FROM delivery_order_lines x JOIN delivery_orders d ON d.id = x.delivery_id WHERE d.sales_order_id = ${salesOrderId} AND d.status = 'DELIVERED' GROUP BY x.order_line_id) dl ON dl.order_line_id = sol.id
        WHERE sol.order_id = ${salesOrderId} GROUP BY sol.product_id HAVING SUM((sol.qty - COALESCE(dl.q, 0)) * sol.uom_factor) > 0`);
  }

  /** Dipakai oleh BinsService.pickPlan */
  queryProductForPickPlan(db: DbOrTx, productId: string, tenantId: string) {
    return db.execute<{ sku: string; name: string; base_uom: string }>(
      sql`SELECT sku, name, base_uom FROM products WHERE id = ${productId} AND tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh BinsService.pickPlan */
  queryStockBinBalanceForPickPlan(db: DbOrTx, warehouseId: string, productId: string) {
    return db.execute<{
      bin_id: string;
      code: string;
      zone: string | null;
      kind: string;
      lot_id: string | null;
      lot_no: string | null;
      expiry_date: string | null;
      qty: string;
    }>(sql`
        SELECT s.bin_id, b.code, b.zone, b.kind, s.lot_id, l.lot_no, l.expiry_date, s.qty
        FROM stock_bin_balances s JOIN warehouse_bins b ON b.id = s.bin_id LEFT JOIN stock_lots l ON l.id = s.lot_id
        WHERE s.warehouse_id = ${warehouseId} AND s.product_id = ${productId} AND s.qty > 0 AND b.kind IN ('STORAGE', 'STAGING', 'UNASSIGNED')
        ORDER BY (s.lot_id IS NULL), l.expiry_date NULLS LAST, l.received_date, l.id, ${BIN_PICK_TIER}, s.qty, b.code`);
  }

  /** Dipakai oleh BinsService.controls */
  queryStockBalanceForControls(db: DbOrTx, id: string) {
    return db.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM stock_balances sb
        FULL JOIN (SELECT product_id, SUM(qty) AS s FROM stock_bin_balances WHERE warehouse_id = ${id} GROUP BY product_id) x ON x.product_id = sb.product_id AND sb.warehouse_id = ${id}
        WHERE (sb.warehouse_id = ${id} OR sb.warehouse_id IS NULL) AND COALESCE(sb.qty, 0) <> COALESCE(x.s, 0)`);
  }

  /** Dipakai oleh BinsService.check */
  queryStockBalanceForCheck(db: DbOrTx, warehouseId: string) {
    return db.execute(sql`
      SELECT p.sku, p.name, COALESCE(sb.qty, 0) AS balance, COALESCE(x.s, 0) AS binned
      FROM stock_balances sb
      FULL JOIN (SELECT product_id, SUM(qty) AS s FROM stock_bin_balances WHERE warehouse_id = ${warehouseId} GROUP BY product_id) x ON x.product_id = sb.product_id AND sb.warehouse_id = ${warehouseId}
      JOIN products p ON p.id = COALESCE(sb.product_id, x.product_id)
      WHERE (sb.warehouse_id = ${warehouseId} OR sb.warehouse_id IS NULL) AND COALESCE(sb.qty, 0) <> COALESCE(x.s, 0)
      ORDER BY p.sku LIMIT 100`);
  }

  /** Dipakai oleh BinsService.check */
  queryStockLot(db: DbOrTx, warehouseId: string) {
    return db.execute(sql`
      SELECT p.sku, p.name, l.lot_no AS "lotNo", l.qty_remaining AS balance, COALESCE(x.s, 0) AS binned
      FROM stock_lots l
      JOIN products p ON p.id = l.product_id
      LEFT JOIN (SELECT lot_id, SUM(qty) AS s FROM stock_bin_balances WHERE warehouse_id = ${warehouseId} AND lot_id IS NOT NULL GROUP BY lot_id) x ON x.lot_id = l.id
      WHERE l.warehouse_id = ${warehouseId} AND l.qty_remaining <> COALESCE(x.s, 0)
      ORDER BY p.sku LIMIT 100`);
  }

  /** Dipakai oleh BinsService.check */
  queryStockBinBalanceForCheck(db: DbOrTx, warehouseId: string) {
    return db.execute<{ products: number; qty: string }>(sql`
      SELECT COUNT(DISTINCT s.product_id)::int AS products, COALESCE(SUM(s.qty), 0) AS qty FROM stock_bin_balances s JOIN warehouse_bins b ON b.id = s.bin_id
      WHERE s.warehouse_id = ${warehouseId} AND b.kind = 'UNASSIGNED' AND s.qty > 0`);
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh BinsService.stock */
  queryStockBinBalanceForStock(
    db: DbOrTx,
    u: AuthUser,
    q: BinStockQuery,
    allowed: string[] | null,
    term: string | undefined,
  ) {
    return db.execute(sql`
      SELECT s.bin_id AS "binId", b.code AS "binCode", b.zone, b.kind AS "binKind", s.warehouse_id AS "warehouseId", w.code AS "warehouseCode",
             s.product_id AS "productId", p.sku, p.name, p.barcode, p.base_uom AS uom, s.lot_id AS "lotId", l.lot_no AS "lotNo", l.expiry_date AS "expiryDate", s.qty
      FROM stock_bin_balances s
      JOIN warehouse_bins b ON b.id = s.bin_id
      JOIN warehouses w ON w.id = s.warehouse_id
      JOIN products p ON p.id = s.product_id
      LEFT JOIN stock_lots l ON l.id = s.lot_id
      WHERE s.tenant_id = ${u.tenantId} AND s.qty > 0
        ${
          q.warehouseId
            ? sql`AND s.warehouse_id = ${q.warehouseId}`
            : allowed
              ? sql`AND s.warehouse_id IN (${sql.join(
                  allowed.map((a) => sql`${a}::uuid`),
                  sql`, `,
                )})`
              : sql``
        }
        ${q.binId ? sql`AND s.bin_id = ${q.binId}` : sql``}
        ${q.productId ? sql`AND s.product_id = ${q.productId}` : sql``}
        ${term ? sql`AND (p.sku ILIKE ${'%' + term.replace(/[%_\\]/g, '\\$&') + '%'} OR p.name ILIKE ${'%' + term.replace(/[%_\\]/g, '\\$&') + '%'} OR p.barcode = ${term})` : sql``}
      ORDER BY w.code, (b.kind = 'UNASSIGNED') DESC, b.code, p.sku, l.expiry_date NULLS LAST
      LIMIT ${MAX_ROWS}`);
  }

  /** Dipakai oleh BinsService.move */
  queryStockBinBalanceForMove2(db: DbOrTx, ln: BinMoveLineDto) {
    return db.execute<{ id: string; qty: string }>(sql`
          SELECT id, qty FROM stock_bin_balances
          WHERE bin_id = ${ln.fromBinId} AND product_id = ${ln.productId} AND COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(${ln.lotId ?? null}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
          FOR UPDATE`);
  }

  /** Dipakai oleh BinsService.controls */
  queryWarehouseForControls(db: DbOrTx, tenantId: string, wf: SQL<unknown>) {
    return db.execute<{ id: string; code: string }>(
      sql`SELECT id, code FROM warehouses w WHERE tenant_id = ${tenantId} AND bins_enabled ${wf}`,
    );
  }

  /** Dipakai oleh BinsService.controls */
  queryStockCount(db: DbOrTx, tenantId: string, wf: SQL<unknown>) {
    return db.execute<{ wh: string; code: string; n: number }>(sql`
      SELECT w.code AS wh, b.code, COUNT(DISTINCT c.id)::int AS n
      FROM stock_counts c JOIN warehouse_bins b ON b.id = c.bin_id JOIN warehouses w ON w.id = c.warehouse_id
      JOIN stock_count_lines l ON l.count_id = c.id AND l.difference IS NOT NULL AND l.difference <> 0
      WHERE c.tenant_id = ${tenantId} AND c.status = 'POSTED' AND c.posted_at > now() - interval '90 days' ${wf}
      GROUP BY w.code, b.code HAVING COUNT(DISTINCT c.id) >= 2 ORDER BY n DESC LIMIT 50`);
  }

  /** Dipakai oleh BinsService.controls */
  queryBinMoveForControls(db: DbOrTx, tenantId: string, wf: SQL<unknown>) {
    return db.execute<{ name: string; n: number }>(sql`
      SELECT COALESCE(u.name, 'Tidak diketahui') AS name, COUNT(*)::int AS n FROM bin_moves m LEFT JOIN users u ON u.id = m.created_by_id
      JOIN warehouses w ON w.id = m.warehouse_id
      WHERE m.tenant_id = ${tenantId} AND m.kind = 'MOVE' AND m.created_at > now() - interval '7 days' ${wf}
      GROUP BY u.name HAVING COUNT(*) >= ${HEAVY_MOVES} ORDER BY n DESC LIMIT 20`);
  }
}
