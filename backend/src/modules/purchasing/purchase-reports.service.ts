import { Injectable } from '@nestjs/common';
import { and, desc, eq, ne } from 'drizzle-orm';
import { diffDays, todayJakarta } from '../../common/utils/dates';
import { D, Dec, ZERO } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { purchaseInvoices, supplierPayments } from '../../db/schema';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { PurchaseReportsRepository } from './purchase-reports.repository';

@Injectable()
export class PurchaseReportsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly invoices: PurchaseInvoicesService,
    private readonly repo: PurchaseReportsRepository,
  ) {}


  /** Laporan selisih harga faktur terhadap PO, dengan penanda untuk ditinjau (anti-fraud) */
  async priceVarianceReport(tenantId: string, from?: string, to?: string) {
    const rows = (
      await this.repo.queryPurchaseInvoiceLine(this.db, tenantId, from, to)
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
