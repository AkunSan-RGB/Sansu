import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { sql, and, eq, desc, inArray } from 'drizzle-orm';
import {
  users,
  warehouses,
  canvassCollections,
  customers,
  invoices,
  salesRoutes,
  salesRouteStops,
  salesVisits,
} from '../../../db/schema';
import { AuthUser } from '../../../common/auth/auth-user';

/** Akses data untuk Canvass: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class CanvassRepository {
  /** Dipakai oleh CanvassService.vans */
  queryWarehouse(db: DbOrTx, tenantId: string) {
    return db.execute<{
      id: string;
      code: string;
      name: string;
      user_id: string;
      user_name: string;
      is_active: boolean;
      qty: string;
      value: string;
      skus: string;
    }>(sql`
      SELECT w.id, w.code, w.name, w.van_user_id AS user_id, u.name AS user_name, w.is_active,
             COALESCE(SUM(b.qty), 0)::text AS qty, COALESCE(SUM(b.qty * b.avg_cost), 0)::text AS value, COUNT(b.product_id) FILTER (WHERE b.qty > 0)::text AS skus
      FROM warehouses w LEFT JOIN users u ON u.id = w.van_user_id LEFT JOIN stock_balances b ON b.warehouse_id = w.id AND b.qty > 0
      WHERE w.tenant_id = ${tenantId} AND w.kind = 'VAN' GROUP BY w.id, u.name ORDER BY w.code`);
  }

  /** Dipakai oleh CanvassService.createVan */
  findUsersByIdAndRoleAndIsActive(db: DbOrTx, userId: string, tenantId: string) {
    return db
      .select()
      .from(users)
      .where(
        and(eq(users.id, userId), eq(users.tenantId, tenantId), eq(users.role, 'SALES'), eq(users.isActive, true)),
      );
  }

  /** Dipakai oleh CanvassService.createVan */
  findWarehousesByKindAndVanUserId(db: DbOrTx, tenantId: string, id: string) {
    return db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.kind, 'VAN'), eq(warehouses.vanUserId, id)));
  }

  /** Dipakai oleh CanvassService.createVan */
  queryWarehouseForCreateVan(db: DbOrTx, tenantId: string) {
    return db.execute<{ n: string }>(
      sql`SELECT COUNT(*)::text AS n FROM warehouses WHERE tenant_id = ${tenantId} AND kind = 'VAN'`,
    );
  }

  /** Dipakai oleh CanvassService.van */
  findWarehousesByIdAndKind(db: DbOrTx, id: string, tenantId: string) {
    return db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, id), eq(warehouses.tenantId, tenantId), eq(warehouses.kind, 'VAN')));
  }

  /** Dipakai oleh CanvassService.sale */
  findWarehousesByKindAndVanUserIdAndIsActive(db: DbOrTx, tenantId: string, sub: string) {
    return db
      .select()
      .from(warehouses)
      .where(
        and(
          eq(warehouses.tenantId, tenantId),
          eq(warehouses.kind, 'VAN'),
          eq(warehouses.vanUserId, sub),
          eq(warehouses.isActive, true),
        ),
      );
  }

  /** Dipakai oleh CanvassService.collect */
  queryInvoice(db: DbOrTx, invoiceId: string, tenantId: string) {
    return db.execute(sql`SELECT id FROM invoices WHERE id = ${invoiceId} AND tenant_id = ${tenantId} FOR UPDATE`);
  }

  /** Dipakai oleh CanvassService.collect */
  querySalesOrder(db: DbOrTx, salesOrderId: string | null, collectorId: string) {
    return db.execute(sql`SELECT 1 FROM sales_orders WHERE id = ${salesOrderId} AND salesperson_id = ${collectorId}`);
  }

  /** Dipakai oleh CanvassService.collect */
  queryCanvassCollection(db: DbOrTx, id: string) {
    return db.execute<{ s: string }>(
      sql`SELECT COALESCE(SUM(amount), 0)::text AS s FROM canvass_collections WHERE invoice_id = ${id} AND status = 'PENDING'`,
    );
  }

  /** Dipakai oleh CanvassService.collections */
  listCanvassCollectionsWithUsersAndCustomersByStatusAndUserIdAndDate(
    db: DbOrTx,
    u: AuthUser,
    status: string | undefined,
  ) {
    return db
      .select({ c: canvassCollections, sales: users.name, cust: customers.name, inv: invoices.number })
      .from(canvassCollections)
      .innerJoin(users, eq(users.id, canvassCollections.userId))
      .innerJoin(customers, eq(customers.id, canvassCollections.customerId))
      .innerJoin(invoices, eq(invoices.id, canvassCollections.invoiceId))
      .where(
        and(
          eq(canvassCollections.tenantId, u.tenantId),
          status ? eq(canvassCollections.status, status as 'PENDING') : undefined,
          u.role === 'SALES' ? eq(canvassCollections.userId, u.sub) : undefined,
        ),
      )
      .orderBy(desc(canvassCollections.date), desc(canvassCollections.number))
      .limit(300);
  }

  /** Dipakai oleh CanvassService.verify */
  findInvoicesById(db: DbOrTx, invoiceId: string) {
    return db.select().from(invoices).where(eq(invoices.id, invoiceId));
  }

  /** Dipakai oleh CanvassService.verify */
  findCustomersById(db: DbOrTx, customerId: string) {
    return db.select({ name: customers.name }).from(customers).where(eq(customers.id, customerId));
  }

  /** Dipakai oleh CanvassService.routes */
  listSalesRoutesWithUsersBySalespersonIdAndName(db: DbOrTx, u: AuthUser) {
    return db
      .select({ r: salesRoutes, sales: users.name })
      .from(salesRoutes)
      .innerJoin(users, eq(users.id, salesRoutes.salespersonId))
      .where(
        and(
          eq(salesRoutes.tenantId, u.tenantId),
          u.role === 'SALES' ? eq(salesRoutes.salespersonId, u.sub) : undefined,
        ),
      )
      .orderBy(salesRoutes.name);
  }

  /** Dipakai oleh CanvassService.checkRoute */
  findUsersByIdAndRole(db: DbOrTx, salespersonId: string, tenantId: string) {
    return db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, salespersonId), eq(users.tenantId, tenantId), eq(users.role, 'SALES')));
  }

  /** Dipakai oleh CanvassService.checkRoute */
  listCustomersById(db: DbOrTx, tenantId: string, ids: string[]) {
    return db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), inArray(customers.id, ids)));
  }

  /** Dipakai oleh CanvassService.saveRoute */
  deleteSalesRouteStopsByRouteId(db: DbOrTx, id: string) {
    return db.delete(salesRouteStops).where(eq(salesRouteStops.routeId, id));
  }

  /** Dipakai oleh CanvassService.saveRoute */
  insertSalesRouteStops(db: DbOrTx, customerIds: string[], tenantId: string, routeId: string | undefined) {
    return db
      .insert(salesRouteStops)
      .values(customerIds.map((customerId, i) => ({ tenantId: tenantId, routeId: routeId!, customerId, seq: i + 1 })));
  }

  /** Dipakai oleh CanvassService.summary */
  listUsersByRoleAndIsActiveAndId(db: DbOrTx, tenantId: string, only: string | null) {
    return db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          eq(users.role, 'SALES'),
          eq(users.isActive, true),
          only ? eq(users.id, only) : undefined,
        ),
      );
  }

  /** Dipakai oleh CanvassService.visits */
  listSalesVisitsWithUsersAndCustomersByDateAndUserIdAndCheckedInAt(db: DbOrTx, u: AuthUser, date: string) {
    return db
      .select({ v: salesVisits, sales: users.name, code: customers.code, name: customers.name })
      .from(salesVisits)
      .innerJoin(users, eq(users.id, salesVisits.userId))
      .innerJoin(customers, eq(customers.id, salesVisits.customerId))
      .where(
        and(
          eq(salesVisits.tenantId, u.tenantId),
          eq(salesVisits.date, date),
          u.role === 'SALES' ? eq(salesVisits.userId, u.sub) : undefined,
        ),
      )
      .orderBy(desc(salesVisits.checkedInAt));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh CanvassService.routes */
  listSalesRouteStopsWithCustomersByRouteIdAndSeq(
    db: DbOrTx,
    rowsValues: NonNullable<(typeof salesRouteStops.$inferSelect)['routeId']>[],
  ) {
    return db
      .select({ s: salesRouteStops, code: customers.code, name: customers.name })
      .from(salesRouteStops)
      .innerJoin(customers, eq(customers.id, salesRouteStops.customerId))
      .where(inArray(salesRouteStops.routeId, rowsValues))
      .orderBy(salesRouteStops.seq);
  }
}
