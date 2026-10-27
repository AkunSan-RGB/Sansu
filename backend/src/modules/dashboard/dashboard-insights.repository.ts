import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';
import { addDays } from '../../common/utils/dates';

/** Awal bulan (YYYY-MM-01) n bulan dari bulan `ymd` (n boleh negatif) */
export function addMonths(ymd: string, n: number): string {
  const [y, m] = ymd.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`;
}

/** Akses data untuk DashboardInsights: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class DashboardInsightsRepository {
  /** Dipakai oleh DashboardInsightsService.build */
  queryJournalLine(db: DbOrTx, tenantId: string, start6: string, today: string) {
    return db.execute<{ m: string; grp: string; v: string }>(sql`
        SELECT to_char(je.date, 'YYYY-MM') AS m, a.report_group AS grp, COALESCE(SUM(jl.credit - jl.debit), 0)::text AS v
        FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
        WHERE a.tenant_id = ${tenantId} AND je.date >= ${start6} AND je.date <= ${today}
          AND a.report_group IN ('SALES_REVENUE', 'SALES_DEDUCTION', 'COST_OF_SALES', 'SELLING_EXPENSE', 'ADMIN_EXPENSE')
        GROUP BY 1, 2`);
  }

  /** Dipakai oleh DashboardInsightsService.build */
  queryJournalLineForBuild(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ v: string }>(sql`
        SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::text AS v FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
        WHERE a.tenant_id = ${tenantId} AND je.date >= ${from} AND je.date < ${to} AND a.report_group IN ('SELLING_EXPENSE', 'ADMIN_EXPENSE')`);
  }

  /** Dipakai oleh DashboardInsightsService.build */
  queryJournalLineForBuild2(db: DbOrTx, tenantId: string) {
    return db.execute<{ v: string }>(sql`
      SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::text AS v FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE a.tenant_id = ${tenantId} AND a.is_cash_account`);
  }

  /** Dipakai oleh DashboardInsightsService.build */
  queryJournalLineForBuild3(db: DbOrTx, tenantId: string, prevStart: string, prevEnd: string) {
    return db.execute<{ v: string }>(sql`
      SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::text AS v FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
      WHERE a.tenant_id = ${tenantId} AND je.date >= ${prevStart} AND je.date <= ${prevEnd} AND a.report_group IN ('SALES_REVENUE', 'SALES_DEDUCTION')`);
  }

  /** Dipakai oleh DashboardInsightsService.build */
  queryJournalLineForBuild4(db: DbOrTx, tenantId: string, curMonth: string) {
    return db.execute<{ name: string; m: string; v: string }>(sql`
          SELECT a.name, to_char(je.date, 'YYYY-MM') AS m, SUM(jl.debit - jl.credit)::text AS v FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
          WHERE a.tenant_id = ${tenantId} AND je.date >= ${addMonths(curMonth, -4)} AND je.date < ${curMonth} AND a.report_group IN ('SELLING_EXPENSE', 'ADMIN_EXPENSE')
          GROUP BY a.name, 2`);
  }

  /** Dipakai oleh DashboardInsightsService.build */
  queryInvoice(db: DbOrTx, today: string, tenantId: string) {
    return db.execute<{ ar: string; overdue: string; n: string }>(sql`
        SELECT COALESCE(SUM(total - paid_amount - returned_amount), 0)::text AS ar,
               COALESCE(SUM(total - paid_amount - returned_amount) FILTER (WHERE due_date < ${today}), 0)::text AS overdue,
               COUNT(*) FILTER (WHERE due_date < ${today})::text AS n
        FROM invoices WHERE tenant_id = ${tenantId} AND status <> 'PAID'`);
  }

  /** Dipakai oleh DashboardInsightsService.build */
  queryInvoiceForBuild(db: DbOrTx, tenantId: string, today: string) {
    return db.execute<{ name: string; amt: string }>(sql`
        SELECT c.name, SUM(i.total - i.paid_amount - i.returned_amount)::text AS amt FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.tenant_id = ${tenantId} AND i.status <> 'PAID' AND i.due_date < ${today} GROUP BY c.id, c.name ORDER BY SUM(i.total - i.paid_amount - i.returned_amount) DESC LIMIT 3`);
  }

  /** Dipakai oleh DashboardInsightsService.build */
  queryInvoiceForBuild2(db: DbOrTx, tenantId: string, d90: string, today: string) {
    return db.execute<{ v: string }>(
      sql`SELECT COALESCE(SUM(subtotal), 0)::text AS v FROM invoices WHERE tenant_id = ${tenantId} AND NOT is_opening AND date >= ${d90} AND date <= ${today}`,
    );
  }

  /** Dipakai oleh DashboardInsightsService.build */
  queryPurchaseInvoice(db: DbOrTx, today: string, tenantId: string) {
    return db.execute<{ overdue: string; due14: string }>(sql`
        SELECT COALESCE(SUM(total - paid_amount - returned_amount) FILTER (WHERE due_date < ${today}), 0)::text AS overdue,
               COALESCE(SUM(total - paid_amount - returned_amount) FILTER (WHERE due_date <= ${addDays(today, 14)}), 0)::text AS due14
        FROM purchase_invoices WHERE tenant_id = ${tenantId} AND status <> 'PAID'`);
  }

  /** Dipakai oleh DashboardInsightsService.build */
  queryInvoiceForBuild3(db: DbOrTx, tenantId: string, d90: string, today: string) {
    return db.execute<{ name: string; amt: string }>(sql`
        SELECT c.name, SUM(i.subtotal)::text AS amt FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.tenant_id = ${tenantId} AND NOT i.is_opening AND i.date >= ${d90} AND i.date <= ${today} GROUP BY c.id, c.name ORDER BY SUM(i.subtotal) DESC`);
  }

  /** Dipakai oleh DashboardInsightsService.build */
  queryInvoiceForBuild4(db: DbOrTx, tenantId: string, d180: string, today: string, d60: string) {
    return db.execute<{ name: string; past: string }>(sql`
        SELECT c.name, SUM(i.subtotal)::text AS past FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.tenant_id = ${tenantId} AND NOT i.is_opening AND i.date >= ${d180} AND i.date <= ${today}
        GROUP BY c.id, c.name
        HAVING COALESCE(SUM(i.subtotal) FILTER (WHERE i.date >= ${d60}), 0) = 0 AND COALESCE(SUM(i.subtotal) FILTER (WHERE i.date < ${d60}), 0) > 0
        ORDER BY SUM(i.subtotal) DESC LIMIT 5`);
  }

  /** Dipakai oleh DashboardInsightsService.build */
  queryL(db: DbOrTx, tenantId: string, d90: string, today: string) {
    return db.execute<{ name: string; src: string; rev: string; gp: string }>(sql`
        WITH l AS (
          SELECT il.product_id, 'INV' AS src, il.line_total AS rev, il.line_total - il.qty * il.uom_factor * il.unit_cost AS gp
          FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id WHERE i.tenant_id = ${tenantId} AND NOT i.is_opening AND i.date >= ${d90} AND i.date <= ${today}
          UNION ALL
          SELECT pl.product_id, 'POS', pl.line_total, pl.line_total - pl.qty * pl.uom_factor * pl.unit_cost
          FROM pos_order_lines pl JOIN pos_orders po ON po.id = pl.order_id WHERE po.tenant_id = ${tenantId} AND po.date >= ${d90} AND po.date <= ${today})
        SELECT p.name, l.src, SUM(l.rev)::text AS rev, SUM(l.gp)::text AS gp FROM l JOIN products p ON p.id = l.product_id GROUP BY p.id, p.name, l.src`);
  }

  /** Dipakai oleh DashboardInsightsService.build */
  queryStockBalance(db: DbOrTx, tenantId: string) {
    return db.execute<{ v: string }>(
      sql`SELECT COALESCE(SUM(qty * avg_cost), 0)::text AS v FROM stock_balances WHERE tenant_id = ${tenantId} AND qty > 0`,
    );
  }

  /** Dipakai oleh DashboardInsightsService.build */
  queryStockBalanceForBuild(db: DbOrTx, tenantId: string, dStart: string) {
    return db.execute<{ name: string; v: string }>(sql`
          SELECT p.name, SUM(b.qty * b.avg_cost)::text AS v FROM stock_balances b JOIN products p ON p.id = b.product_id
          WHERE b.tenant_id = ${tenantId} AND b.qty > 0 AND p.is_active
            AND NOT EXISTS (SELECT 1 FROM stock_moves m WHERE m.tenant_id = ${tenantId} AND m.product_id = b.product_id AND m.type IN ('SALE', 'PRODUCTION_ISSUE') AND m.date >= ${dStart})
            AND EXISTS (SELECT 1 FROM stock_moves m2 WHERE m2.tenant_id = ${tenantId} AND m2.product_id = b.product_id AND m2.date < ${dStart})
          GROUP BY p.id, p.name ORDER BY SUM(b.qty * b.avg_cost) DESC`);
  }

  /** Dipakai oleh DashboardInsightsService.build */
  queryStockLot(db: DbOrTx, today: string, tenantId: string) {
    return db.execute<{ name: string; expired: boolean; v: string }>(sql`
        SELECT p.name, (l.expiry_date < ${today}) AS expired, SUM(l.qty_remaining * COALESCE(b.avg_cost, 0))::text AS v
        FROM stock_lots l JOIN products p ON p.id = l.product_id LEFT JOIN stock_balances b ON b.product_id = l.product_id AND b.warehouse_id = l.warehouse_id
        WHERE l.tenant_id = ${tenantId} AND l.qty_remaining > 0 AND l.expiry_date IS NOT NULL AND l.expiry_date <= ${addDays(today, 30)}
        GROUP BY p.id, p.name, 2 ORDER BY SUM(l.qty_remaining * COALESCE(b.avg_cost, 0)) DESC`);
  }

  /** Dipakai oleh DashboardInsightsService.build */
  queryStockMinimum(db: DbOrTx, tenantId: string) {
    return db.execute<{ name: string }>(sql`
        SELECT p.name FROM stock_minimums m JOIN products p ON p.id = m.product_id AND p.is_active JOIN warehouses w ON w.id = m.warehouse_id AND w.is_active
        LEFT JOIN stock_balances b ON b.product_id = m.product_id AND b.warehouse_id = m.warehouse_id
        WHERE m.tenant_id = ${tenantId} AND COALESCE(b.qty, 0) < m.min_qty ORDER BY (m.min_qty - COALESCE(b.qty, 0)) DESC`);
  }
}
