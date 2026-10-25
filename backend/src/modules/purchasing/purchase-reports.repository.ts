import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';

/** Akses data untuk PurchaseReports: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class PurchaseReportsRepository {
  /** Dipakai oleh PurchaseReportsService.priceVarianceReport */
  queryPurchaseInvoiceLine(db: DbOrTx, tenantId: string, from: string | undefined, to: string | undefined) {
    return db.execute<{
      id: string;
      number: string;
      date: string;
      supplier_invoice_no: string;
      supplier: string;
      sku: string;
      product: string;
      po_number: string | null;
      po_price: string | null;
      inv_price: string;
      qty: string;
      variance: string;
      reason: string | null;
      note: string | null;
      flags: string | null;
      created_by: string | null;
      approved_by: string | null;
      same_user: boolean | null;
      fx_only: boolean | null;
    }>(sql`
        SELECT i.id, i.number, i.date::text AS date, i.supplier_invoice_no, s.name AS supplier, p.sku, p.name AS product, po.number AS po_number,
               ol.price AS po_price, l.price AS inv_price, l.qty, l.price_variance AS variance, i.variance_reason AS reason, i.variance_note AS note,
               i.price_flags AS flags, uc.name AS created_by, ua.name AS approved_by,
               (po.created_by_id IS NOT NULL AND po.created_by_id = i.created_by_id) AS same_user,
               (i.currency <> 'IDR' AND l.price_foreign IS NOT DISTINCT FROM ol.price_foreign) AS fx_only
        FROM purchase_invoice_lines l
        JOIN purchase_invoices i ON i.id = l.invoice_id
        JOIN suppliers s ON s.id = i.supplier_id
        LEFT JOIN products p ON p.id = l.product_id
        LEFT JOIN purchase_order_lines ol ON ol.id = l.order_line_id
        LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
        LEFT JOIN users uc ON uc.id = i.created_by_id
        LEFT JOIN approval_requests ar ON ar.id = i.approval_id
        LEFT JOIN users ua ON ua.id = ar.decided_by_id
        WHERE i.tenant_id = ${tenantId} AND l.price_variance <> 0
          ${from ? sql`AND i.date >= ${from}` : sql``} ${to ? sql`AND i.date <= ${to}` : sql``}
        ORDER BY i.date DESC, i.number DESC LIMIT 500`);
  }
}
