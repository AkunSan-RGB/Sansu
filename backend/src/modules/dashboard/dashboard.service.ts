import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { todayJakarta } from '../../common/utils/dates';
import { D } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { invoices, journalLines, purchaseInvoices, salesOrders, stockBalances } from '../../db/schema';
import { HealthService } from '../insights/health.service';
import { TaxService, TAX_LABEL } from '../tax/tax.service';
import { addDays } from '../../common/utils/dates';
import { DashboardRepository } from './dashboard.repository';

/** Bidang beranda yang boleh dilihat tiap peran (prinsip "perlu tahu"); selain itu dikirim null */
const SALES_FIELDS = ['salesMonth', 'invoicesMonth', 'posOrdersMonth', 'arOutstanding', 'arOverdue', 'overdueCount', 'ordersPending', 'recentInvoices'] as const;

const WAREHOUSE_FIELDS = ['ordersPending'] as const;

export function redactDashboard<T extends Record<string, unknown> & { recentInvoices: unknown[] }>(full: T, role: string) {
  if (['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'].includes(role)) return full;
  const keep: readonly string[] = role === 'SALES' ? SALES_FIELDS : role === 'WAREHOUSE' ? WAREHOUSE_FIELDS : [];
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(full)) out[k] = keep.includes(k) ? full[k] : k === 'recentInvoices' ? [] : null;
  return out as { [K in keyof T]: T[K] | null };
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly health: HealthService,
    private readonly tax: TaxService,
    private readonly repo: DashboardRepository,
  ) {}

  /**
   * Daftar "perlu perhatian" lintas modul untuk pemilik & bagian keuangan:
   * setoran pajak yang mendekati / lewat jatuh tempo, hasil cek kesehatan yang belum beres,
   * dan utang supplier yang jatuh tempo minggu ini.
   */
  async attention(tenantId: string) {
    const today = todayJakarta();
    const items: { key: string; level: 'error' | 'warning' | 'info'; title: string; detail: string; link: string }[] = [];
    const prev = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    for (const period of [prev, today.slice(0, 7)]) {
      for (const o of await this.tax.obligations(tenantId, period)) {
        if (Number(o.outstanding) <= 0) continue;
        const days = Math.round((Date.parse(o.dueDate) - Date.parse(today)) / 86400000);
        if (days > 14) continue;
        items.push({
          key: `tax-${o.type}-${o.period}`,
          level: days < 0 ? 'error' : 'warning',
          title: `${TAX_LABEL[o.type]} masa ${o.period}: ${Number(o.outstanding).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`,
          detail: days < 0 ? `Lewat jatuh tempo ${-days} hari (${o.dueDate})` : days === 0 ? 'Jatuh tempo hari ini' : `Jatuh tempo ${days} hari lagi (${o.dueDate})`,
          link: '/tax',
        });
      }
    }
    const h = await this.health.run(tenantId);
    for (const c of h.checks.filter((x) => x.status === 'ERROR' || x.status === 'WARN')) {
      items.push({ key: `health-${c.key}`, level: c.status === 'ERROR' ? 'error' : 'warning', title: c.title, detail: c.message, link: c.link ?? '/health' });
    }
    const [ap] = await this.repo.countPurchaseInvoicesByStatusAndDueDate(this.db, tenantId, today);
    if (ap.n)
      items.push({
        key: 'ap-due',
        level: 'info',
        title: `${ap.n} faktur supplier jatuh tempo ≤ 7 hari`,
        detail: `Total ${Number(ap.v).toLocaleString('id-ID', { maximumFractionDigits: 0 })} — siapkan dana pembayaran`,
        link: '/purchase-invoices',
      });
    const low = await this.repo.queryStockMinimum(this.db, tenantId);
    if (low.rows[0]?.n)
      items.push({
        key: 'low-stock',
        level: 'warning',
        title: `${low.rows[0].n} produk di bawah stok minimum`,
        detail: `Di ${low.rows[0].wh} gudang — buat pesanan pembelian atau transfer antar gudang`,
        link: '/inventory/warehouses?tab=low',
      });
    const order = { error: 0, warning: 1, info: 2 };
    return { score: h.score, grade: h.grade, items: items.sort((a, b) => order[a.level] - order[b.level]) };
  }

  /** Ringkasan untuk pemilik: penjualan bulan ini, piutang, nilai stok, faktur jatuh tempo. */
  async summary(tenantId: string, role: string, branchId?: string) {
    const today = todayJakarta();
    // Filter cabang (id cabang atau 'NONE' = Pusat): cabang dokumen = cabang gudangnya; tanpa gudang/cabang = Pusat
    const whBranch = (whCol: ReturnType<typeof sql>) => sql`COALESCE((SELECT w.branch_id::text FROM warehouses w WHERE w.id = ${whCol}), 'NONE') = ${branchId}`;
    const invBr = branchId ? sql`COALESCE((SELECT w.branch_id::text FROM sales_orders so JOIN warehouses w ON w.id = so.warehouse_id WHERE so.id = ${invoices.salesOrderId}), 'NONE') = ${branchId}` : undefined;
    const soBr = branchId ? whBranch(sql`${salesOrders.warehouseId}`) : undefined;
    const piBr = branchId ? whBranch(sql`${purchaseInvoices.warehouseId}`) : undefined;
    const stBr = branchId ? whBranch(sql`${stockBalances.warehouseId}`) : undefined;
    const cashBr = branchId ? sql`COALESCE(${journalLines.branchId}::text, 'NONE') = ${branchId}` : undefined;
    const outstanding = sql<string>`COALESCE(SUM(${invoices.total} - ${invoices.paidAmount} - ${invoices.returnedAmount}), 0)`;

    // Penjualan dan laba kotor bulan ini diambil dari PEMBUKUAN (kelompok laporan yang sama dengan Laporan Laba Rugi), bukan dari faktur saja:
    // penjualan kasir ikut terhitung, retur/potongan dikurangkan, dan pendapatan jasa/lainnya yang dijurnal ikut masuk.
    const ledBr = branchId ? sql`AND COALESCE(jl.branch_id::text, 'NONE') = ${branchId}` : sql``;
    const posBr = branchId ? sql`AND COALESCE((SELECT w.branch_id::text FROM pos_sessions s JOIN warehouses w ON w.id = s.warehouse_id WHERE s.id = po.session_id), 'NONE') = ${branchId}` : sql``;
    const [[sales], [ar], [overdue], [stock], [pending], recent, [ap], [cash]] = await Promise.all([
      this.repo.countInvoicesByIsOpeningAndDate(this.db, tenantId, today, invBr),
      this.repo.listInvoicesByStatus(this.db, outstanding, tenantId, invBr),
      this.repo.countInvoicesByStatusAndDueDate(this.db, outstanding, tenantId, today, invBr),
      this.repo.sumStockBalances(this.db, tenantId, stBr),
      this.repo.countSalesOrdersByStatus(this.db, tenantId, soBr),
      this.db.query.invoices.findMany({
        where: and(eq(invoices.tenantId, tenantId), invBr),
        with: { customer: { columns: { name: true } } },
        orderBy: [desc(invoices.createdAt)],
        limit: 5,
      }),
      this.repo.sumPurchaseInvoicesByStatus(this.db, tenantId, piBr),
      this.repo.sumJournalLinesWithAccounts(this.db, tenantId, cashBr),
    ]);

    const led = await this.repo.queryJournalLine(this.db, tenantId, today, ledBr);
    const grp = (g: string) => D(led.rows.find((r) => r.grp === g)?.v ?? 0);
    const salesMonth = grp('SALES_REVENUE').plus(grp('SALES_DEDUCTION'));
    const grossProfit = salesMonth.plus(grp('COST_OF_SALES')); // beban pokok bersaldo debit → negatif pada credit−debit
    const posN = (await this.repo.queryPosOrder(this.db, tenantId, today, posBr)).rows[0]?.n ?? 0;
    return redactDashboard({
      salesMonth: salesMonth.toFixed(2),
      grossProfitMonth: grossProfit.toFixed(2),
      grossMarginPct: salesMonth.isZero() ? '0' : grossProfit.div(salesMonth).times(100).toFixed(1),
      invoicesMonth: sales.n,
      posOrdersMonth: posN,
      arOutstanding: D(ar.v).toFixed(2),
      arOverdue: D(overdue.v).toFixed(2),
      overdueCount: overdue.n,
      stockValue: D(stock.v).toFixed(2),
      apOutstanding: D(ap.v).toFixed(2),
      cashBalance: D(cash.v).toFixed(2),
      ordersPending: pending.n,
      recentInvoices: recent,
    }, role);
  }
}
