import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { users, suppliers, purchaseRequests, purchaseRequestLines } from '../../db/schema';
import { inArray, sql, and, eq } from 'drizzle-orm';
import { CreatePurchaseRequestDto } from './purchase-requests.dto';

/** Akses data untuk PurchaseRequests: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class PurchaseRequestsRepository {
  /** Dipakai oleh PurchaseRequestsService.names */
  listUsersById(db: DbOrTx, uniq: string[]) {
    return db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, uniq));
  }

  /** Dipakai oleh PurchaseRequestsService.lastBasePrice */
  queryPurchaseOrderLine(db: DbOrTx, tenantId: string, productId: string, supplierId: string | null | undefined) {
    return db.execute<{ p: string }>(sql`
        SELECT l.price / NULLIF(l.uom_factor, 0) AS p
        FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id
        WHERE o.tenant_id = ${tenantId} AND l.product_id = ${productId} AND o.status <> 'CANCELLED'
        ORDER BY (o.supplier_id = ${supplierId ?? null}) DESC NULLS LAST, o.date DESC, o.created_at DESC LIMIT 1`);
  }

  /** Dipakai oleh PurchaseRequestsService.create */
  listSuppliersById(db: DbOrTx, tenantId: string, supIds: string[]) {
    return db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, tenantId), inArray(suppliers.id, supIds)));
  }

  /** Dipakai oleh PurchaseRequestsService.create */
  insertPurchaseRequests(
    db: DbOrTx,
    tenantId: string,
    number: string,
    date: string,
    id: string,
    dto: CreatePurchaseRequestDto,
    sub: string,
  ) {
    return db
      .insert(purchaseRequests)
      .values({
        tenantId: tenantId,
        number: number,
        date: date,
        warehouseId: id,
        neededBy: dto.neededBy ?? null,
        notes: dto.notes,
        requestedById: sub,
      })
      .returning({ id: purchaseRequests.id });
  }

  /** Dipakai oleh PurchaseRequestsService.submitIn */
  listSuppliersByIdForSubmitIn(db: DbOrTx, tenantId: string, supIds: string[]) {
    return db
      .select({ preferred: suppliers.isPreferred, limit: suppliers.autoApproveLimit })
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, tenantId), inArray(suppliers.id, supIds as string[])));
  }

  /** Dipakai oleh PurchaseRequestsService.convert */
  updatePurchaseRequestLinesById(
    db: DbOrTx,
    poId: string,
    supplierId: string,
    lines: { lineId: string; productId: string; uom: string; qty: string; price: string }[],
  ) {
    return db
      .update(purchaseRequestLines)
      .set({ purchaseOrderId: poId, supplierId: supplierId })
      .where(
        inArray(
          purchaseRequestLines.id,
          lines.map((x) => x.lineId),
        ),
      );
  }

  /** Dipakai oleh PurchaseRequestsService.suggestions */
  queryStockMinimum(db: DbOrTx, tenantId: string, warehouseId: string | undefined) {
    return db.execute<{
      product_id: string;
      sku: string;
      name: string;
      base_uom: string;
      warehouse_id: string;
      wh_code: string;
      min_qty: string;
      on_hand: string;
      on_order: string;
      requested: string;
      supplier_id: string | null;
      supplier_name: string | null;
      last_price: string | null;
    }>(sql`
        SELECT m.product_id, p.sku, p.name, p.base_uom, m.warehouse_id, w.code AS wh_code, m.min_qty,
               COALESCE(b.qty, 0) AS on_hand, COALESCE(po.qty, 0) AS on_order, COALESCE(pr.qty, 0) AS requested,
               ls.supplier_id, ls.supplier_name, ls.base_price AS last_price
        FROM stock_minimums m
        JOIN products p ON p.id = m.product_id AND p.is_active
        JOIN warehouses w ON w.id = m.warehouse_id AND w.is_active
        LEFT JOIN stock_balances b ON b.product_id = m.product_id AND b.warehouse_id = m.warehouse_id
        LEFT JOIN (
          SELECT l.product_id, o.warehouse_id, SUM((l.qty - l.received_qty) * l.uom_factor) AS qty
          FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id
          WHERE o.tenant_id = ${tenantId} AND o.status IN ('DRAFT', 'CONFIRMED') AND l.qty > l.received_qty
          GROUP BY 1, 2) po ON po.product_id = m.product_id AND po.warehouse_id = m.warehouse_id
        LEFT JOIN (
          SELECT l.product_id, r.warehouse_id, SUM(l.qty * l.uom_factor) AS qty
          FROM purchase_request_lines l JOIN purchase_requests r ON r.id = l.request_id
          WHERE r.tenant_id = ${tenantId} AND r.status IN ('SUBMITTED', 'APPROVED') AND l.purchase_order_id IS NULL
          GROUP BY 1, 2) pr ON pr.product_id = m.product_id AND pr.warehouse_id = m.warehouse_id
        LEFT JOIN LATERAL (
          SELECT o.supplier_id, s.name AS supplier_name, l.price / NULLIF(l.uom_factor, 0) AS base_price
          FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id JOIN suppliers s ON s.id = o.supplier_id
          WHERE o.tenant_id = m.tenant_id AND l.product_id = m.product_id AND o.status <> 'CANCELLED'
          ORDER BY o.date DESC, o.created_at DESC LIMIT 1) ls ON true
        WHERE m.tenant_id = ${tenantId} ${warehouseId ? sql`AND m.warehouse_id = ${warehouseId}` : sql``}
          AND COALESCE(b.qty, 0) + COALESCE(po.qty, 0) + COALESCE(pr.qty, 0) < m.min_qty
        ORDER BY p.name, w.code`);
  }

  /** Dipakai oleh PurchaseRequestsService.lock */
  queryPurchaseRequest(db: DbOrTx, id: string, tenantId: string) {
    return db.execute(sql`SELECT id FROM purchase_requests WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
  }
}
