import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { warehouses, boms, bomLines, products, productionOrders, users } from '../../db/schema';
import { and, eq, inArray, sql, gte, lte } from 'drizzle-orm';
import { VarianceQueryDto } from './manufacturing.dto';

/** Akses data untuk Manufacturing: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class ManufacturingRepository {
  /** Dipakai oleh ManufacturingService.analyze */
  findWarehousesById(db: DbOrTx, warehouseId: string, tenantId: string) {
    return db
      .select({ id: warehouses.id, name: warehouses.name })
      .from(warehouses)
      .where(and(eq(warehouses.id, warehouseId), eq(warehouses.tenantId, tenantId)));
  }

  /** Dipakai oleh ManufacturingService.analyze */
  listBomsByIsActive(db: DbOrTx, tenantId: string) {
    return db
      .select()
      .from(boms)
      .where(and(eq(boms.tenantId, tenantId), eq(boms.isActive, true)));
  }

  /** Dipakai oleh ManufacturingService.analyze */
  listBomLinesByBomId(db: DbOrTx, allBoms: (typeof boms.$inferSelect)[]) {
    return db
      .select()
      .from(bomLines)
      .where(
        inArray(
          bomLines.bomId,
          allBoms.map((b) => b.id),
        ),
      );
  }

  /** Dipakai oleh ManufacturingService.analyze */
  queryStockBalance(db: DbOrTx, tenantId: string, warehouseId: string) {
    return db.execute<{ product_id: string; qty: string }>(
      sql`SELECT product_id, qty FROM stock_balances WHERE tenant_id = ${tenantId} AND warehouse_id = ${warehouseId}`,
    );
  }

  /** Dipakai oleh ManufacturingService.requirements */
  listProductsById(db: DbOrTx, ids: string[]) {
    return db
      .select({ id: products.id, sku: products.sku, name: products.name, unit: products.baseUom })
      .from(products)
      .where(inArray(products.id, ids));
  }

  /** Dipakai oleh ManufacturingService.requirements */
  queryProduct(db: DbOrTx, warehouseId: string, tenantId: string, ids: string[]) {
    return db.execute<{
      product_id: string;
      on_order: string;
      requested: string;
      on_hand: string;
      supplier_id: string | null;
      supplier_name: string | null;
      last_price: string | null;
    }>(sql`
            SELECT p.id AS product_id, COALESCE(b.qty, 0) AS on_hand, COALESCE(po.qty, 0) AS on_order, COALESCE(pr.qty, 0) AS requested,
                   ls.supplier_id, ls.supplier_name, ls.base_price AS last_price
            FROM products p
            LEFT JOIN stock_balances b ON b.product_id = p.id AND b.warehouse_id = ${warehouseId}
            LEFT JOIN (
              SELECT l.product_id, SUM((l.qty - l.received_qty) * l.uom_factor) AS qty
              FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id
              WHERE o.tenant_id = ${tenantId} AND o.warehouse_id = ${warehouseId} AND o.status IN ('DRAFT', 'CONFIRMED') AND l.qty > l.received_qty
              GROUP BY 1) po ON po.product_id = p.id
            LEFT JOIN (
              SELECT l.product_id, SUM(l.qty * l.uom_factor) AS qty
              FROM purchase_request_lines l JOIN purchase_requests r ON r.id = l.request_id
              WHERE r.tenant_id = ${tenantId} AND r.warehouse_id = ${warehouseId} AND r.status IN ('SUBMITTED', 'APPROVED') AND l.purchase_order_id IS NULL
              GROUP BY 1) pr ON pr.product_id = p.id
            LEFT JOIN LATERAL (
              SELECT o.supplier_id, s.name AS supplier_name, l.price / NULLIF(l.uom_factor, 0) AS base_price
              FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id JOIN suppliers s ON s.id = o.supplier_id
              WHERE o.tenant_id = ${tenantId} AND l.product_id = p.id AND o.status <> 'CANCELLED'
              ORDER BY o.date DESC, o.created_at DESC LIMIT 1) ls ON true
            WHERE p.tenant_id = ${tenantId} AND p.id IN (${sql.join(
              ids.map((x) => sql`${x}`),
              sql`, `,
            )})`);
  }

  /** Dipakai oleh ManufacturingService.plan */
  findProductionOrdersById(db: DbOrTx, id: string) {
    return db.select({ number: productionOrders.number }).from(productionOrders).where(eq(productionOrders.id, id));
  }

  /** Dipakai oleh ManufacturingService.variance */
  listProductionOrdersWithBomsAndProductsByStatusAndCompletedDateAndNumber(
    db: DbOrTx,
    tenantId: string,
    q: VarianceQueryDto,
  ) {
    return db
      .select({ o: productionOrders, bom: boms, sku: products.sku, name: products.name, by: users.name })
      .from(productionOrders)
      .innerJoin(boms, eq(boms.id, productionOrders.bomId))
      .innerJoin(products, eq(products.id, productionOrders.productId))
      .leftJoin(users, eq(users.id, productionOrders.createdById))
      .where(
        and(
          eq(productionOrders.tenantId, tenantId),
          eq(productionOrders.status, 'COMPLETED'),
          q.from ? gte(productionOrders.completedDate, q.from) : undefined,
          q.to ? lte(productionOrders.completedDate, q.to) : undefined,
        ),
      )
      .orderBy(sql`${productionOrders.completedDate} DESC, ${productionOrders.number} DESC`)
      .limit(300);
  }
}
