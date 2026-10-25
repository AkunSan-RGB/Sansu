import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { customers, goodsSwaps, invoices, goodsSwapLines, salesOrders, invoiceLines } from '../../db/schema';
import { inArray, sql, eq } from 'drizzle-orm';
import { D } from '../../common/utils/money';
import type { SwapLineDto } from './swaps.dto';

/** Akses data untuk Swaps: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class SwapsRepository {
  /** Dipakai oleh SwapsService.list */
  listCustomersById(db: DbOrTx, rows: (typeof goodsSwaps.$inferSelect)[]) {
    return db
      .select({ id: customers.id, code: customers.code, name: customers.name })
      .from(customers)
      .where(inArray(customers.id, [...new Set(rows.map((r) => r.customerId))]));
  }

  /** Dipakai oleh SwapsService.list */
  listInvoicesById(db: DbOrTx, rows: (typeof goodsSwaps.$inferSelect)[]) {
    return db
      .select({ id: invoices.id, number: invoices.number })
      .from(invoices)
      .where(inArray(invoices.id, [...new Set(rows.map((r) => r.invoiceId))]));
  }

  /** Dipakai oleh SwapsService.list */
  listGoodsSwapLinesBySwapId(db: DbOrTx, rows: (typeof goodsSwaps.$inferSelect)[]) {
    return db
      .select()
      .from(goodsSwapLines)
      .where(
        inArray(
          goodsSwapLines.swapId,
          rows.map((r) => r.id),
        ),
      );
  }

  /** Dipakai oleh SwapsService.create */
  queryInvoice(db: DbOrTx, invoiceId: string, tenantId: string) {
    return db.execute(sql`SELECT id FROM invoices WHERE id = ${invoiceId} AND tenant_id = ${tenantId} FOR UPDATE`);
  }

  /** Dipakai oleh SwapsService.create */
  listSalesOrdersById(db: DbOrTx, salesOrderId: string) {
    return db
      .select({ warehouseId: salesOrders.warehouseId })
      .from(salesOrders)
      .where(eq(salesOrders.id, salesOrderId));
  }

  /** Dipakai oleh SwapsService.create */
  queryGoodsSwapLine(db: DbOrTx, id: string) {
    return db.execute<{ q: string }>(sql`
          SELECT COALESCE(SUM(sl.qty), 0)::text AS q FROM goods_swap_lines sl JOIN goods_swaps s ON s.id = sl.swap_id
          WHERE sl.invoice_line_id = ${id} AND s.status IN ('PENDING', 'APPROVED')`);
  }

  /** Dipakai oleh SwapsService.approve */
  listGoodsSwapLinesBySwapIdForApprove(db: DbOrTx, id: string) {
    return db.select().from(goodsSwapLines).where(eq(goodsSwapLines.swapId, id));
  }

  /** Dipakai oleh SwapsService.approve */
  findInvoiceLinesById(db: DbOrTx, invoiceLineId: string) {
    return db.select().from(invoiceLines).where(eq(invoiceLines.id, invoiceLineId));
  }

  /** Dipakai oleh SwapsService.approve */
  queryGoodsSwapLineForApprove(db: DbOrTx, invoiceLineId: string) {
    return db.execute<{ q: string }>(sql`
          SELECT COALESCE(SUM(sl.qty), 0)::text AS q FROM goods_swap_lines sl JOIN goods_swaps s ON s.id = sl.swap_id
          WHERE sl.invoice_line_id = ${invoiceLineId} AND s.status = 'APPROVED'`);
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh SwapsService.create */
  insertGoodsSwapLines(db: DbOrTx, lines: SwapLineDto[], invLines: (typeof invoiceLines.$inferSelect)[], id: string) {
    return db.insert(goodsSwapLines).values(
      lines.map((l) => {
        const src = invLines.find((x) => x.id === l.invoiceLineId)!;
        return {
          swapId: id,
          invoiceLineId: src.id,
          productId: src.productId,
          uom: src.uom,
          uomFactor: src.uomFactor,
          qty: D(l.qty).toFixed(4),
          lotNo: l.lotNo?.trim() || null,
        };
      }),
    );
  }
}
