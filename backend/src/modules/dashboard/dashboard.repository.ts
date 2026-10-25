import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, count, and, eq, ne, lte, gte, lt, inArray } from 'drizzle-orm';
import { purchaseInvoices, invoices, stockBalances, salesOrders, journalLines, accounts } from '../../db/schema';
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

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh DashboardService.summary */
  countInvoicesByIsOpeningAndDate(
    db: DbOrTx,
    tenantId: NonNullable<(typeof invoices.$inferSelect)['tenantId']>,
    today: string,
    invBr: SQL<unknown> | undefined,
  ) {
    return db
      .select({ n: count() })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.isOpening, false),
          gte(invoices.date, monthStart(today)),
          lte(invoices.date, today),
          invBr,
        ),
      );
  }

  /** Dipakai oleh DashboardService.summary */
  listInvoicesByStatus(
    db: DbOrTx,
    outstanding: SQL<string>,
    tenantId: NonNullable<(typeof invoices.$inferSelect)['tenantId']>,
    invBr: SQL<unknown> | undefined,
  ) {
    return db
      .select({ v: outstanding })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), ne(invoices.status, 'PAID'), invBr));
  }

  /** Dipakai oleh DashboardService.summary */
  countInvoicesByStatusAndDueDate(
    db: DbOrTx,
    outstanding: SQL<string>,
    tenantId: NonNullable<(typeof invoices.$inferSelect)['tenantId']>,
    today: NonNullable<(typeof invoices.$inferSelect)['dueDate']>,
    invBr: SQL<unknown> | undefined,
  ) {
    return db
      .select({ v: outstanding, n: count() })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), ne(invoices.status, 'PAID'), lt(invoices.dueDate, today), invBr));
  }

  /** Dipakai oleh DashboardService.summary */
  sumStockBalances(
    db: DbOrTx,
    tenantId: NonNullable<(typeof stockBalances.$inferSelect)['tenantId']>,
    stBr: SQL<unknown> | undefined,
  ) {
    return db
      .select({ v: sql<string>`COALESCE(SUM(${stockBalances.qty} * ${stockBalances.avgCost}), 0)` })
      .from(stockBalances)
      .where(and(eq(stockBalances.tenantId, tenantId), stBr));
  }

  /** Dipakai oleh DashboardService.summary */
  countSalesOrdersByStatus(
    db: DbOrTx,
    tenantId: NonNullable<(typeof salesOrders.$inferSelect)['tenantId']>,
    soBr: SQL<unknown> | undefined,
  ) {
    return db
      .select({ n: count() })
      .from(salesOrders)
      .where(
        and(eq(salesOrders.tenantId, tenantId), inArray(salesOrders.status, ['DRAFT', 'CONFIRMED', 'DELIVERED']), soBr),
      );
  }

  /** Dipakai oleh DashboardService.summary */
  sumPurchaseInvoicesByStatus(
    db: DbOrTx,
    tenantId: NonNullable<(typeof purchaseInvoices.$inferSelect)['tenantId']>,
    piBr: SQL<unknown> | undefined,
  ) {
    return db
      .select({
        v: sql<string>`COALESCE(SUM(${purchaseInvoices.total} - ${purchaseInvoices.paidAmount} - ${purchaseInvoices.returnedAmount}), 0)`,
      })
      .from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.tenantId, tenantId), ne(purchaseInvoices.status, 'PAID'), piBr));
  }

  /** Dipakai oleh DashboardService.summary */
  sumJournalLinesWithAccounts(
    db: DbOrTx,
    tenantId: NonNullable<(typeof accounts.$inferSelect)['tenantId']>,
    cashBr: SQL<unknown> | undefined,
  ) {
    return db
      .select({ v: sql<string>`COALESCE(SUM(${journalLines.debit} - ${journalLines.credit}), 0)` })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.isCashAccount, true), cashBr));
  }
}
