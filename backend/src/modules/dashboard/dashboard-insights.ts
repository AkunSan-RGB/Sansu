/**
 * Insight & rekomendasi beranda untuk pimpinan: ringkasan kondisi + tren 6 bulan + saran yang diturunkan dari data pembukuan dan transaksi.
 * Aturan deterministik dan dapat dijelaskan (lihat insight-rules.ts); bersifat saran, bukan keharusan.
 */
import { Controller, Get, Injectable, Logger } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { MOVEMENT_PROFILES } from '@sansu/shared';
import { SettingsService } from '../../common/settings.service';
import { addDays, monthStart, todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import {
  concentrationInsight,
  costRiseInsight,
  deadStockInsight,
  type DashboardInsight,
  expiryInsight,
  lapsedCustomersInsight,
  lowMarginProductsInsight,
  lowStockInsight,
  marginInsight,
  overdueReceivableInsight,
  payableInsight,
  rankInsights,
  runwayInsight,
  salesTrendInsight,
  summarize,
  topProductsInsight,
} from './insight-rules';

const num = (v: unknown) => Number(v ?? 0) || 0;

/** Awal bulan (YYYY-MM-01) n bulan dari bulan `ymd` (n boleh negatif) */
export function addMonths(ymd: string, n: number): string {
  const [y, m] = ymd.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`;
}
const daysInMonth = (ymd: string) => new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), 0).getDate();

export interface TrendPoint {
  month: string;
  sales: number;
  grossProfit: number;
  expense: number;
}

@Injectable()
export class DashboardInsightsService {
  private readonly log = new Logger('DashboardInsights');
  constructor(@InjectDb() private readonly db: Db, private readonly settings: SettingsService) {}

  /** Jalankan satu pengumpul data; kegagalan satu aturan tidak boleh menggagalkan seluruh beranda */
  private async safe<T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      this.log.warn(`insight ${name} dilewati: ${(e as Error).message}`);
      return fallback;
    }
  }

  async build(tenantId: string) {
    const today = todayJakarta();
    const curMonth = monthStart(today);
    const start6 = addMonths(curMonth, -5);
    const d90 = addDays(today, -90);
    const d60 = addDays(today, -60);
    const d180 = addDays(today, -180);
    const rows = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) => (await this.db.execute<T>(q)).rows;

    // ---- tren bulanan dari pembukuan (kelompok akun sama dengan Laporan Laba Rugi)
    const series = await this.safe('tren', async () => {
      const r = await rows<{ m: string; grp: string; v: string }>(sql`
        SELECT to_char(je.date, 'YYYY-MM') AS m, a.report_group AS grp, COALESCE(SUM(jl.credit - jl.debit), 0)::text AS v
        FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
        WHERE a.tenant_id = ${tenantId} AND je.date >= ${start6} AND je.date <= ${today}
          AND a.report_group IN ('SALES_REVENUE', 'SALES_DEDUCTION', 'COST_OF_SALES', 'SELLING_EXPENSE', 'ADMIN_EXPENSE')
        GROUP BY 1, 2`);
      const pts: TrendPoint[] = [];
      for (let i = 0; i < 6; i++) {
        const mo = addMonths(start6, i).slice(0, 7);
        const g = (grp: string) => num(r.find((x) => x.m === mo && x.grp === grp)?.v);
        const sales = g('SALES_REVENUE') + g('SALES_DEDUCTION');
        const cost = -g('COST_OF_SALES');
        pts.push({ month: mo, sales, grossProfit: sales - cost, expense: cost + -(g('SELLING_EXPENSE') + g('ADMIN_EXPENSE')) });
      }
      return pts;
    }, [] as TrendPoint[]);

    const opexOf = async (from: string, to: string) =>
      num((await rows<{ v: string }>(sql`
        SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::text AS v FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
        WHERE a.tenant_id = ${tenantId} AND je.date >= ${from} AND je.date < ${to} AND a.report_group IN ('SELLING_EXPENSE', 'ADMIN_EXPENSE')`))[0]?.v);

    const items: DashboardInsight[] = [];
    const push = (i: DashboardInsight | null) => { if (i) items.push(i); };

    // ---- kas & daya tahan
    const cash = await this.safe('kas', async () => num((await rows<{ v: string }>(sql`
      SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::text AS v FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE a.tenant_id = ${tenantId} AND a.is_cash_account`))[0]?.v), 0);
    const full = series.slice(2, 5); // 3 bulan penuh terakhir (bulan berjalan belum utuh)
    const withCost = full.filter((p) => p.expense > 0);
    const monthlyCost = withCost.length ? withCost.reduce((a, p) => a + p.expense, 0) / withCost.length : 0;
    push(runwayInsight({ cash, monthlyCost }));

    // ---- tren penjualan & margin (pembukuan)
    const cur = series[5];
    const day = Number(today.slice(8, 10));
    const prevStart = addMonths(curMonth, -1);
    const prevEnd = addDays(prevStart, Math.min(day, daysInMonth(prevStart)) - 1);
    const prevSame = await this.safe('tren-jual', async () => num((await rows<{ v: string }>(sql`
      SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::text AS v FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
      WHERE a.tenant_id = ${tenantId} AND je.date >= ${prevStart} AND je.date <= ${prevEnd} AND a.report_group IN ('SALES_REVENUE', 'SALES_DEDUCTION')`))[0]?.v), 0);
    if (cur) {
      push(salesTrendInsight({ mtd: cur.sales, prevSame, daysElapsed: day, daysInMonth: daysInMonth(curMonth), monthsWithSales: series.slice(0, 5).filter((p) => p.sales > 0).length }));
      const prev3 = series.slice(2, 5).filter((p) => p.sales > 0);
      if (prev3.length && cur.sales > 0 && day >= 5) {
        const avgPrev = prev3.reduce((a, p) => a + p.grossProfit / p.sales, 0) / prev3.length;
        push(marginInsight({ gm: cur.grossProfit / cur.sales, avgPrev, sales: cur.sales }));
      }
    }

    // ---- beban usaha
    if (series.length === 6) {
      const lastOpex = await this.safe('biaya', () => opexOf(addMonths(curMonth, -1), curMonth), 0);
      const priorOpex = await this.safe('biaya-3', () => opexOf(addMonths(curMonth, -4), addMonths(curMonth, -1)), 0);
      const top = await this.safe('biaya-top', async () => {
        const r = await rows<{ name: string; m: string; v: string }>(sql`
          SELECT a.name, to_char(je.date, 'YYYY-MM') AS m, SUM(jl.debit - jl.credit)::text AS v FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
          WHERE a.tenant_id = ${tenantId} AND je.date >= ${addMonths(curMonth, -4)} AND je.date < ${curMonth} AND a.report_group IN ('SELLING_EXPENSE', 'ADMIN_EXPENSE')
          GROUP BY a.name, 2`);
        const lastKey = addMonths(curMonth, -1).slice(0, 7);
        const byName = new Map<string, { last: number; sum: number }>();
        for (const x of r) { const e = byName.get(x.name) ?? { last: 0, sum: 0 }; if (x.m === lastKey) e.last += num(x.v); else e.sum += num(x.v); byName.set(x.name, e); }
        let best: { name: string; delta: number } | undefined;
        for (const [name, e] of byName) { const d = e.last - e.sum / 3; if (!best || d > best.delta) best = { name, delta: d }; }
        return best && best.delta > 0 ? best : undefined;
      }, undefined);
      push(costRiseInsight({ last: lastOpex, avgPrev: priorOpex / 3, top }));
    }

    // ---- piutang
    await this.safe('piutang', async () => {
      const tot = (await rows<{ ar: string; overdue: string; n: string }>(sql`
        SELECT COALESCE(SUM(total - paid_amount - returned_amount), 0)::text AS ar,
               COALESCE(SUM(total - paid_amount - returned_amount) FILTER (WHERE due_date < ${today}), 0)::text AS overdue,
               COUNT(*) FILTER (WHERE due_date < ${today})::text AS n
        FROM invoices WHERE tenant_id = ${tenantId} AND status <> 'PAID'`))[0];
      const top = await rows<{ name: string; amt: string }>(sql`
        SELECT c.name, SUM(i.total - i.paid_amount - i.returned_amount)::text AS amt FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.tenant_id = ${tenantId} AND i.status <> 'PAID' AND i.due_date < ${today} GROUP BY c.id, c.name ORDER BY SUM(i.total - i.paid_amount - i.returned_amount) DESC LIMIT 3`);
      const sales90 = num((await rows<{ v: string }>(sql`SELECT COALESCE(SUM(subtotal), 0)::text AS v FROM invoices WHERE tenant_id = ${tenantId} AND NOT is_opening AND date >= ${d90} AND date <= ${today}`))[0]?.v);
      push(overdueReceivableInsight({ ar: num(tot?.ar), overdue: num(tot?.overdue), overdueCount: num(tot?.n), top: top.map((t) => ({ name: t.name, amount: num(t.amt) })), dso: sales90 > 0 ? num(tot?.ar) / (sales90 / 90) : null }));
    }, undefined);

    // ---- hutang vs kas
    await this.safe('hutang', async () => {
      const r = (await rows<{ overdue: string; due14: string }>(sql`
        SELECT COALESCE(SUM(total - paid_amount - returned_amount) FILTER (WHERE due_date < ${today}), 0)::text AS overdue,
               COALESCE(SUM(total - paid_amount - returned_amount) FILTER (WHERE due_date <= ${addDays(today, 14)}), 0)::text AS due14
        FROM purchase_invoices WHERE tenant_id = ${tenantId} AND status <> 'PAID'`))[0];
      push(payableInsight({ overdue: num(r?.overdue), due14: num(r?.due14), cash }));
    }, undefined);

    // ---- pelanggan: konsentrasi dan yang mulai hilang
    await this.safe('pelanggan', async () => {
      const r = await rows<{ name: string; amt: string }>(sql`
        SELECT c.name, SUM(i.subtotal)::text AS amt FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.tenant_id = ${tenantId} AND NOT i.is_opening AND i.date >= ${d90} AND i.date <= ${today} GROUP BY c.id, c.name ORDER BY SUM(i.subtotal) DESC`);
      const total = r.reduce((a, x) => a + num(x.amt), 0);
      if (r.length >= 3 && total > 0) push(concentrationInsight({ name: r[0].name, share: num(r[0].amt) / total, amount: num(r[0].amt), total }));
      const lapsed = await rows<{ name: string; past: string }>(sql`
        SELECT c.name, SUM(i.subtotal)::text AS past FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.tenant_id = ${tenantId} AND NOT i.is_opening AND i.date >= ${d180} AND i.date <= ${today}
        GROUP BY c.id, c.name
        HAVING COALESCE(SUM(i.subtotal) FILTER (WHERE i.date >= ${d60}), 0) = 0 AND COALESCE(SUM(i.subtotal) FILTER (WHERE i.date < ${d60}), 0) > 0
        ORDER BY SUM(i.subtotal) DESC LIMIT 5`);
      push(lapsedCustomersInsight({ customers: lapsed.map((x) => ({ name: x.name, past: num(x.past) })) }));
    }, undefined);

    // ---- produk (90 hari): penyumbang laba dan margin tipis
    await this.safe('produk', async () => {
      const r = await rows<{ name: string; src: string; rev: string; gp: string }>(sql`
        WITH l AS (
          SELECT il.product_id, 'INV' AS src, il.line_total AS rev, il.line_total - il.qty * il.uom_factor * il.unit_cost AS gp
          FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id WHERE i.tenant_id = ${tenantId} AND NOT i.is_opening AND i.date >= ${d90} AND i.date <= ${today}
          UNION ALL
          SELECT pl.product_id, 'POS', pl.line_total, pl.line_total - pl.qty * pl.uom_factor * pl.unit_cost
          FROM pos_order_lines pl JOIN pos_orders po ON po.id = pl.order_id WHERE po.tenant_id = ${tenantId} AND po.date >= ${d90} AND po.date <= ${today})
        SELECT p.name, l.src, SUM(l.rev)::text AS rev, SUM(l.gp)::text AS gp FROM l JOIN products p ON p.id = l.product_id GROUP BY p.id, p.name, l.src`);
      const byName = new Map<string, { rev: number; gp: number; inv: { rev: number; gp: number } }>();
      for (const x of r) {
        const e = byName.get(x.name) ?? { rev: 0, gp: 0, inv: { rev: 0, gp: 0 } };
        e.rev += num(x.rev); e.gp += num(x.gp);
        if (x.src === 'INV') { e.inv.rev += num(x.rev); e.inv.gp += num(x.gp); }
        byName.set(x.name, e);
      }
      const all = [...byName.entries()].map(([name, e]) => ({ name, ...e }));
      const totalRev = all.reduce((a, x) => a + x.rev, 0);
      const totalGp = all.filter((x) => x.gp > 0).reduce((a, x) => a + x.gp, 0);
      push(topProductsInsight({ top: all.filter((x) => x.gp > 0).sort((a, b) => b.gp - a.gp).slice(0, 3).map((x) => ({ name: x.name, gp: x.gp })), totalGp, productCount: all.filter((x) => x.gp > 0).length }));
      // margin tipis hanya dari faktur: harga kasir sudah termasuk PPN sehingga marginnya tidak sebanding
      const thin = all.filter((x) => x.inv.rev >= Math.max(500_000, totalRev * 0.01) && (x.inv.gp / x.inv.rev) * 100 < 5)
        .sort((a, b) => b.inv.rev - a.inv.rev).slice(0, 5).map((x) => ({ name: x.name, revenue: x.inv.rev, marginPct: (x.inv.gp / x.inv.rev) * 100 }));
      push(lowMarginProductsInsight({ items: thin }));
    }, undefined);

    // ---- persediaan
    await this.safe('stok', async () => {
      const total = num((await rows<{ v: string }>(sql`SELECT COALESCE(SUM(qty * avg_cost), 0)::text AS v FROM stock_balances WHERE tenant_id = ${tenantId} AND qty > 0`))[0]?.v);
      if (total > 0) {
        const model = await this.settings.businessModel(this.db, tenantId);
        const deadDays = Math.max(60, MOVEMENT_PROFILES[model]?.deadDays ?? 90);
        const dStart = addDays(today, -deadDays);
        const dead = await rows<{ name: string; v: string }>(sql`
          SELECT p.name, SUM(b.qty * b.avg_cost)::text AS v FROM stock_balances b JOIN products p ON p.id = b.product_id
          WHERE b.tenant_id = ${tenantId} AND b.qty > 0 AND p.is_active
            AND NOT EXISTS (SELECT 1 FROM stock_moves m WHERE m.tenant_id = ${tenantId} AND m.product_id = b.product_id AND m.type IN ('SALE', 'PRODUCTION_ISSUE') AND m.date >= ${dStart})
            AND EXISTS (SELECT 1 FROM stock_moves m2 WHERE m2.tenant_id = ${tenantId} AND m2.product_id = b.product_id AND m2.date < ${dStart})
          GROUP BY p.id, p.name ORDER BY SUM(b.qty * b.avg_cost) DESC`);
        push(deadStockInsight({ dead: dead.reduce((a, x) => a + num(x.v), 0), total, n: dead.length, top: dead.slice(0, 3).map((x) => ({ name: x.name, value: num(x.v) })), days: deadDays }));
      }
      const exp = await rows<{ name: string; expired: boolean; v: string }>(sql`
        SELECT p.name, (l.expiry_date < ${today}) AS expired, SUM(l.qty_remaining * COALESCE(b.avg_cost, 0))::text AS v
        FROM stock_lots l JOIN products p ON p.id = l.product_id LEFT JOIN stock_balances b ON b.product_id = l.product_id AND b.warehouse_id = l.warehouse_id
        WHERE l.tenant_id = ${tenantId} AND l.qty_remaining > 0 AND l.expiry_date IS NOT NULL AND l.expiry_date <= ${addDays(today, 30)}
        GROUP BY p.id, p.name, (l.expiry_date < ${today}) ORDER BY SUM(l.qty_remaining * COALESCE(b.avg_cost, 0)) DESC`);
      const ex = exp.filter((x) => x.expired);
      const so = exp.filter((x) => !x.expired);
      push(expiryInsight({ expiredValue: ex.reduce((a, x) => a + num(x.v), 0), expiredN: ex.length, soonValue: so.reduce((a, x) => a + num(x.v), 0), soonN: so.length, top: [...ex, ...so].slice(0, 3).map((x) => x.name) }));
      const low = await rows<{ name: string }>(sql`
        SELECT p.name FROM stock_minimums m JOIN products p ON p.id = m.product_id AND p.is_active JOIN warehouses w ON w.id = m.warehouse_id AND w.is_active
        LEFT JOIN stock_balances b ON b.product_id = m.product_id AND b.warehouse_id = m.warehouse_id
        WHERE m.tenant_id = ${tenantId} AND COALESCE(b.qty, 0) < m.min_qty ORDER BY (m.min_qty - COALESCE(b.qty, 0)) DESC`);
      push(lowStockInsight({ n: low.length, top: low.slice(0, 3).map((x) => x.name) }));
    }, undefined);

    const insights = rankInsights(items);
    return {
      asOf: today,
      summary: summarize(insights),
      trend: series,
      insights,
      note: 'Saran dihitung otomatis dari data pembukuan dan transaksi. Sifatnya masukan untuk pertimbangan; keputusan tetap pada Anda.',
    };
  }
}

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardInsightsController {
  constructor(private readonly svc: DashboardInsightsService) {}

  @Get('insights')
  @Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
  insights(@CurrentUser() u: AuthUser) {
    // data perusahaan utuh, bukan per cabang (sama dengan daftar "perlu perhatian")
    if (u.branchIds?.length) return { asOf: todayJakarta(), summary: summarize([]), trend: [], insights: [], note: 'Saran tersedia untuk akun tingkat perusahaan.' };
    return this.svc.build(u.tenantId);
  }
}
