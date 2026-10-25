import { Injectable, Logger } from '@nestjs/common';
import { MOVEMENT_PROFILES } from '@sansu/shared';
import { SettingsService } from '../../common/settings.service';
import { addDays, monthStart, todayJakarta } from '../../common/utils/dates';
import { Db } from '../../db/db';
import { InjectDb } from '../../db/db.module';
import { concentrationInsight, costRiseInsight, deadStockInsight, type DashboardInsight, expiryInsight, lapsedCustomersInsight, lowMarginProductsInsight, lowStockInsight, marginInsight, overdueReceivableInsight, payableInsight, rankInsights, runwayInsight, salesTrendInsight, summarize, topProductsInsight } from './insight-rules';
import { DashboardInsightsRepository, addMonths } from './dashboard-insights.repository';
export { addMonths } from './dashboard-insights.repository';

const num = (v: unknown) => Number(v ?? 0) || 0;

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
  constructor(@InjectDb() private readonly db: Db, private readonly settings: SettingsService,
    private readonly repo: DashboardInsightsRepository) {}

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

    const series = await this.safe('tren', async () => {
      const r = (await this.repo.queryJournalLine(this.db, tenantId, start6, today)).rows;
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
      num(((await this.repo.queryJournalLineForBuild(this.db, tenantId, from, to)).rows)[0]?.v);

    const items: DashboardInsight[] = [];
    const push = (i: DashboardInsight | null) => { if (i) items.push(i); };

    const cash = await this.safe('kas', async () => num(((await this.repo.queryJournalLineForBuild2(this.db, tenantId)).rows)[0]?.v), 0);
    const full = series.slice(2, 5); // 3 bulan penuh terakhir (bulan berjalan belum utuh)
    const withCost = full.filter((p) => p.expense > 0);
    const monthlyCost = withCost.length ? withCost.reduce((a, p) => a + p.expense, 0) / withCost.length : 0;
    push(runwayInsight({ cash, monthlyCost }));

    const cur = series[5];
    const day = Number(today.slice(8, 10));
    const prevStart = addMonths(curMonth, -1);
    const prevEnd = addDays(prevStart, Math.min(day, daysInMonth(prevStart)) - 1);
    const prevSame = await this.safe('tren-jual', async () => num(((await this.repo.queryJournalLineForBuild3(this.db, tenantId, prevStart, prevEnd)).rows)[0]?.v), 0);
    if (cur) {
      push(salesTrendInsight({ mtd: cur.sales, prevSame, daysElapsed: day, daysInMonth: daysInMonth(curMonth), monthsWithSales: series.slice(0, 5).filter((p) => p.sales > 0).length }));
      const prev3 = series.slice(2, 5).filter((p) => p.sales > 0);
      if (prev3.length && cur.sales > 0 && day >= 5) {
        const avgPrev = prev3.reduce((a, p) => a + p.grossProfit / p.sales, 0) / prev3.length;
        push(marginInsight({ gm: cur.grossProfit / cur.sales, avgPrev, sales: cur.sales }));
      }
    }

    if (series.length === 6) {
      const lastOpex = await this.safe('biaya', () => opexOf(addMonths(curMonth, -1), curMonth), 0);
      const priorOpex = await this.safe('biaya-3', () => opexOf(addMonths(curMonth, -4), addMonths(curMonth, -1)), 0);
      const top = await this.safe('biaya-top', async () => {
        const r = (await this.repo.queryJournalLineForBuild4(this.db, tenantId, curMonth)).rows;
        const lastKey = addMonths(curMonth, -1).slice(0, 7);
        const byName = new Map<string, { last: number; sum: number }>();
        for (const x of r) { const e = byName.get(x.name) ?? { last: 0, sum: 0 }; if (x.m === lastKey) e.last += num(x.v); else e.sum += num(x.v); byName.set(x.name, e); }
        let best: { name: string; delta: number } | undefined;
        for (const [name, e] of byName) { const d = e.last - e.sum / 3; if (!best || d > best.delta) best = { name, delta: d }; }
        return best && best.delta > 0 ? best : undefined;
      }, undefined);
      push(costRiseInsight({ last: lastOpex, avgPrev: priorOpex / 3, top }));
    }

    await this.safe('piutang', async () => {
      const tot = ((await this.repo.queryInvoice(this.db, today, tenantId)).rows)[0];
      const top = (await this.repo.queryInvoiceForBuild(this.db, tenantId, today)).rows;
      const sales90 = num(((await this.repo.queryInvoiceForBuild2(this.db, tenantId, d90, today)).rows)[0]?.v);
      push(overdueReceivableInsight({ ar: num(tot?.ar), overdue: num(tot?.overdue), overdueCount: num(tot?.n), top: top.map((t) => ({ name: t.name, amount: num(t.amt) })), dso: sales90 > 0 ? num(tot?.ar) / (sales90 / 90) : null }));
    }, undefined);

    await this.safe('hutang', async () => {
      const r = ((await this.repo.queryPurchaseInvoice(this.db, today, tenantId)).rows)[0];
      push(payableInsight({ overdue: num(r?.overdue), due14: num(r?.due14), cash }));
    }, undefined);

    await this.safe('pelanggan', async () => {
      const r = (await this.repo.queryInvoiceForBuild3(this.db, tenantId, d90, today)).rows;
      const total = r.reduce((a, x) => a + num(x.amt), 0);
      if (r.length >= 3 && total > 0) push(concentrationInsight({ name: r[0].name, share: num(r[0].amt) / total, amount: num(r[0].amt), total }));
      const lapsed = (await this.repo.queryInvoiceForBuild4(this.db, tenantId, d180, today, d60)).rows;
      push(lapsedCustomersInsight({ customers: lapsed.map((x) => ({ name: x.name, past: num(x.past) })) }));
    }, undefined);

    await this.safe('produk', async () => {
      const r = (await this.repo.queryL(this.db, tenantId, d90, today)).rows;
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

    await this.safe('stok', async () => {
      const total = num(((await this.repo.queryStockBalance(this.db, tenantId)).rows)[0]?.v);
      if (total > 0) {
        const model = await this.settings.businessModel(this.db, tenantId);
        const deadDays = Math.max(60, MOVEMENT_PROFILES[model]?.deadDays ?? 90);
        const dStart = addDays(today, -deadDays);
        const dead = (await this.repo.queryStockBalanceForBuild(this.db, tenantId, dStart)).rows;
        push(deadStockInsight({ dead: dead.reduce((a, x) => a + num(x.v), 0), total, n: dead.length, top: dead.slice(0, 3).map((x) => ({ name: x.name, value: num(x.v) })), days: deadDays }));
      }
      const exp = (await this.repo.queryStockLot(this.db, today, tenantId)).rows;
      const ex = exp.filter((x) => x.expired);
      const so = exp.filter((x) => !x.expired);
      push(expiryInsight({ expiredValue: ex.reduce((a, x) => a + num(x.v), 0), expiredN: ex.length, soonValue: so.reduce((a, x) => a + num(x.v), 0), soonN: so.length, top: [...ex, ...so].slice(0, 3).map((x) => x.name) }));
      const low = (await this.repo.queryStockMinimum(this.db, tenantId)).rows;
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
