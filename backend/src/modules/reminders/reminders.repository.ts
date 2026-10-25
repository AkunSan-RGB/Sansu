import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { reminderSnoozes } from '../../db/schema';
import { and, eq, gt, sql } from 'drizzle-orm';
import { addDays } from '../../common/utils/dates';

/** Akses data untuk Reminders: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class RemindersRepository {
  /** Dipakai oleh RemindersService.forUser */
  listReminderSnoozesByUserIdAndUntil(db: DbOrTx, sub: string, today: string) {
    return db
      .select({ key: reminderSnoozes.key, until: reminderSnoozes.until })
      .from(reminderSnoozes)
      .where(and(eq(reminderSnoozes.userId, sub), gt(reminderSnoozes.until, today)));
  }

  /** Dipakai oleh RemindersService.snooze */
  insertReminderSnoozes(db: DbOrTx, tenantId: string, sub: string, key: string, until: string) {
    return db
      .insert(reminderSnoozes)
      .values({ tenantId: tenantId, userId: sub, key: key, until: until })
      .onConflictDoUpdate({ target: [reminderSnoozes.userId, reminderSnoozes.key], set: { until: until } });
  }

  /** Dipakai oleh RemindersService.unsnooze */
  deleteReminderSnoozesByUserIdAndKey(db: DbOrTx, sub: string, key: string) {
    return db.delete(reminderSnoozes).where(and(eq(reminderSnoozes.userId, sub), eq(reminderSnoozes.key, key)));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh RemindersService.compute */
  queryInvoice(db: DbOrTx, tenantId: string) {
    return db.execute<{ name: string; out: string; due: string }>(sql`
        SELECT cu.name, (i.total - i.paid_amount - i.returned_amount)::numeric AS out, i.due_date::text AS due
        FROM invoices i JOIN customers cu ON cu.id = i.customer_id
        WHERE i.tenant_id = ${tenantId} AND i.status <> 'PAID' AND (i.total - i.paid_amount - i.returned_amount) > 0.005
        ORDER BY i.due_date`);
  }

  /** Dipakai oleh RemindersService.compute */
  queryPurchaseInvoice(db: DbOrTx, tenantId: string) {
    return db.execute<{ name: string; out: string; due: string }>(sql`
        SELECT s.name, (i.total - i.paid_amount - i.returned_amount)::numeric AS out, i.due_date::text AS due
        FROM purchase_invoices i JOIN suppliers s ON s.id = i.supplier_id
        WHERE i.tenant_id = ${tenantId} AND i.status <> 'PAID' AND (i.total - i.paid_amount - i.returned_amount) > 0.005
        ORDER BY i.due_date`);
  }

  /** Dipakai oleh RemindersService.compute */
  queryGoodsReceipt(db: DbOrTx, tenantId: string, today: string, grniDays: number) {
    return db.execute<{ n: number; v: string; oldest: string | null }>(sql`
        SELECT COUNT(DISTINCT g.id)::int AS n, COALESCE(SUM(l.value - l.billed_value), 0)::text AS v, MIN(g.date)::text AS oldest
        FROM goods_receipts g JOIN goods_receipt_lines l ON l.receipt_id = g.id
        WHERE g.tenant_id = ${tenantId} AND g.status = 'RECEIVED' AND g.auto_invoice_id IS NULL
          AND (l.qty - l.billed_qty) > 0.00005 AND g.date <= ${addDays(today, -grniDays)}`);
  }

  /** Dipakai oleh RemindersService.compute */
  queryPurchaseOrder(db: DbOrTx, tenantId: string, today: string, poDays: number) {
    return db.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM purchase_orders o
        WHERE o.tenant_id = ${tenantId} AND o.status = 'CONFIRMED' AND o.date <= ${addDays(today, -poDays)}
          AND NOT EXISTS (SELECT 1 FROM purchase_order_lines l WHERE l.order_id = o.id AND l.received_qty > 0)`);
  }

  /** Dipakai oleh RemindersService.compute */
  queryStockMinimum(db: DbOrTx, tenantId: string) {
    return db.execute<{ n: number; wh: number }>(sql`
        SELECT COUNT(*)::int AS n, COUNT(DISTINCT m.warehouse_id)::int AS wh
        FROM stock_minimums m
        JOIN products p ON p.id = m.product_id AND p.is_active
        JOIN warehouses w ON w.id = m.warehouse_id AND w.is_active
        LEFT JOIN stock_balances b ON b.product_id = m.product_id AND b.warehouse_id = m.warehouse_id
        WHERE m.tenant_id = ${tenantId} AND COALESCE(b.qty, 0) < m.min_qty`);
  }

  /** Dipakai oleh RemindersService.compute */
  queryDeliveryOrder(db: DbOrTx, tenantId: string, today: string, deliveryDays: number) {
    return db.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM delivery_orders
        WHERE tenant_id = ${tenantId} AND status = 'DELIVERED' AND invoice_id IS NULL AND date <= ${addDays(today, -deliveryDays)}`);
  }

  /** Dipakai oleh RemindersService.compute */
  queryApprovalRequest(db: DbOrTx, tenantId: string) {
    return db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM approval_requests WHERE tenant_id = ${tenantId} AND status = 'PENDING'`,
    );
  }

  /** Dipakai oleh RemindersService.compute */
  queryPurchaseRequest(db: DbOrTx, tenantId: string) {
    return db.execute<{ pending: number; oldest: number; approved: number }>(sql`
        SELECT COUNT(*) FILTER (WHERE status = 'SUBMITTED')::int AS pending,
               COALESCE(MAX(CURRENT_DATE - COALESCE(submitted_at, created_at)::date) FILTER (WHERE status = 'SUBMITTED'), 0)::int AS oldest,
               COUNT(*) FILTER (WHERE status = 'APPROVED')::int AS approved
        FROM purchase_requests WHERE tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh RemindersService.compute */
  queryPayrollRun(db: DbOrTx, tenantId: string, today: string) {
    return db.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM payroll_runs WHERE tenant_id = ${tenantId} AND period = ${today.slice(0, 7)} AND status <> 'DRAFT'`);
  }
}
