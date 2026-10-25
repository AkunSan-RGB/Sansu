import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';
import { addDays } from '../../common/utils/dates';

/** Gudang aktif yang belum diopname lebih dari sekian hari dianggap lewat jadwal */
export const COUNT_INTERVAL_DAYS = 35;

/** Transfer yang masih di perjalanan lebih dari sekian hari dianggap menggantung */
export const TRANSFER_STUCK_DAYS = 3;

/** Barang kelas A (nilai stok terbesar) yang tidak dihitung fisik lebih dari sekian hari ditandai (opname siklus) */
export const CYCLE_COUNT_DAYS = 60;

/** Akses data untuk InventoryControls: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class InventoryControlsRepository {
  /** Dipakai oleh InventoryControlsService.controls */
  queryStockMove(db: DbOrTx, tenantId: string, today: string, adjOutRepeat: number) {
    return db.execute<{ wh: string; n: number }>(sql`
      SELECT w.name AS wh, COUNT(DISTINCT m.ref_id)::int AS n
      FROM stock_moves m JOIN warehouses w ON w.id = m.warehouse_id
      WHERE m.tenant_id = ${tenantId} AND m.type = 'ADJUSTMENT_OUT' AND m.ref_type = 'STOCK_ADJUSTMENT' AND m.date >= ${addDays(today, -30)}
        AND NOT EXISTS (SELECT 1 FROM stock_counts c WHERE c.tenant_id = ${tenantId} AND c.adjustment_number = m.ref_number)
      GROUP BY w.name HAVING COUNT(DISTINCT m.ref_id) >= ${adjOutRepeat}`);
  }

  /** Dipakai oleh InventoryControlsService.controls */
  queryStockMoveForControls(db: DbOrTx, tenantId: string, since: string, stockAlertValue: number) {
    return db.execute<{ number: string; wh: string; v: string }>(sql`
        SELECT m.ref_number AS number, w.name AS wh, SUM(ABS(m.qty) * m.unit_cost)::text AS v
        FROM stock_moves m JOIN warehouses w ON w.id = m.warehouse_id
        WHERE m.tenant_id = ${tenantId} AND m.type = 'ADJUSTMENT_OUT' AND m.ref_type = 'STOCK_ADJUSTMENT' AND m.date >= ${since}
          AND NOT EXISTS (SELECT 1 FROM stock_counts c WHERE c.tenant_id = ${tenantId} AND c.adjustment_number = m.ref_number)
        GROUP BY m.ref_number, w.name HAVING SUM(ABS(m.qty) * m.unit_cost) >= ${stockAlertValue} ORDER BY SUM(ABS(m.qty) * m.unit_cost) DESC`);
  }

  /** Dipakai oleh InventoryControlsService.controls */
  queryStockCount(db: DbOrTx, tenantId: string, since: string, stockAlertValue: number) {
    return db.execute<{ number: string; wh: string; v: string }>(sql`
        SELECT c.number, w.name AS wh, SUM(ABS(m.qty) * m.unit_cost)::text AS v
        FROM stock_counts c JOIN warehouses w ON w.id = c.warehouse_id
        JOIN stock_moves m ON m.tenant_id = c.tenant_id AND m.ref_number = c.adjustment_number AND m.type = 'ADJUSTMENT_OUT'
        WHERE c.tenant_id = ${tenantId} AND c.status = 'POSTED' AND c.date >= ${since}
        GROUP BY c.number, w.name HAVING SUM(ABS(m.qty) * m.unit_cost) >= ${stockAlertValue} ORDER BY SUM(ABS(m.qty) * m.unit_cost) DESC`);
  }

  /** Dipakai oleh InventoryControlsService.controls */
  queryStockMoveForControls2(db: DbOrTx, tenantId: string, since: string, stockAlertValue: number) {
    return db.execute<{ number: string; wh: string; v: string }>(sql`
        SELECT m.ref_number AS number, w.name AS wh, SUM(ABS(m.qty) * m.unit_cost)::text AS v
        FROM stock_moves m JOIN warehouses w ON w.id = m.warehouse_id
        WHERE m.tenant_id = ${tenantId} AND m.type = 'ADJUSTMENT_IN' AND m.ref_type = 'STOCK_ADJUSTMENT' AND m.date >= ${since}
          AND NOT EXISTS (SELECT 1 FROM stock_counts c WHERE c.tenant_id = ${tenantId} AND c.adjustment_number = m.ref_number)
          AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.tenant_id = ${tenantId} AND j.source_type = 'STOCK_ADJUSTMENT' AND j.source_id::text = m.ref_id::text AND j.description LIKE '%(OPENING)%')
        GROUP BY m.ref_number, w.name HAVING SUM(ABS(m.qty) * m.unit_cost) >= ${stockAlertValue} ORDER BY SUM(ABS(m.qty) * m.unit_cost) DESC`);
  }

  /** Dipakai oleh InventoryControlsService.controls */
  queryStockMoveForControls3(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{ number: string; wh: string; date: string; v: string }>(sql`
        SELECT m.ref_number AS number, w.name AS wh, MIN(m.date)::text AS date, SUM(ABS(m.qty) * m.unit_cost)::text AS v
        FROM stock_moves m JOIN warehouses w ON w.id = m.warehouse_id
        WHERE m.tenant_id = ${tenantId} AND m.type = 'ADJUSTMENT_OUT' AND m.ref_type = 'STOCK_ADJUSTMENT' AND m.date >= ${since}
          AND NOT EXISTS (SELECT 1 FROM stock_counts c WHERE c.tenant_id = ${tenantId} AND c.adjustment_number = m.ref_number)
        GROUP BY m.ref_number, w.name ORDER BY MIN(m.date)`);
  }

  /** Dipakai oleh InventoryControlsService.controls */
  queryWarehouse(db: DbOrTx, tenantId: string, today: string) {
    return db.execute<{ name: string; last: string | null }>(sql`
      SELECT w.name, MAX(c.posted_at)::date::text AS last
      FROM warehouses w LEFT JOIN stock_counts c ON c.warehouse_id = w.id AND c.status = 'POSTED'
      WHERE w.tenant_id = ${tenantId} AND w.kind = 'MAIN'
        AND EXISTS (SELECT 1 FROM stock_balances b WHERE b.warehouse_id = w.id AND b.qty > 0)
        AND EXISTS (SELECT 1 FROM stock_moves m WHERE m.warehouse_id = w.id AND m.date <= ${addDays(today, -COUNT_INTERVAL_DAYS)})
      GROUP BY w.id, w.name
      HAVING MAX(c.posted_at) IS NULL OR MAX(c.posted_at)::date < ${addDays(today, -COUNT_INTERVAL_DAYS)}`);
  }

  /** Dipakai oleh InventoryControlsService.controls */
  queryStockTransfer(db: DbOrTx, tenantId: string, today: string) {
    return db.execute<{ number: string; from_wh: string; to_wh: string; days: number }>(sql`
      SELECT t.number, fw.name AS from_wh, tw.name AS to_wh, (CURRENT_DATE - t.date)::int AS days
      FROM stock_transfers t JOIN warehouses fw ON fw.id = t.from_warehouse_id JOIN warehouses tw ON tw.id = t.to_warehouse_id
      WHERE t.tenant_id = ${tenantId} AND t.status = 'IN_TRANSIT' AND t.date <= ${addDays(today, -TRANSFER_STUCK_DAYS)}
      ORDER BY t.date`);
  }

  /** Dipakai oleh InventoryControlsService.controls */
  queryControls(db: DbOrTx, tenantId: string) {
    return db.execute<{ stock: string; gl: string }>(sql`
      SELECT (SELECT COALESCE(SUM(b.qty * b.avg_cost), 0) FROM stock_balances b WHERE b.tenant_id = ${tenantId})::text AS stock,
             (SELECT COALESCE(SUM(l.debit - l.credit), 0) FROM journal_lines l
                JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
              WHERE j.tenant_id = ${tenantId} AND a.system_key IN ('INVENTORY', 'INVENTORY_SEMI'))::text AS gl`);
  }

  /** Dipakai oleh InventoryControlsService.controls */
  queryRanked(db: DbOrTx, tenantId: string, today: string) {
    return db.execute<{ sku: string; name: string; v: string; last: string | null }>(sql`
      WITH val AS (
        SELECT b.product_id, SUM(b.qty * b.avg_cost) AS v FROM stock_balances b WHERE b.tenant_id = ${tenantId} AND b.qty > 0 GROUP BY b.product_id
      ), ranked AS (
        SELECT product_id, v, SUM(v) OVER (ORDER BY v DESC, product_id) AS cum, SUM(v) OVER () AS total, ROW_NUMBER() OVER (ORDER BY v DESC, product_id) AS rn FROM val WHERE v > 0
      )
      SELECT p.sku, p.name, r.v::text AS v,
        (SELECT MAX(c.date)::text FROM stock_count_lines cl JOIN stock_counts c ON c.id = cl.count_id
          WHERE cl.product_id = r.product_id AND c.tenant_id = ${tenantId} AND c.status = 'POSTED' AND cl.counted_qty IS NOT NULL) AS last
      FROM ranked r JOIN products p ON p.id = r.product_id
      WHERE r.rn <= 20 AND (r.cum - r.v) < r.total * 0.8
        AND NOT EXISTS (SELECT 1 FROM stock_count_lines cl JOIN stock_counts c ON c.id = cl.count_id
          WHERE cl.product_id = r.product_id AND c.tenant_id = ${tenantId} AND c.status = 'POSTED' AND cl.counted_qty IS NOT NULL AND c.date >= ${addDays(today, -CYCLE_COUNT_DAYS)})
        AND EXISTS (SELECT 1 FROM stock_moves m WHERE m.tenant_id = ${tenantId} AND m.product_id = r.product_id AND m.date <= ${addDays(today, -CYCLE_COUNT_DAYS)})
      ORDER BY r.v DESC`);
  }
}
