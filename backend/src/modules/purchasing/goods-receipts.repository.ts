import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { tenants, suppliers, goodsReceiptLines, purchaseOrderLines } from '../../db/schema';
import { eq, sql } from 'drizzle-orm';
import { Dec, ZERO } from '../../common/utils/money';

/** Akses data untuk GoodsReceipts: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class GoodsReceiptsRepository {
  /** Dipakai oleh GoodsReceiptsService.isPkp */
  findTenantsById(db: DbOrTx, tenantId: string) {
    return db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  }

  /** Dipakai oleh GoodsReceiptsService.receive */
  queryProduct(db: DbOrTx, tenantId: string, diffs: { sku: string; ordered: Dec; got: Dec }[]) {
    return db.execute<{ id: string; name: string }>(
      sql`SELECT id, name FROM products WHERE tenant_id = ${tenantId} AND id IN (${sql.join(
        diffs.map((d) => sql`${d.sku}::uuid`),
        sql`, `,
      )})`,
    );
  }

  /** Dipakai oleh GoodsReceiptsService.record */
  findSuppliersById(db: DbOrTx, supplierId: string) {
    return db.select().from(suppliers).where(eq(suppliers.id, supplierId));
  }

  /** Dipakai oleh GoodsReceiptsService.record */
  insertGoodsReceiptLines(
    db: DbOrTx,
    id: string,
    lineId: string,
    productId: string,
    uom: string,
    uomFactor: string,
    qty: Dec,
    unitCost: Dec,
    value: Dec,
  ) {
    return db.insert(goodsReceiptLines).values({
      receiptId: id,
      orderLineId: lineId,
      productId: productId,
      uom: uom,
      uomFactor: uomFactor,
      qty: qty.toFixed(4),
      unitCost: unitCost.toFixed(4),
      value: value.toFixed(2),
    });
  }

  /** Dipakai oleh GoodsReceiptsService.recordWithInvoice */
  insertGoodsReceiptLinesForRecordWithInvoice(
    db: DbOrTx,
    id: string,
    lineId: string,
    productId: string,
    uom: string,
    uomFactor: string,
    qty: string,
    v: { unitCost: Dec; value: Dec } | undefined,
  ) {
    return db.insert(goodsReceiptLines).values({
      receiptId: id,
      orderLineId: lineId,
      productId: productId,
      uom: uom,
      uomFactor: uomFactor,
      qty: qty,
      unitCost: (v?.unitCost ?? ZERO).toFixed(4),
      value: (v?.value ?? ZERO).toFixed(2),
      billedQty: qty,
      billedValue: (v?.value ?? ZERO).toFixed(2),
    });
  }

  /** Dipakai oleh GoodsReceiptsService.recordWithInvoice */
  updatePurchaseOrderLinesByOrderId(db: DbOrTx, id: string) {
    return db
      .update(purchaseOrderLines)
      .set({
        receivedQty: purchaseOrderLines.qty,
        billedQty: purchaseOrderLines.qty,
        billedAmount: purchaseOrderLines.lineTotal,
      })
      .where(eq(purchaseOrderLines.orderId, id));
  }

  /** Dipakai oleh GoodsReceiptsService.cancel */
  queryGoodsReceipt(db: DbOrTx, id: string, tenantId: string) {
    return db.execute(sql`SELECT id FROM goods_receipts WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`);
  }

  /** Dipakai oleh GoodsReceiptsService.cancel */
  queryQcInspection(db: DbOrTx, id: string) {
    return db.execute(sql`SELECT 1 FROM qc_inspections WHERE receipt_id = ${id} LIMIT 1`);
  }
}
