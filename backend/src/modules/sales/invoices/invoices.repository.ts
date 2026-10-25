import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { salesOrders, customers, invoiceLines } from '../../../db/schema';
import { and, eq } from 'drizzle-orm';
import { Dec } from '../../../common/utils/money';

/** Akses data untuk Invoices: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class InvoicesRepository {
  /** Dipakai oleh InvoicesService.assertDeliveredBeforeInvoice */
  findSalesOrdersById(db: DbOrTx, orderId: string, tenantId: string) {
    return db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(and(eq(salesOrders.id, orderId), eq(salesOrders.tenantId, tenantId)));
  }

  /** Dipakai oleh InvoicesService.createFromOrder */
  findCustomersById(db: DbOrTx, customerId: string) {
    return db.select().from(customers).where(eq(customers.id, customerId));
  }

  /** Dipakai oleh InvoicesService.createFromOrder */
  insertInvoiceLines(
    db: DbOrTx,
    id: string,
    productId: string,
    uom: string,
    uomFactor: string,
    qty: string,
    price: string,
    priceForeign: string | null,
    discountPct: string,
    lineTotal: string,
    unitCost: Dec,
  ) {
    return db.insert(invoiceLines).values({
      invoiceId: id,
      productId: productId,
      uom: uom,
      uomFactor: uomFactor,
      qty: qty,
      price: price,
      priceForeign: priceForeign,
      discountPct: discountPct,
      lineTotal: lineTotal,
      unitCost: unitCost.toFixed(4),
    });
  }
}
