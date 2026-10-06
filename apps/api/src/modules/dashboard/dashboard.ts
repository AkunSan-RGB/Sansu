import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { and, count, desc, eq, gte, inArray, lt, lte, ne, sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { monthStart, todayJakarta } from '../../common/utils/dates';
import { D } from '../../common/utils/money';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { accounts, invoices, journalLines, purchaseInvoices, salesOrders, stockBalances } from '../../db/schema';
import { HealthService } from '../insights/health.service';
import { InsightsModule } from '../insights/insights.module';
import { TaxModule, TaxService, TAX_LABEL } from '../tax/tax.module';
import { addDays } from '../../common/utils/dates';

/** Bidang beranda yang boleh dilihat tiap peran (prinsip "perlu tahu"); selain itu dikirim null */
const SALES_FIELDS = ['salesMonth', 'invoicesMonth', 'arOutstanding', 'arOverdue', 'overdueCount', 'ordersPending', 'recentInvoices'] as const;
const WAREHOUSE_FIELDS = ['ordersPending'] as const;

export function redactDashboard<T extends Record<string, unknown> & { recentInvoices: unknown[] }>(full: T, role: string) {
  if (['OWNER', 'ADMIN', 'FINANCE'].includes(role)) return full;
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
    const [ap] = await this.db
      .select({
        v: sql<string>`COALESCE(SUM(${purchaseInvoices.total} - ${purchaseInvoices.paidAmount} - ${purchaseInvoices.returnedAmount}), 0)`,
        n: count(),
      })
      .from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.tenantId, tenantId), ne(purchaseInvoices.status, 'PAID'), lte(purchaseInvoices.dueDate, addDays(today, 7))));
    if (ap.n)
      items.push({
        key: 'ap-due',
        level: 'info',
        title: `${ap.n} faktur supplier jatuh tempo ≤ 7 hari`,
        detail: `Total ${Number(ap.v).toLocaleString('id-ID', { maximumFractionDigits: 0 })} — siapkan dana pembayaran`,
        link: '/purchase-invoices',
      });
    const low = await this.db.execute<{ n: number; wh: number }>(sql`
      SELECT COUNT(*)::int AS n, COUNT(DISTINCT m.warehouse_id)::int AS wh
      FROM stock_minimums m
      JOIN products p ON p.id = m.product_id AND p.is_active
      JOIN warehouses w ON w.id = m.warehouse_id AND w.is_active
      LEFT JOIN stock_balances b ON b.product_id = m.product_id AND b.warehouse_id = m.warehouse_id
      WHERE m.tenant_id = ${tenantId} AND COALESCE(b.qty, 0) < m.min_qty`);
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
  async summary(tenantId: string, role: string) {
    const today = todayJakarta();
    const outstanding = sql<string>`COALESCE(SUM(${invoices.total} - ${invoices.paidAmount} - ${invoices.returnedAmount}), 0)`;

    const [[sales], [ar], [overdue], [stock], [pending], recent, [ap], [cash]] = await Promise.all([
      this.db
        .select({
          sales: sql<string>`COALESCE(SUM(${invoices.subtotal}), 0)`,
          cogs: sql<string>`COALESCE(SUM(${invoices.cogsAmount}), 0)`,
          n: count(),
        })
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.isOpening, false), gte(invoices.date, monthStart(today)), lte(invoices.date, today))),
      this.db
        .select({ v: outstanding })
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), ne(invoices.status, 'PAID'))),
      this.db
        .select({ v: outstanding, n: count() })
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), ne(invoices.status, 'PAID'), lt(invoices.dueDate, today))),
      this.db
        .select({ v: sql<string>`COALESCE(SUM(${stockBalances.qty} * ${stockBalances.avgCost}), 0)` })
        .from(stockBalances)
        .where(eq(stockBalances.tenantId, tenantId)),
      this.db
        .select({ n: count() })
        .from(salesOrders)
        .where(and(eq(salesOrders.tenantId, tenantId), inArray(salesOrders.status, ['DRAFT', 'CONFIRMED']))),
      this.db.query.invoices.findMany({
        where: eq(invoices.tenantId, tenantId),
        with: { customer: { columns: { name: true } } },
        orderBy: [desc(invoices.createdAt)],
        limit: 5,
      }),
      this.db
        .select({
          v: sql<string>`COALESCE(SUM(${purchaseInvoices.total} - ${purchaseInvoices.paidAmount} - ${purchaseInvoices.returnedAmount}), 0)`,
        })
        .from(purchaseInvoices)
        .where(and(eq(purchaseInvoices.tenantId, tenantId), ne(purchaseInvoices.status, 'PAID'))),
      this.db
        .select({ v: sql<string>`COALESCE(SUM(${journalLines.debit} - ${journalLines.credit}), 0)` })
        .from(journalLines)
        .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
        .where(and(eq(accounts.tenantId, tenantId), eq(accounts.isCashAccount, true))),
    ]);

    const salesMonth = D(sales.sales);
    const grossProfit = salesMonth.minus(sales.cogs);
    return redactDashboard({
      salesMonth: salesMonth.toFixed(2),
      grossProfitMonth: grossProfit.toFixed(2),
      grossMarginPct: salesMonth.isZero() ? '0' : grossProfit.div(salesMonth).times(100).toFixed(1),
      invoicesMonth: sales.n,
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

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get()
  summary(@CurrentUser() u: AuthUser) {
    return this.svc.summary(u.tenantId, u.role);
  }

  @Get('attention')
  @Roles('ADMIN', 'FINANCE')
  attention(@CurrentUser() u: AuthUser) {
    return this.svc.attention(u.tenantId);
  }
}

@Module({ imports: [InsightsModule, TaxModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
