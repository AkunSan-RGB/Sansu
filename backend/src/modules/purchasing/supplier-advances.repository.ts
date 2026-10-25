import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';
import { AdvanceQueryDto, CreateSupplierAdvanceDto } from './supplier-advances.dto';
import type { Decimal } from 'decimal.js';

export type AdvanceRow = {
  id: string;
  number: string;
  date: string;
  supplier_id: string;
  purchase_order_id: string | null;
  amount: string;
  applied_amount: string;
  refunded_amount: string;
  status: string;
  journal_id: string | null;
};

/** Akses data untuk SupplierAdvances: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class SupplierAdvancesRepository {
  /** Dipakai oleh SupplierAdvancesService.create */
  querySupplier(db: DbOrTx, supplierId: string, tenantId: string) {
    return db.execute<{ id: string; code: string; name: string; is_active: boolean; bank_changed_at: Date | null }>(
      sql`SELECT id, code, name, is_active, bank_changed_at FROM suppliers WHERE id = ${supplierId} AND tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh SupplierAdvancesService.create */
  queryPurchaseOrder(db: DbOrTx, purchaseOrderId: string, tenantId: string) {
    return db.execute<{ number: string; total: string; status: string; currency: string; supplier_id: string }>(
      sql`SELECT number, total, status, currency, supplier_id FROM purchase_orders WHERE id = ${purchaseOrderId} AND tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh SupplierAdvancesService.create */
  querySupplierAdvance(db: DbOrTx, purchaseOrderId: string, tenantId: string) {
    return db.execute<{ s: string }>(
      sql`SELECT COALESCE(SUM(amount - refunded_amount), 0)::text AS s FROM supplier_advances WHERE purchase_order_id = ${purchaseOrderId} AND tenant_id = ${tenantId} AND status <> 'VOID'`,
    );
  }

  /** Dipakai oleh SupplierAdvancesService.create */
  queryCreate(db: DbOrTx, tenantId: string, id: string) {
    return db.execute<{ n: number }>(sql`
          SELECT (SELECT COUNT(*)::int FROM supplier_payments WHERE tenant_id = ${tenantId} AND supplier_id = ${id} AND status = 'POSTED')
               + (SELECT COUNT(*)::int FROM supplier_advances WHERE tenant_id = ${tenantId} AND supplier_id = ${id} AND status <> 'VOID') AS n`);
  }

  /** Dipakai oleh SupplierAdvancesService.create */
  queryCreateForCreate(db: DbOrTx, id: string, advId: string) {
    return db.execute(sql`UPDATE supplier_advances SET journal_id = ${id} WHERE id = ${advId}`);
  }

  /** Dipakai oleh SupplierAdvancesService.apply */
  querySupplierAdvanceForApply(db: DbOrTx, id: string, tenantId: string) {
    return db.execute(sql`SELECT id FROM supplier_advances WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
  }

  /** Dipakai oleh SupplierAdvancesService.apply */
  queryPurchaseInvoice(db: DbOrTx, purchaseInvoiceId: string, tenantId: string) {
    return db.execute(
      sql`SELECT id FROM purchase_invoices WHERE id = ${purchaseInvoiceId} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
  }

  /** Dipakai oleh SupplierAdvancesService.apply */
  queryPurchaseInvoiceForApply(db: DbOrTx, purchaseInvoiceId: string, tenantId: string) {
    return db.execute<{
      id: string;
      number: string;
      supplier_id: string;
      purchase_order_id: string | null;
      total: string;
      paid_amount: string;
      returned_amount: string;
      status: string;
      currency: string;
    }>(
      sql`SELECT id, number, supplier_id, purchase_order_id, total, paid_amount, returned_amount, status, currency FROM purchase_invoices WHERE id = ${purchaseInvoiceId} AND tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh SupplierAdvancesService.apply */
  queryApply(db: DbOrTx, id: string, mvId: string) {
    return db.execute(sql`UPDATE supplier_advance_movements SET journal_id = ${id} WHERE id = ${mvId}`);
  }

  /** Dipakai oleh SupplierAdvancesService.void */
  queryVoid(db: DbOrTx, journal_id: string) {
    return db.execute<{ n: number }>(sql`
        SELECT (SELECT COUNT(*) FROM bank_statement_lines b
                WHERE b.status IN ('MATCHED', 'CREATED')
                  AND (b.journal_id = ${journal_id} OR b.journal_line_id IN (SELECT id FROM journal_lines WHERE journal_id = ${journal_id})))::int
             + (SELECT COUNT(*) FROM bank_line_extra_matches x WHERE x.journal_line_id IN (SELECT id FROM journal_lines WHERE journal_id = ${journal_id}))::int AS n`);
  }

  /** Dipakai oleh SupplierAdvancesService.void */
  queryVoidForVoid(db: DbOrTx, sub: string, reason: string, id: string, aId: string) {
    return db.execute(
      sql`UPDATE supplier_advances SET status = 'VOID', voided_at = now(), voided_by_id = ${sub}, void_reason = ${reason.trim()}, void_journal_id = ${id} WHERE id = ${aId}`,
    );
  }

  /** Dipakai oleh SupplierAdvancesService.list */
  querySupplierAdvanceForList(db: DbOrTx, tenantId: string, q: AdvanceQueryDto) {
    return db.execute<Record<string, unknown>>(sql`
      SELECT a.id, a.number, a.date, a.supplier_id AS "supplierId", s.code AS "supplierCode", s.name AS "supplierName",
             a.purchase_order_id AS "purchaseOrderId", po.number AS "purchaseOrderNumber", a.method, a.amount, a.applied_amount AS "appliedAmount",
             a.refunded_amount AS "refundedAmount", (a.amount - a.applied_amount - a.refunded_amount) AS remaining, a.status, a.description,
             u.name AS "createdByName", (CURRENT_DATE - a.date)::int AS "ageDays"
      FROM supplier_advances a JOIN suppliers s ON s.id = a.supplier_id LEFT JOIN purchase_orders po ON po.id = a.purchase_order_id LEFT JOIN users u ON u.id = a.created_by_id
      WHERE a.tenant_id = ${tenantId}
        ${q.supplierId ? sql`AND a.supplier_id = ${q.supplierId}` : sql``}
        ${q.open === '1' ? sql`AND a.status = 'OPEN'` : sql``}
      ORDER BY a.date DESC, a.number DESC LIMIT 500`);
  }

  /** Dipakai oleh SupplierAdvancesService.get */
  querySupplierAdvanceMovement(db: DbOrTx, tenantId: string, id: string) {
    return db.execute<Record<string, unknown>>(sql`
      SELECT m.id, m.kind, m.number, m.date, m.amount, m.note, i.number AS "invoiceNumber", i.supplier_invoice_no AS "supplierInvoiceNo", u.name AS "createdByName"
      FROM supplier_advance_movements m LEFT JOIN purchase_invoices i ON i.id = m.purchase_invoice_id LEFT JOIN users u ON u.id = m.created_by_id
      WHERE m.tenant_id = ${tenantId} AND m.advance_id = ${id} ORDER BY m.date, m.number`);
  }

  /** Dipakai oleh SupplierAdvancesService.summary */
  querySupplierAdvanceForSummary(db: DbOrTx, tenantId: string) {
    return db.execute<{
      supplierId: string;
      supplierCode: string;
      supplierName: string;
      open: string;
      count: number;
      oldest: string | null;
      openInvoices: string;
    }>(sql`
      SELECT s.id AS "supplierId", s.code AS "supplierCode", s.name AS "supplierName",
             SUM(a.amount - a.applied_amount - a.refunded_amount)::text AS open, COUNT(*)::int AS count, MIN(a.date)::text AS oldest,
             COALESCE((SELECT SUM(i.total - i.paid_amount - i.returned_amount) FROM purchase_invoices i WHERE i.tenant_id = ${tenantId} AND i.supplier_id = s.id AND i.status <> 'PAID' AND i.currency = 'IDR'), 0)::text AS "openInvoices"
      FROM supplier_advances a JOIN suppliers s ON s.id = a.supplier_id
      WHERE a.tenant_id = ${tenantId} AND a.status = 'OPEN'
      GROUP BY s.id, s.code, s.name ORDER BY SUM(a.amount - a.applied_amount - a.refunded_amount) DESC`);
  }

  /** Dipakai oleh SupplierAdvancesService.controls */
  querySupplierAdvanceForControls(db: DbOrTx, tenantId: string) {
    return db.execute<{
      id: string;
      number: string;
      date: string;
      supplier: string;
      po: string | null;
      poStatus: string | null;
      remaining: string;
      openInvoices: string;
    }>(sql`
      SELECT a.id, a.number, a.date::text, s.name AS supplier, po.number AS po, po.status AS "poStatus",
             (a.amount - a.applied_amount - a.refunded_amount)::text AS remaining,
             COALESCE((SELECT SUM(i.total - i.paid_amount - i.returned_amount) FROM purchase_invoices i WHERE i.tenant_id = ${tenantId} AND i.supplier_id = a.supplier_id AND i.status <> 'PAID' AND i.currency = 'IDR'), 0)::text AS "openInvoices"
      FROM supplier_advances a JOIN suppliers s ON s.id = a.supplier_id LEFT JOIN purchase_orders po ON po.id = a.purchase_order_id
      WHERE a.tenant_id = ${tenantId} AND a.status = 'OPEN' ORDER BY a.date`);
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh SupplierAdvancesService.create */
  querySupplierAdvanceForCreate(
    db: DbOrTx,
    tenantId: string,
    number: string,
    date: string,
    id: string,
    dto: CreateSupplierAdvanceDto,
    method: string,
    cashId: string,
    amount: Decimal,
    sub: string,
  ) {
    return db.execute<{ id: string }>(sql`
        INSERT INTO supplier_advances (tenant_id, number, date, supplier_id, purchase_order_id, method, cash_account_id, amount, description, created_by_id)
        VALUES (${tenantId}, ${number}, ${date}, ${id}, ${dto.purchaseOrderId ?? null}, ${method}, ${cashId}, ${amount.toFixed(2)}, ${dto.description?.trim() || null}, ${sub}) RETURNING id`);
  }

  /** Dipakai oleh SupplierAdvancesService.apply */
  querySupplierAdvanceForApply2(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<AdvanceRow>(sql`SELECT * FROM supplier_advances WHERE id = ${id} AND tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh SupplierAdvancesService.apply */
  querySupplierAdvanceMovementForApply(
    db: DbOrTx,
    tenantId: string,
    id: string,
    number: string,
    date: string,
    amount: Decimal,
    invId: string,
    sub: string,
  ) {
    return db.execute<{ id: string }>(sql`
        INSERT INTO supplier_advance_movements (tenant_id, advance_id, kind, number, date, amount, purchase_invoice_id, created_by_id)
        VALUES (${tenantId}, ${id}, 'APPLY', ${number}, ${date}, ${amount.toFixed(2)}, ${invId}, ${sub}) RETURNING id`);
  }

  /** Dipakai oleh SupplierAdvancesService.apply */
  queryApplyForApply(db: DbOrTx, paid: Decimal, invValues: string, invInvValues: string, invValues2: string) {
    return db.execute(
      sql`UPDATE purchase_invoices SET paid_amount = ${paid.toFixed(2)}, status = ${paid.plus(invValues).gte(invInvValues) ? 'PAID' : 'PARTIAL'}::invoice_status WHERE id = ${invValues2}`,
    );
  }

  /** Dipakai oleh SupplierAdvancesService.apply */
  queryApplyForApply2(db: DbOrTx, applied: Decimal, closed: boolean, id: string) {
    return db.execute(
      sql`UPDATE supplier_advances SET applied_amount = ${applied.toFixed(2)}, status = ${closed ? 'CLOSED' : 'OPEN'} WHERE id = ${id}`,
    );
  }

  /** Dipakai oleh SupplierAdvancesService.refund */
  querySupplierAdvanceForRefund(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<AdvanceRow & { cash_account_id: string; method: string }>(
      sql`SELECT * FROM supplier_advances WHERE id = ${id} AND tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh SupplierAdvancesService.refund */
  querySupplierAdvanceMovementForRefund(
    db: DbOrTx,
    tenantId: string,
    id: string,
    number: string,
    date: string,
    amount: Decimal,
    cashId: string,
    note: string,
    sub: string,
  ) {
    return db.execute<{ id: string }>(sql`
        INSERT INTO supplier_advance_movements (tenant_id, advance_id, kind, number, date, amount, cash_account_id, note, created_by_id)
        VALUES (${tenantId}, ${id}, 'REFUND', ${number}, ${date}, ${amount.toFixed(2)}, ${cashId}, ${note.trim()}, ${sub}) RETURNING id`);
  }

  /** Dipakai oleh SupplierAdvancesService.refund */
  queryRefund(db: DbOrTx, refunded: Decimal, closed: boolean, id: string) {
    return db.execute(
      sql`UPDATE supplier_advances SET refunded_amount = ${refunded.toFixed(2)}, status = ${closed ? 'CLOSED' : 'OPEN'} WHERE id = ${id}`,
    );
  }
}
