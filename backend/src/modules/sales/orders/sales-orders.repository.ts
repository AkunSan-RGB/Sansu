import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { sql, eq, and, inArray } from 'drizzle-orm';
import { tenants, salesOrders, users, promos, stockBalances, salesOrderLines, customers } from '../../../db/schema';

/** Akses data untuk SalesOrders: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class SalesOrdersRepository {
  /** Dipakai oleh SalesOrdersService.get */
  queryDeliveryOrderLine(db: DbOrTx, id: string) {
    return db.execute<{ id: string; q: string }>(sql`
      SELECT dl.order_line_id::text AS id, SUM(dl.qty)::text AS q FROM delivery_order_lines dl JOIN delivery_orders d ON d.id = dl.delivery_id
      WHERE d.sales_order_id = ${id} AND d.status = 'DELIVERED' GROUP BY dl.order_line_id`);
  }

  /** Dipakai oleh SalesOrdersService.create */
  findTenantsById(db: DbOrTx, tenantId: string) {
    return db.select().from(tenants).where(eq(tenants.id, tenantId));
  }

  /** Dipakai oleh SalesOrdersService.create */
  findSalesOrdersByCustomerIdAndCustomerPoNoAndStatus(db: DbOrTx, tenantId: string, id: string, poNo: string) {
    return db
      .select({ number: salesOrders.number })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.tenantId, tenantId),
          eq(salesOrders.customerId, id),
          eq(salesOrders.customerPoNo, poNo),
          sql`${salesOrders.status} <> 'CANCELLED'`,
        ),
      );
  }

  /** Dipakai oleh SalesOrdersService.create */
  findUsersByIdAndRoleAndIsActive(db: DbOrTx, salespersonId: string, tenantId: string) {
    return db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, salespersonId),
          eq(users.tenantId, tenantId),
          eq(users.role, 'SALES'),
          eq(users.isActive, true),
        ),
      );
  }

  /** Dipakai oleh SalesOrdersService.create */
  listPromosById(db: DbOrTx, tenantId: string, promoIds: string[]) {
    return db
      .select({ id: promos.id, s: promos.fundedSupplierId, p: promos.fundedPct })
      .from(promos)
      .where(and(eq(promos.tenantId, tenantId), inArray(promos.id, promoIds)));
  }

  /** Dipakai oleh SalesOrdersService.confirm */
  listStockBalancesByWarehouseIdAndProductId(
    db: DbOrTx,
    tenantId: string,
    warehouseId: string,
    lines: (typeof salesOrderLines.$inferSelect)[],
  ) {
    return db
      .select({ productId: stockBalances.productId, avg: stockBalances.avgCost })
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.tenantId, tenantId),
          eq(stockBalances.warehouseId, warehouseId),
          inArray(
            stockBalances.productId,
            lines.map((l) => l.productId),
          ),
        ),
      );
  }

  /** Dipakai oleh SalesOrdersService.confirm */
  findCustomersById(db: DbOrTx, customerId: string) {
    return db.select({ name: customers.name }).from(customers).where(eq(customers.id, customerId));
  }

  /** Dipakai oleh SalesOrdersService.cancel */
  queryDeliveryOrder(db: DbOrTx, id: string) {
    return db.execute(sql`SELECT 1 FROM delivery_orders WHERE sales_order_id = ${id} AND status = 'DELIVERED' LIMIT 1`);
  }

  /** Dipakai oleh SalesOrdersService.lockOrder */
  querySalesOrder(db: DbOrTx, id: string, tenantId: string) {
    return db.execute(sql`
      SELECT id FROM sales_orders WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
  }
}
