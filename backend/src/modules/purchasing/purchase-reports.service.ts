import { Injectable } from '@nestjs/common';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { diffDays, todayJakarta } from '../../common/utils/dates';
import { D, Dec, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { purchaseInvoices, supplierPayments } from '../../db/schema';
import { PurchaseInvoicesService } from './purchase-invoices.service';

@Injectable()
export class PurchaseReportsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly invoices: PurchaseInvoicesService,
  ) {}


  /** Laporan selisih harga faktur terhadap PO, dengan penanda untuk ditinjau (anti-fraud) */
  async priceVarianceReport(tenantId: string, from?: string, to?: string) {
    const rows = (
      await this.db.execute<{
        id: string; number: string; date: string; supplier_invoice_no: string; supplier: string; sku: string; product: string; po_number: string | null;
        po_price: string | null; inv_price: string; qty: string; variance: string; reason: string | null; note: string | null; flags: string | null;
        created_by: string | null; approved_by: string | null; same_user: boolean | null; fx_only: boolean | null;
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
        ORDER BY i.date DESC, i.number DESC LIMIT 500`)
    ).rows;
    const out = rows.map((r) => {
      const variance = Number(r.variance);
      // selisih yang hanya karena kurs (harga valas sama dengan PO) bukan kenaikan harga dari supplier
      const flags = [...(r.flags ? r.flags.split(',') : []), ...(r.fx_only ? ['FX_RATE'] : []), ...(!r.fx_only && r.same_user && variance > 0 ? ['SAME_USER'] : []), ...(!r.fx_only && variance > 0 && !r.approved_by ? ['NO_APPROVAL'] : [])];
      const po = r.po_price != null ? Number(r.po_price) : null;
      return {
        invoiceId: r.id, invoiceNumber: r.number, date: r.date, supplierInvoiceNo: r.supplier_invoice_no, supplier: r.supplier, sku: r.sku, product: r.product,
        poNumber: r.po_number, poPrice: po, invoicePrice: Number(r.inv_price), qty: Number(r.qty), variance, pct: po ? Math.round(((Number(r.inv_price) - po) / po) * 1000) / 10 : null,
        reason: r.reason, note: r.note, createdBy: r.created_by, approvedBy: r.approved_by, flags,
      };
    });
    const group = (key: (r: (typeof out)[number]) => string | null) => {
      const m = new Map<string, { name: string; count: number; total: number; increase: number; flagged: number }>();
      for (const r of out) {
        const k = key(r) ?? '(tidak tercatat)';
        const g = m.get(k) ?? { name: k, count: 0, total: 0, increase: 0, flagged: 0 };
        g.count++;
        g.total += r.variance;
        if (r.variance > 0) g.increase += r.variance;
        if (r.flags.some((f) => f !== 'NO_APPROVAL')) g.flagged++;
        m.set(k, g);
      }
      return [...m.values()].sort((a, b) => b.increase - a.increase);
    };
    return {
      rows: out,
      bySupplier: group((r) => r.supplier),
      byUser: group((r) => r.createdBy),
      totals: { count: out.length, net: out.reduce((a, r) => a + r.variance, 0), increase: out.reduce((a, r) => a + Math.max(0, r.variance), 0), flagged: out.filter((r) => r.flags.some((f) => f !== 'NO_APPROVAL')).length },
    };
  }


  listPayments(tenantId: string) {
    return this.db.query.supplierPayments.findMany({
      where: eq(supplierPayments.tenantId, tenantId),
      with: {
        supplier: { columns: { code: true, name: true } },
        invoice: { columns: { number: true, supplierInvoiceNo: true } },
        cashAccount: { columns: { code: true, name: true } },
      },
      orderBy: [desc(supplierPayments.date), desc(supplierPayments.number)],
      limit: 300,
    });
  }


  /** Umur hutang per supplier */
  async apAging(tenantId: string) {
    const today = todayJakarta();
    const open = await this.db.query.purchaseInvoices.findMany({
      where: and(eq(purchaseInvoices.tenantId, tenantId), ne(purchaseInvoices.status, 'PAID')),
      with: { supplier: { columns: { id: true, code: true, name: true } } },
    });
    type Bucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';
    const map = new Map<string, { supplier: { id: string; code: string; name: string }; total: Dec } & Record<Bucket, Dec>>();
    for (const inv of open) {
      const outstanding = D(inv.total).minus(inv.paidAmount).minus(inv.returnedAmount);
      if (outstanding.lte(0)) continue;
      const days = diffDays(inv.dueDate, today);
      const bucket: Bucket = days <= 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90_plus';
      const row = map.get(inv.supplierId) ?? {
        supplier: inv.supplier,
        total: ZERO,
        current: ZERO,
        d1_30: ZERO,
        d31_60: ZERO,
        d61_90: ZERO,
        d90_plus: ZERO,
      };
      row[bucket] = row[bucket].plus(outstanding);
      row.total = row.total.plus(outstanding);
      map.set(inv.supplierId, row);
    }
    return [...map.values()].sort((a, b) => b.total.comparedTo(a.total));
  }
}
