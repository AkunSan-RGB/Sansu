import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { users, salesTargets } from '../../../db/schema';
import { and, eq, sql, inArray } from 'drizzle-orm';

/** Akses data untuk SalesTargets: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class SalesTargetsRepository {
  /** Dipakai oleh SalesTargetsService.performance */
  listUsersByRoleAndIsActive(db: DbOrTx, tenantId: string) {
    return db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, 'SALES'), eq(users.isActive, true)));
  }

  /** Dipakai oleh SalesTargetsService.performance */
  listSalesTargetsByPeriod(db: DbOrTx, tenantId: string, period: string) {
    return db
      .select()
      .from(salesTargets)
      .where(and(eq(salesTargets.tenantId, tenantId), eq(salesTargets.period, period)));
  }

  /** Dipakai oleh SalesTargetsService.performance */
  queryInvoice(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ sp: string; v: string; n: string; proxy: string }>(sql`
      SELECT o.salesperson_id AS sp, COALESCE(SUM(i.subtotal), 0) AS v, COUNT(*)::text AS n,
             COUNT(*) FILTER (WHERE o.created_by_id IS DISTINCT FROM o.salesperson_id)::text AS proxy
      FROM invoices i JOIN sales_orders o ON o.id = i.sales_order_id
      WHERE i.tenant_id = ${tenantId} AND o.salesperson_id IS NOT NULL AND i.date >= ${from} AND i.date < ${to}
      GROUP BY o.salesperson_id`);
  }

  /** Dipakai oleh SalesTargetsService.performance */
  querySalesReturn(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ sp: string; v: string }>(sql`
      SELECT o.salesperson_id AS sp, COALESCE(SUM(r.subtotal), 0) AS v
      FROM sales_returns r JOIN invoices i ON i.id = r.invoice_id JOIN sales_orders o ON o.id = i.sales_order_id
      WHERE r.tenant_id = ${tenantId} AND o.salesperson_id IS NOT NULL AND r.date >= ${from} AND r.date < ${to}
      GROUP BY o.salesperson_id`);
  }

  /** Dipakai oleh SalesTargetsService.performance */
  listUsersById(db: DbOrTx, tenantId: string, extraIds: string[]) {
    return db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), inArray(users.id, extraIds)));
  }

  /** Dipakai oleh SalesTargetsService.save */
  querySalesCommission(db: DbOrTx, tenantId: string, period: string) {
    return db.execute(
      sql`SELECT 1 FROM sales_commissions WHERE tenant_id = ${tenantId} AND period = ${period} AND status <> 'VOID' LIMIT 1`,
    );
  }

  /** Dipakai oleh SalesTargetsService.save */
  listUsersByRoleAndId(db: DbOrTx, tenantId: string, ids: string[]) {
    return db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, 'SALES'), inArray(users.id, ids)));
  }

  /** Dipakai oleh SalesTargetsService.save */
  deleteSalesTargetsByPeriod(db: DbOrTx, tenantId: string, period: string) {
    return db.delete(salesTargets).where(and(eq(salesTargets.tenantId, tenantId), eq(salesTargets.period, period)));
  }
}
