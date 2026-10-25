import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { warehouses, consignmentDocs, customers, users } from '../../../db/schema';
import { and, eq, sql, desc } from 'drizzle-orm';

/** Akses data untuk Consignments: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class ConsignmentsRepository {
  /** Dipakai oleh ConsignmentsService.consignWarehouse */
  findWarehousesByKindAndConsigneeCustomerId(db: DbOrTx, tenantId: string, id: string) {
    return db
      .select()
      .from(warehouses)
      .where(
        and(
          eq(warehouses.tenantId, tenantId),
          eq(warehouses.kind, 'CONSIGNMENT'),
          eq(warehouses.consigneeCustomerId, id),
        ),
      );
  }

  /** Dipakai oleh ConsignmentsService.available */
  queryStockBalance(db: DbOrTx, tenantId: string, warehouseId: string) {
    return db.execute<{ product_id: string; qty: string }>(
      sql`SELECT product_id, qty FROM stock_balances WHERE tenant_id = ${tenantId} AND warehouse_id = ${warehouseId} AND qty > 0`,
    );
  }

  /** Dipakai oleh ConsignmentsService.available */
  listConsignmentDocsByWarehouseIdAndKindAndStatus(db: DbOrTx, tenantId: string, warehouseId: string) {
    return db
      .select()
      .from(consignmentDocs)
      .where(
        and(
          eq(consignmentDocs.tenantId, tenantId),
          eq(consignmentDocs.warehouseId, warehouseId),
          eq(consignmentDocs.kind, 'REPORT'),
          eq(consignmentDocs.status, 'REPORTED'),
        ),
      );
  }

  /** Dipakai oleh ConsignmentsService.stockReport */
  queryWarehouse(db: DbOrTx, tenantId: string) {
    return db.execute<{
      wid: string;
      wcode: string;
      cid: string;
      ccode: string;
      cname: string;
      credit: string;
      pid: string;
      sku: string;
      pname: string;
      uom: string;
      qty: string;
      cost: string;
      sell: string;
    }>(sql`
      SELECT w.id AS wid, w.code AS wcode, c.id AS cid, c.code AS ccode, c.name AS cname, c.credit_limit AS credit,
             p.id AS pid, p.sku, p.name AS pname, p.base_uom AS uom, b.qty, (b.qty * b.avg_cost) AS cost, (b.qty * p.sell_price) AS sell
      FROM warehouses w
      JOIN customers c ON c.id = w.consignee_customer_id
      LEFT JOIN stock_balances b ON b.warehouse_id = w.id AND b.qty > 0
      LEFT JOIN products p ON p.id = b.product_id
      WHERE w.tenant_id = ${tenantId} AND w.kind = 'CONSIGNMENT'
      ORDER BY c.name, p.sku`);
  }

  /** Dipakai oleh ConsignmentsService.stockReport */
  queryConsignmentDoc(db: DbOrTx, tenantId: string) {
    return db.execute<{ wid: string; kind: string; last: string; pending: string }>(sql`
      SELECT warehouse_id AS wid, kind, MAX(date)::text AS last, COUNT(*) FILTER (WHERE status = 'REPORTED')::text AS pending FROM consignment_docs WHERE tenant_id = ${tenantId} GROUP BY warehouse_id, kind`);
  }

  /** Dipakai oleh ConsignmentsService.docs */
  listConsignmentDocsWithCustomersByCustomerIdAndDateAndNumber(
    db: DbOrTx,
    tenantId: string,
    customerId: string | undefined,
  ) {
    return db
      .select({ d: consignmentDocs, code: customers.code, name: customers.name })
      .from(consignmentDocs)
      .innerJoin(customers, eq(customers.id, consignmentDocs.customerId))
      .where(
        and(
          eq(consignmentDocs.tenantId, tenantId),
          customerId ? eq(consignmentDocs.customerId, customerId) : undefined,
        ),
      )
      .orderBy(desc(consignmentDocs.date), desc(consignmentDocs.number))
      .limit(300);
  }

  /** Dipakai oleh ConsignmentsService.ship */
  queryStockBalanceForShip(db: DbOrTx, id: string) {
    return db.execute<{ v: string }>(
      sql`SELECT COALESCE(SUM(qty * avg_cost), 0)::text AS v FROM stock_balances WHERE warehouse_id = ${id}`,
    );
  }

  /** Dipakai oleh ConsignmentsService.invoice */
  updateConsignmentDocsByIdAndStatus(db: DbOrTx, sub: string, id: string) {
    return db
      .update(consignmentDocs)
      .set({ status: 'INVOICED', decidedById: sub })
      .where(and(eq(consignmentDocs.id, id), eq(consignmentDocs.status, 'REPORTED')))
      .returning({ id: consignmentDocs.id });
  }

  /** Dipakai oleh ConsignmentsService.invoice */
  listUsersById(db: DbOrTx, createdById: string) {
    return db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, createdById));
  }
}
