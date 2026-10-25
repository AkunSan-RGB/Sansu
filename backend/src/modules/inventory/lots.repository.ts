import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { LotQueryDto } from './lots.dto';
import type { Decimal } from 'decimal.js';

export type Row = {
  id: string;
  product_id: string;
  sku: string;
  name: string;
  base_uom: string;
  warehouse_id: string;
  warehouse_code: string;
  lot_no: string | null;
  expiry_date: string | null;
  received_date: string;
  qty_remaining: string;
  avg_cost: string | null;
};

/** Akses data untuk Lots: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class LotsRepository {
  /** Dipakai oleh LotsService.trace */
  queryStockLot(db: DbOrTx, tenantId: string, productId: string, lotNo: string) {
    return db.execute<{
      id: string;
      warehouse_code: string;
      received_date: string;
      expiry_date: string | null;
      qty_received: string;
      qty_remaining: string;
      source_type: string;
      source_ref: string;
      grn_number: string | null;
      supplier: string | null;
      sku: string;
      name: string;
      base_uom: string;
    }>(sql`
      SELECT l.id, w.code AS warehouse_code, l.received_date, l.expiry_date, l.qty_received, l.qty_remaining, l.source_type, l.source_ref,
             g.number AS grn_number, s.name AS supplier, p.sku, p.name, p.base_uom
      FROM stock_lots l
      JOIN warehouses w ON w.id = l.warehouse_id
      JOIN products p ON p.id = l.product_id
      LEFT JOIN goods_receipts g ON l.source_type = 'GOODS_RECEIPT' AND g.id::text = l.source_ref
      LEFT JOIN suppliers s ON s.id = g.supplier_id
      WHERE l.tenant_id = ${tenantId} AND l.product_id = ${productId} AND l.lot_no = ${lotNo}
      ORDER BY l.received_date, l.id`);
  }

  /** Dipakai oleh LotsService.trace */
  queryStockLotIssue(db: DbOrTx, tenantId: string, productId: string, lotNo: string) {
    return db.execute<{
      qty: string;
      move_type: string;
      ref_type: string;
      ref_id: string;
      date: string;
      doc_number: string | null;
      cancelled: boolean;
      is_estimate: boolean;
      customer_id: string | null;
      customer_code: string | null;
      customer_name: string | null;
      customer_phone: string | null;
      customer_address: string | null;
    }>(sql`
      SELECT i.qty, i.move_type, i.ref_type, i.ref_id, i.date, i.is_estimate,
             COALESCE(d.number, v.number, po.number, gs.number) AS doc_number,
             COALESCE(d.status = 'CANCELLED', false) AS cancelled,
             c.id AS customer_id, c.code AS customer_code, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address
      FROM stock_lot_issues i
      JOIN stock_lots l ON l.id = i.lot_id
      LEFT JOIN delivery_orders d ON i.ref_type = 'DELIVERY' AND d.id::text = i.ref_id
      LEFT JOIN invoices v ON i.ref_type = 'INVOICE' AND v.id::text = i.ref_id
      LEFT JOIN pos_orders po ON i.ref_type = 'POS_ORDER' AND po.id::text = i.ref_id
      LEFT JOIN goods_swaps gs ON i.ref_type = 'GOODS_SWAP' AND gs.id::text = i.ref_id
      LEFT JOIN customers c ON c.id = COALESCE(d.customer_id, v.customer_id, po.customer_id, gs.customer_id)
      WHERE l.tenant_id = ${tenantId} AND l.product_id = ${productId} AND l.lot_no = ${lotNo}
      ORDER BY i.date, i.created_at`);
  }

  /** Dipakai oleh LotsService.rebuildTrace */
  queryStockLotForRebuildTrace(db: DbOrTx, tenantId: string) {
    return db.execute<{
      id: string;
      product_id: string;
      warehouse_id: string;
      received_date: string;
      expiry_date: string | null;
      untraced: string;
    }>(sql`
      SELECT l.id, l.product_id, l.warehouse_id, l.received_date, l.expiry_date,
             (l.qty_received - l.qty_remaining - COALESCE((SELECT SUM(i.qty) FROM stock_lot_issues i WHERE i.lot_id = l.id), 0))::text AS untraced
      FROM stock_lots l WHERE l.tenant_id = ${tenantId} AND l.lot_no IS NOT NULL
      ORDER BY l.expiry_date NULLS LAST, l.received_date, l.id`);
  }

  /** Dipakai oleh LotsService.rebuildTrace */
  queryStockMove(db: DbOrTx, tenantId: string, pid: string, wid: string) {
    return db.execute<{ type: string; qty: string; ref_type: string; ref_id: string; date: string; done: string }>(sql`
          SELECT m.type, m.qty, m.ref_type, m.ref_id, m.date,
                 COALESCE((SELECT SUM(i.qty) FROM stock_lot_issues i WHERE i.tenant_id = m.tenant_id AND i.product_id = m.product_id AND i.warehouse_id = m.warehouse_id AND i.ref_type = m.ref_type AND i.ref_id = m.ref_id), 0)::text AS done
          FROM stock_moves m
          WHERE m.tenant_id = ${tenantId} AND m.product_id = ${pid} AND m.warehouse_id = ${wid} AND m.qty < 0
            AND m.type IN ('SALE', 'ADJUSTMENT_OUT', 'PRODUCTION_ISSUE', 'PURCHASE_RETURN')
          ORDER BY m.date, m.id`);
  }

  /** Dipakai oleh LotsService.discard */
  queryStockLotForDiscard(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<{
      product_id: string;
      warehouse_id: string;
      qty_remaining: string;
      lot_no: string | null;
      expiry_date: string | null;
    }>(sql`
      SELECT product_id, warehouse_id, qty_remaining, lot_no, expiry_date FROM stock_lots WHERE id = ${id} AND tenant_id = ${tenantId}`);
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh LotsService.list */
  queryStockLotForList(db: DbOrTx, u: AuthUser, q: LotQueryDto, allowed: string[] | null) {
    return db.execute<Row>(sql`
      SELECT l.id, l.product_id, p.sku, p.name, p.base_uom, l.warehouse_id, w.code AS warehouse_code, l.lot_no, l.expiry_date,
             l.received_date, l.qty_remaining, b.avg_cost
      FROM stock_lots l
      JOIN products p ON p.id = l.product_id
      JOIN warehouses w ON w.id = l.warehouse_id
      LEFT JOIN stock_balances b ON b.product_id = l.product_id AND b.warehouse_id = l.warehouse_id
      WHERE l.tenant_id = ${u.tenantId} AND l.qty_remaining > 0
        ${q.warehouseId ? sql`AND l.warehouse_id = ${q.warehouseId}` : allowed ? sql`AND l.warehouse_id = ANY(${allowed}::uuid[])` : sql``}
      ORDER BY l.expiry_date NULLS LAST, p.sku, l.id
      LIMIT 1000`);
  }

  /** Dipakai oleh LotsService.rebuildTrace */
  queryStockLotIssueForRebuildTrace(
    db: DbOrTx,
    tenantId: string,
    id: string,
    pid: string,
    wid: string,
    take: Decimal,
    type: string,
    ref_type: string,
    ref_id: string,
    date: string,
  ) {
    return db.execute(sql`
              INSERT INTO stock_lot_issues (tenant_id, lot_id, product_id, warehouse_id, qty, move_type, ref_type, ref_id, date, is_estimate)
              VALUES (${tenantId}, ${id}, ${pid}, ${wid}, ${take.toFixed(4)}, ${type}, ${ref_type}, ${ref_id}, ${date}, true)`);
  }
}
