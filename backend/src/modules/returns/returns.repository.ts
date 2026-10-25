import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { invoices, salesOrders, customers, salesReturnLines, suppliers, purchaseReturnLines } from '../../db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { Dec } from '../../common/utils/money';

export interface SourceLine {
  id: string;
  productId: string;
  uom: string;
  uomFactor: string;
  qty: string;
  price: string;
  discountPct: string;
  returnedQty: string;
  unitCost: string;
}

/** Akses data untuk Returns: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class ReturnsRepository {
  /** Dipakai oleh ReturnsService.createSales */
  findInvoicesById(db: DbOrTx, invoiceId: string, tenantId: string) {
    return db
      .select({ n: invoices.number })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)));
  }

  /** Dipakai oleh ReturnsService.createSales */
  listSalesOrdersById(db: DbOrTx, salesOrderId: string) {
    return db
      .select({ warehouseId: salesOrders.warehouseId })
      .from(salesOrders)
      .where(eq(salesOrders.id, salesOrderId));
  }

  /** Dipakai oleh ReturnsService.createSales */
  findCustomersById(db: DbOrTx, customerId: string) {
    return db.select().from(customers).where(eq(customers.id, customerId));
  }

  /** Dipakai oleh ReturnsService.createSales */
  queryGoodsSwapLine(db: DbOrTx, invoiceLineId: string) {
    return db.execute<{ q: string }>(sql`
          SELECT COALESCE(SUM(sl.qty), 0)::text AS q FROM goods_swap_lines sl JOIN goods_swaps s ON s.id = sl.swap_id
          WHERE sl.invoice_line_id = ${invoiceLineId} AND s.status IN ('PENDING', 'APPROVED')`);
  }

  /** Dipakai oleh ReturnsService.createSales */
  insertSalesReturnLines(db: DbOrTx, id: string, lId: string, productId: string, uom: string, qty: Dec, total: Dec) {
    return db.insert(salesReturnLines).values({
      returnId: id,
      invoiceLineId: lId,
      productId: productId,
      uom: uom,
      qty: qty.toFixed(4),
      lineTotal: total.toFixed(2),
    });
  }

  /** Dipakai oleh ReturnsService.createPurchase */
  findSuppliersById(db: DbOrTx, supplierId: string) {
    return db.select().from(suppliers).where(eq(suppliers.id, supplierId));
  }

  /** Dipakai oleh ReturnsService.createPurchase */
  insertPurchaseReturnLines(db: DbOrTx, id: string, lId: string, productId: string, uom: string, qty: Dec, total: Dec) {
    return db.insert(purchaseReturnLines).values({
      returnId: id,
      invoiceLineId: lId,
      productId: productId,
      uom: uom,
      qty: qty.toFixed(4),
      lineTotal: total.toFixed(2),
    });
  }

  /** Dipakai oleh ReturnsService.lockRow */
  queryLockRow(db: DbOrTx, table: 'invoices' | 'purchase_invoices', id: string, tenantId: string) {
    return db.execute(
      sql`SELECT id FROM ${sql.identifier(table)} WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
  }

  /** Dipakai oleh ReturnsService.sumTax */
  querySumTax(db: DbOrTx, table: 'purchase_returns' | 'sales_returns', fk: string, id: string) {
    return db.execute<{ v: string }>(
      sql`SELECT COALESCE(SUM(tax_amount), 0) AS v FROM ${sql.identifier(table)} WHERE ${sql.identifier(fk)} = ${id}`,
    );
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh ReturnsService.createSales */
  queryStockMove(
    db: DbOrTx,
    invValues: string,
    invInvValues: string | null,
    l: { src: SourceLine; qty: Dec; total: Dec },
  ) {
    return db.execute<{ wu: string }>(sql`
          SELECT COALESCE(SUM(-writedown_value) / NULLIF(SUM(-qty), 0), 0) AS wu FROM stock_moves
          WHERE ((ref_type = 'INVOICE' AND ref_id = ${invValues}) OR (ref_type = 'DELIVERY' AND ref_id = ${invInvValues ?? invValues})) AND product_id = ${l.src.productId} AND type = 'SALE'`);
  }
}
