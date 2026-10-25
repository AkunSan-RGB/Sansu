import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, count, and, eq, ne, lte } from 'drizzle-orm';
import { purchaseInvoices } from '../../db/schema';
import { addDays, monthStart } from '../../common/utils/dates';
import type { SQL } from 'drizzle-orm';

/** Akses data untuk Dashboard: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class DashboardRepository {
  /** Dipakai oleh DashboardService.attention */
  countPurchaseInvoicesByStatusAndDueDate(
    db: DbOrTx,
    tenantId: NonNullable<(typeof purchaseInvoices.$inferSelect)['tenantId']>,
    today: string,
  ) {
    return db
      .select({
        v: sql<string>`COALESCE(SUM(${purchaseInvoices.total} - ${purchaseInvoices.paidAmount} - ${purchaseInvoices.returnedAmount}), 0)`,
        n: count(),
      })
      .from(purchaseInvoices)
      .where(
        and(
          eq(purchaseInvoices.tenantId, tenantId),
          ne(purchaseInvoices.status, 'PAID'),
          lte(purchaseInvoices.dueDate, addDays(today, 7)),
        ),
      );
  }

  /** Dipakai oleh DashboardService.attention */
  queryStockMinimum(db: DbOrTx, tenantId: string) {
    return db.execute<{ n: number; wh: number }>(sql`
      SELECT COUNT(*)::int AS n, COUNT(DISTINCT m.warehouse_id)::int AS wh
      FROM stock_minimums m
      JOIN products p ON p.id = m.product_id AND p.is_active
      JOIN warehouses w ON w.id = m.warehouse_id AND w.is_active
      LEFT JOIN stock_balances b ON b.product_id = m.product_id AND b.warehouse_id = m.warehouse_id
      WHERE m.tenant_id = ${tenantId} AND COALESCE(b.qty, 0) < m.min_qty`);
  }

  /** Dipakai oleh DashboardService.summary */
  queryJournalLine(db: DbOrTx, tenantId: string, today: string, ledBr: SQL<unknown>) {
    return db.execute<{ grp: string; v: string }>(sql`
      SELECT a.report_group AS grp, COALESCE(SUM(jl.credit - jl.debit), 0) AS v
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_id
      JOIN accounts a ON a.id = jl.account_id
      WHERE a.tenant_id = ${tenantId} AND je.date >= ${monthStart(today)} AND je.date <= ${today}
        AND a.report_group IN ('SALES_REVENUE', 'SALES_DEDUCTION', 'COST_OF_SALES') ${ledBr}
      GROUP BY a.report_group`);
  }

  /** Dipakai oleh DashboardService.summary */
  queryPosOrder(db: DbOrTx, tenantId: string, today: string, posBr: SQL<unknown>) {
    return db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM pos_orders po WHERE po.tenant_id = ${tenantId} AND po.date >= ${monthStart(today)} AND po.date <= ${today} ${posBr}`,
    );
  }
}
