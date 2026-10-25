import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { customers, deliveryOrderLines } from '../../../db/schema';
import { eq, sql } from 'drizzle-orm';
import { Dec, ZERO } from '../../../common/utils/money';
import { DocDate } from '../../../common/utils/dates';
import { SalesOrdersService } from '../orders/sales-orders.service';

export type OrderWithLines = Awaited<ReturnType<SalesOrdersService['lockOrder']>>;

/** Akses data untuk Deliveries: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class DeliveriesRepository {
  /** Dipakai oleh DeliveriesService.deliver */
  findCustomersById(db: DbOrTx, customerId: string) {
    return db.select().from(customers).where(eq(customers.id, customerId));
  }

  /** Dipakai oleh DeliveriesService.deliver */
  insertDeliveryOrderLines(
    db: DbOrTx,
    id: string,
    lineId: string,
    productId: string,
    uom: string,
    uomFactor: string,
    qty: Dec,
    unitCost: Dec,
  ) {
    return db.insert(deliveryOrderLines).values({
      deliveryId: id,
      orderLineId: lineId,
      productId: productId,
      uom: uom,
      uomFactor: uomFactor,
      qty: qty.toFixed(4),
      unitCost: unitCost.toFixed(4),
    });
  }

  /** Dipakai oleh DeliveriesService.remainingQty */
  queryDeliveryOrderLine(db: DbOrTx, orderId: string) {
    return db.execute<{ order_line_id: string; q: string }>(sql`
      SELECT dl.order_line_id::text, SUM(dl.qty)::text AS q FROM delivery_order_lines dl JOIN delivery_orders d ON d.id = dl.delivery_id
      WHERE d.sales_order_id = ${orderId} AND d.status = 'DELIVERED' GROUP BY dl.order_line_id`);
  }

  /** Dipakai oleh DeliveriesService.cancel */
  queryDeliveryOrder(db: DbOrTx, id: string, tenantId: string) {
    return db.execute(sql`SELECT id FROM delivery_orders WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
  }

  /** Dipakai oleh DeliveriesService.cancel */
  queryStockMove(db: DbOrTx, id: string, productId: string) {
    return db.execute<{ wu: string }>(sql`
          SELECT COALESCE(SUM(-writedown_value) / NULLIF(SUM(-qty), 0), 0) AS wu FROM stock_moves
          WHERE ref_type = 'DELIVERY' AND ref_id = ${id} AND product_id = ${productId} AND type = 'SALE'`);
  }

  /** Dipakai oleh DeliveriesService.chain */
  queryInvoice(db: DbOrTx, invoiceId: string, tenantId: string) {
    return db.execute<{ sales_order_id: string | null }>(
      sql`SELECT sales_order_id FROM invoices WHERE id = ${invoiceId} AND tenant_id = ${tenantId}`,
    );
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh DeliveriesService.recordWithInvoice */
  insertDeliveryOrderLinesForRecordWithInvoice(
    db: DbOrTx,
    id: string,
    lineValues: string,
    lineLineValues: string,
    lineValues2: string,
    lineValues3: string,
    lineValues4: string,
    p: { order: OrderWithLines; date: DocDate; invoiceId: string; cogs: Dec; costs: Map<string, { unitCost: Dec }> },
  ) {
    return db.insert(deliveryOrderLines).values({
      deliveryId: id,
      orderLineId: lineValues,
      productId: lineLineValues,
      uom: lineValues2,
      uomFactor: lineValues3,
      qty: lineValues4,
      unitCost: (p.costs.get(lineValues)?.unitCost ?? ZERO).toFixed(4),
    });
  }
}
