import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { tenants, purchaseOrders, suppliers, purchaseOrderLines } from '../../db/schema';
import { eq, sql, and } from 'drizzle-orm';
import type { BuiltLine } from '../master-data/products/line-builder';
import type { Decimal } from 'decimal.js';

/** Akses data untuk PurchaseOrders: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class PurchaseOrdersRepository {
  /** Dipakai oleh PurchaseOrdersService.createIn */
  findTenantsById(db: DbOrTx, tenantId: string) {
    return db.select().from(tenants).where(eq(tenants.id, tenantId));
  }

  /** Dipakai oleh PurchaseOrdersService.priceHistory */
  queryPurchaseInvoiceLine(db: DbOrTx, tenantId: string, ids: string[]) {
    return db.execute<{
      product_id: string;
      supplier_id: string;
      supplier_name: string;
      date: string;
      unit: string;
    }>(sql`
        SELECT l.product_id, i.supplier_id, s.name AS supplier_name, i.date::text AS date,
               l.line_total / NULLIF(l.qty * l.uom_factor, 0) AS unit
        FROM purchase_invoice_lines l
        JOIN purchase_invoices i ON i.id = l.invoice_id
        JOIN suppliers s ON s.id = i.supplier_id
        WHERE i.tenant_id = ${tenantId} AND i.kind = 'GOODS' AND l.product_id IN (${sql.join(
          ids.map((x) => sql`${x}`),
          sql`, `,
        )})
          AND i.date >= CURRENT_DATE - 365 AND l.qty * l.uom_factor > 0
        ORDER BY i.date DESC, i.created_at DESC`);
  }

  /** Dipakai oleh PurchaseOrdersService.confirm */
  findPurchaseOrdersById(db: DbOrTx, id: string, tenantId: string) {
    return db
      .select({
        number: purchaseOrders.number,
        total: purchaseOrders.total,
        status: purchaseOrders.status,
        supplierId: purchaseOrders.supplierId,
      })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenantId)));
  }

  /** Dipakai oleh PurchaseOrdersService.confirm */
  listSuppliersById(db: DbOrTx, supplierId: string) {
    return db
      .select({ preferred: suppliers.isPreferred, limit: suppliers.autoApproveLimit })
      .from(suppliers)
      .where(eq(suppliers.id, supplierId));
  }

  /** Dipakai oleh PurchaseOrdersService.confirm */
  listSuppliersByIdForConfirm(db: DbOrTx, supplierId: string) {
    return db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, supplierId));
  }

  /** Dipakai oleh PurchaseOrdersService.cancel */
  queryGoodsReceipt(db: DbOrTx, id: string) {
    return db.execute<{ receipts: number }>(
      sql`SELECT COUNT(*)::int AS receipts FROM goods_receipts WHERE purchase_order_id = ${id} AND status = 'RECEIVED'`,
    );
  }

  /** Dipakai oleh PurchaseOrdersService.lock */
  queryPurchaseOrder(db: DbOrTx, id: string, tenantId: string) {
    return db.execute(sql`
      SELECT id FROM purchase_orders WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh PurchaseOrdersService.createIn */
  insertPurchaseOrderLines(db: DbOrTx, lines: BuiltLine[], id: string, priceForeign: (Decimal | null)[]) {
    return db.insert(purchaseOrderLines).values(
      lines.map((l, i) => ({
        orderId: id,
        priceForeign: priceForeign[i]?.toFixed(4) ?? null,
        productId: l.productId,
        uom: l.uom,
        uomFactor: l.uomFactor,
        qty: l.qty,
        price: l.price.toFixed(2),
        discountPct: l.discountPct.toFixed(2),
        lineTotal: l.lineTotal.toFixed(2),
      })),
    );
  }
}
