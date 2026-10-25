import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { purchaseInvoices, supplierPayments } from '../../db/schema';
import { and, eq, sql } from 'drizzle-orm';

/** Akses data untuk SupplierPayments: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class SupplierPaymentsRepository {
  /** Dipakai oleh SupplierPaymentsService.pay */
  findPurchaseInvoicesById(db: DbOrTx, purchaseInvoiceId: string, tenantId: string) {
    return db
      .select({ n: purchaseInvoices.supplierInvoiceNo })
      .from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.id, purchaseInvoiceId), eq(purchaseInvoices.tenantId, tenantId)));
  }

  /** Dipakai oleh SupplierPaymentsService.pay */
  queryPurchaseInvoice(db: DbOrTx, purchaseInvoiceId: string, tenantId: string, hold: number) {
    return db.execute<{ no: string; code: string }>(sql`
          SELECT i.supplier_invoice_no AS no, s.code FROM purchase_invoices i JOIN suppliers s ON s.id = i.supplier_id
          WHERE i.id = ${purchaseInvoiceId} AND i.tenant_id = ${tenantId} AND s.bank_changed_at IS NOT NULL AND s.bank_changed_at > now() - (${hold} || ' days')::interval`);
  }

  /** Dipakai oleh SupplierPaymentsService.pay */
  queryPurchaseInvoiceForPay(db: DbOrTx, tenantId: string, purchaseInvoiceId: string) {
    return db.execute<{ n: number; no: string }>(sql`
        SELECT (SELECT COUNT(*)::int FROM supplier_payments p WHERE p.tenant_id = ${tenantId} AND p.supplier_id = i.supplier_id AND p.status = 'POSTED') AS n, i.supplier_invoice_no AS no
        FROM purchase_invoices i WHERE i.id = ${purchaseInvoiceId} AND i.tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh SupplierPaymentsService.pay */
  queryPurchaseInvoiceForPay2(db: DbOrTx, purchaseInvoiceId: string, tenantId: string) {
    return db.execute(sql`
        SELECT id FROM purchase_invoices WHERE id = ${purchaseInvoiceId} AND tenant_id = ${tenantId} FOR UPDATE`);
  }

  /** Dipakai oleh SupplierPaymentsService.voidPayment */
  findSupplierPaymentsById(db: DbOrTx, id: string, tenantId: string) {
    return db
      .select({ invoiceId: supplierPayments.purchaseInvoiceId })
      .from(supplierPayments)
      .where(and(eq(supplierPayments.id, id), eq(supplierPayments.tenantId, tenantId)));
  }

  /** Dipakai oleh SupplierPaymentsService.voidPayment */
  queryPurchaseInvoiceForVoidPayment(db: DbOrTx, invoiceId: string, tenantId: string) {
    return db.execute(
      sql`SELECT id FROM purchase_invoices WHERE id = ${invoiceId} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
  }

  /** Dipakai oleh SupplierPaymentsService.voidPayment */
  querySupplierPayment(db: DbOrTx, id: string, tenantId: string) {
    return db.execute(sql`SELECT id FROM supplier_payments WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
  }

  /** Dipakai oleh SupplierPaymentsService.voidPayment */
  queryVoidPayment(db: DbOrTx, journalId: string) {
    return db.execute<{ n: number }>(sql`
        SELECT (SELECT COUNT(*) FROM bank_statement_lines b
                WHERE b.status IN ('MATCHED', 'CREATED')
                  AND (b.journal_id = ${journalId} OR b.journal_line_id IN (SELECT id FROM journal_lines WHERE journal_id = ${journalId})))::int
             + (SELECT COUNT(*) FROM bank_line_extra_matches x WHERE x.journal_line_id IN (SELECT id FROM journal_lines WHERE journal_id = ${journalId}))::int AS n`);
  }
}
