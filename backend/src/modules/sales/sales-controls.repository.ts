import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';
import { addDays } from '../../common/utils/dates';

/** Akses data untuk SalesControls: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class SalesControlsRepository {
  /** Dipakai oleh SalesControlsService.controls */
  queryDeliveryOrder(db: DbOrTx, tenantId: string, today: string, deliveryNotBilledDays: number) {
    return db.execute<{ number: string }>(sql`
      SELECT d.number FROM delivery_orders d
      WHERE d.tenant_id = ${tenantId} AND d.status = 'DELIVERED' AND d.invoice_id IS NULL AND d.date <= ${addDays(today, -deliveryNotBilledDays)}
      ORDER BY d.date`);
  }

  /** Dipakai oleh SalesControlsService.controls */
  querySalesOrder(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{ number: string; reason: string | null }>(sql`
      SELECT o.number, o.cancel_reason AS reason FROM sales_orders o
      WHERE o.tenant_id = ${tenantId} AND o.status = 'CANCELLED' AND o.cancelled_by_id IS NOT NULL AND o.date >= ${since}
        AND EXISTS (SELECT 1 FROM audit_logs l WHERE l.entity = 'SalesOrder' AND l.entity_id = o.id::text AND l.action = 'CONFIRM')`);
  }

  /** Dipakai oleh SalesControlsService.controls */
  queryDeliveryOrderForControls(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{ number: string; reason: string | null }>(sql`
      SELECT number, cancel_reason AS reason FROM delivery_orders WHERE tenant_id = ${tenantId} AND status = 'CANCELLED' AND date >= ${since}`);
  }

  /** Dipakai oleh SalesControlsService.controls */
  querySalesOrderLine(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{ number: string; pct: string }>(sql`
      SELECT DISTINCT o.number, MAX(l.discount_pct)::text AS pct FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id
      WHERE o.tenant_id = ${tenantId} AND o.date >= ${since} AND o.status <> 'CANCELLED' AND l.discount_pct >= 20 GROUP BY o.number ORDER BY o.number DESC`);
  }

  /** Dipakai oleh SalesControlsService.controls */
  querySalesOrderForControls(db: DbOrTx, tenantId: string, since: string, salesOrder: number) {
    return db.execute<{ number: string; name: string }>(sql`
        SELECT o.number, c.name FROM sales_orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.tenant_id = ${tenantId} AND o.date >= ${since} AND o.status IN ('CONFIRMED', 'DELIVERED', 'INVOICED') AND o.total >= ${salesOrder}
          AND NOT EXISTS (SELECT 1 FROM approval_requests a WHERE a.tenant_id = ${tenantId} AND a.kind = 'SALES_ORDER' AND a.ref_id = o.id::text AND a.status = 'APPROVED')
        ORDER BY o.date DESC`);
  }

  /** Dipakai oleh SalesControlsService.controls */
  querySalesOrderForControls2(db: DbOrTx, tenantId: string, today: string) {
    return db.execute<{ number: string; name: string; days: number }>(sql`
      SELECT o.number, c.name, (CURRENT_DATE - MAX(d.date))::int AS days
      FROM sales_orders o JOIN customers c ON c.id = o.customer_id JOIN delivery_orders d ON d.sales_order_id = o.id AND d.status = 'DELIVERED'
      WHERE o.tenant_id = ${tenantId} AND o.status = 'CONFIRMED'
      GROUP BY o.number, c.name HAVING MAX(d.date) <= ${addDays(today, -14)} ORDER BY MAX(d.date)`);
  }

  /** Dipakai oleh SalesControlsService.controls */
  queryPayment(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{ number: string | null; name: string; inv: string; v: string; who: string | null }>(sql`
      SELECT p.number, c.name, i.number AS inv, p.amount::text AS v, u.name AS who
      FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN customers c ON c.id = i.customer_id
      LEFT JOIN audit_logs a ON a.tenant_id = p.tenant_id AND a.entity = 'ReceivableWriteOff' AND a.entity_id = p.id::text
      LEFT JOIN users u ON u.id = a.user_id
      WHERE p.tenant_id = ${tenantId} AND p.method = 'WRITE_OFF' AND p.date >= ${since} ORDER BY p.date DESC`);
  }

  /** Dipakai oleh SalesControlsService.controls */
  queryPaymentForControls(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{ number: string | null; name: string; days: number }>(sql`
      SELECT p.number, c.name, (p.created_at::date - p.date)::int AS days
      FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN customers c ON c.id = i.customer_id
      WHERE p.tenant_id = ${tenantId} AND p.date >= ${since} AND p.method <> 'WRITE_OFF' AND (p.created_at::date - p.date) >= 3
      ORDER BY days DESC`);
  }

  /** Dipakai oleh SalesControlsService.controls */
  querySalesReturn(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{ who: string; period: string; v: string }>(sql`
      SELECT u.name AS who, sc.period, SUM(r.subtotal)::text AS v
      FROM sales_returns r JOIN invoices i ON i.id = r.invoice_id JOIN sales_orders o ON o.id = i.sales_order_id
      JOIN sales_commissions sc ON sc.tenant_id = r.tenant_id AND sc.user_id = o.salesperson_id AND sc.period = to_char(i.date, 'YYYY-MM') AND sc.status IN ('ACCRUED', 'PAID')
      JOIN users u ON u.id = o.salesperson_id
      WHERE r.tenant_id = ${tenantId} AND r.date >= ${since} AND to_char(r.date, 'YYYY-MM') > sc.period
      GROUP BY u.name, sc.period`);
  }

  /** Dipakai oleh SalesControlsService.controls */
  queryAuditLog(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{ code: string; name: string }>(sql`
      SELECT DISTINCT c.code, c.name FROM audit_logs l JOIN customers c ON c.id::text = l.entity_id
      WHERE l.tenant_id = ${tenantId} AND l.entity = 'Customer' AND l.action = 'UPDATE_TERMS' AND l.created_at >= ${since}::date`);
  }

  /** Dipakai oleh SalesControlsService.controls */
  queryPaymentForControls2(db: DbOrTx, tenantId: string, since: string, today: string) {
    return db.execute<{ number: string; name: string }>(sql`
      SELECT p.number, c.name
      FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN customers c ON c.id = i.customer_id
      JOIN journal_lines jl ON jl.journal_id = p.journal_id AND jl.account_id = p.cash_account_id AND jl.debit > 0
      WHERE p.tenant_id = ${tenantId} AND p.method <> 'CASH' AND p.date >= ${since} AND p.date <= ${addDays(today, -3)}
        AND EXISTS (SELECT 1 FROM bank_statements s WHERE s.tenant_id = ${tenantId} AND s.cash_account_id = p.cash_account_id AND p.date BETWEEN s.period_from AND s.period_to)
        AND NOT EXISTS (SELECT 1 FROM bank_statement_lines b WHERE b.journal_line_id = jl.id)
        AND NOT EXISTS (SELECT 1 FROM bank_line_extra_matches x WHERE x.journal_line_id = jl.id)
      ORDER BY p.date DESC`);
  }

  /** Dipakai oleh SalesControlsService.controls */
  queryUser(db: DbOrTx, tenantId: string) {
    return db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM users WHERE tenant_id = ${tenantId} AND role = 'FINANCE' AND is_active`,
    );
  }

  /** Dipakai oleh SalesControlsService.controls */
  queryPaymentForControls3(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{ who: string; n: number }>(sql`
      SELECT u.name AS who, COUNT(DISTINCT p.invoice_id)::int AS n
      FROM payments p
      JOIN audit_logs ap ON ap.tenant_id = p.tenant_id AND ap.entity = 'Payment' AND ap.entity_id = p.id::text AND ap.action = 'CREATE'
      JOIN audit_logs ai ON ai.tenant_id = p.tenant_id AND ai.entity = 'Invoice' AND ai.entity_id = p.invoice_id::text AND ai.action = 'CREATE' AND ai.user_id = ap.user_id
      JOIN users u ON u.id = ap.user_id
      WHERE p.tenant_id = ${tenantId} AND p.method <> 'WRITE_OFF' AND p.date >= ${since} GROUP BY u.name ORDER BY n DESC`);
  }

  /** Dipakai oleh SalesControlsService.controls */
  querySalesReturnForControls(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<{ who: string; n: number }>(sql`
      SELECT u.name AS who, COUNT(DISTINCT r.invoice_id)::int AS n
      FROM sales_returns r
      JOIN audit_logs ar ON ar.tenant_id = r.tenant_id AND ar.entity = 'SalesReturn' AND ar.entity_id = r.id::text AND ar.action = 'CREATE'
      JOIN audit_logs ai ON ai.tenant_id = r.tenant_id AND ai.entity = 'Invoice' AND ai.entity_id = r.invoice_id::text AND ai.action = 'CREATE' AND ai.user_id = ar.user_id
      JOIN users u ON u.id = ar.user_id
      WHERE r.tenant_id = ${tenantId} AND r.date >= ${since} GROUP BY u.name ORDER BY n DESC`);
  }
}
