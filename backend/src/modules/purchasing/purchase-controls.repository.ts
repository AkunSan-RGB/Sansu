import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';
import { addDays } from '../../common/utils/dates';

/** Akses data untuk PurchaseControls: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class PurchaseControlsRepository {
  /** Dipakai oleh PurchaseControlsService.controls */
  queryPurchaseOrder(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{ number: string; supplier: string; sid: string; date: string; total: string }>(sql`
        SELECT o.number, s.name AS supplier, s.id AS sid, o.date::text AS date, o.total
        FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id
        WHERE o.tenant_id = ${tenantId} AND o.status <> 'CANCELLED' AND o.date >= ${since}
        ORDER BY o.supplier_id, o.date`);
  }

  /** Dipakai oleh PurchaseControlsService.controls */
  querySupplierPayment(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{ number: string; name: string }>(sql`
      SELECT p.number, s.name FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.tenant_id = ${tenantId} AND p.status = 'POSTED' AND p.date >= ${since} AND EXTRACT(DOW FROM p.date) IN (0, 6)
      ORDER BY p.date DESC`);
  }

  /** Dipakai oleh PurchaseControlsService.controls */
  querySupplier(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{ code: string; name: string }>(sql`
      SELECT s.code, s.name FROM suppliers s
      JOIN LATERAL (SELECT MIN(p.date) AS d FROM supplier_payments p WHERE p.supplier_id = s.id AND p.status = 'POSTED') f ON f.d IS NOT NULL
      WHERE s.tenant_id = ${tenantId} AND f.d >= ${since} AND f.d::date - s.created_at::date <= 14`);
  }

  /** Dipakai oleh PurchaseControlsService.controls */
  queryGoodsReceipt(db: DbOrTx, tenantId: string, today: string, grniDays: number) {
    return db.execute<{ number: string; name: string }>(sql`
      SELECT g.number, s.name FROM goods_receipts g JOIN suppliers s ON s.id = g.supplier_id
      WHERE g.tenant_id = ${tenantId} AND g.status = 'RECEIVED' AND g.date <= ${addDays(today, -grniDays)}
        AND EXISTS (SELECT 1 FROM goods_receipt_lines l WHERE l.receipt_id = g.id AND l.billed_qty < l.qty)
      ORDER BY g.date`);
  }

  /** Dipakai oleh PurchaseControlsService.controls */
  querySupplierPaymentForControls(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{ number: string; reason: string | null }>(sql`
      SELECT number, void_reason AS reason FROM supplier_payments WHERE tenant_id = ${tenantId} AND status = 'VOID' AND voided_at >= ${since}::date`);
  }

  /** Dipakai oleh PurchaseControlsService.controls */
  queryApprovalRequest(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{ title: string }>(sql`
      SELECT title FROM approval_requests WHERE tenant_id = ${tenantId} AND kind = 'PURCHASE_INVOICE_PRICE' AND status = 'APPROVED' AND decided_at >= ${since}::date`);
  }

  /** Dipakai oleh PurchaseControlsService.controls */
  queryPurchaseOrderForControls(db: DbOrTx, tenantId: string, since: string, purchaseOrder: number) {
    return db.execute<{ number: string; name: string }>(sql`
        SELECT o.number, s.name FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id
        WHERE o.tenant_id = ${tenantId} AND o.date >= ${since} AND o.status IN ('CONFIRMED', 'BILLED') AND o.total >= ${purchaseOrder}
          AND NOT EXISTS (SELECT 1 FROM approval_requests a WHERE a.tenant_id = ${tenantId} AND a.kind = 'PURCHASE_ORDER' AND a.ref_id = o.id::text AND a.status = 'APPROVED')
        ORDER BY o.date DESC`);
  }

  /** Dipakai oleh PurchaseControlsService.controls */
  queryPurchaseOrderForControls2(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{ number: string; reason: string | null }>(sql`
      SELECT o.number, o.cancel_reason AS reason FROM purchase_orders o
      WHERE o.tenant_id = ${tenantId} AND o.status = 'CANCELLED' AND o.cancelled_by_id IS NOT NULL AND o.date >= ${since}
        AND EXISTS (SELECT 1 FROM audit_logs l WHERE l.entity = 'PurchaseOrder' AND l.entity_id = o.id::text AND l.action = 'CONFIRM')`);
  }

  /** Dipakai oleh PurchaseControlsService.controls */
  querySupplierForControls(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{ code: string; name: string }>(sql`
      SELECT code, name FROM suppliers WHERE tenant_id = ${tenantId} AND bank_changed_at >= ${since}::date AND bank_changed_at IS NOT NULL`);
  }
}
