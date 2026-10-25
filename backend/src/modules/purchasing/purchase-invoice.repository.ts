import { Injectable } from '@nestjs/common';
import { and, eq, sql, asc } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import {
  accounts,
  purchaseInvoices,
  supplierPayments,
  suppliers,
  tenants,
  goodsReceiptLines,
  goodsReceipts,
  goodsReceiptBillings,
  purchaseOrderLines,
  purchaseInvoiceLines,
} from '../../db/schema';
import { Dec, D } from '../../common/utils/money';

/** Akses data faktur pembelian: pencarian satu baris per id, selalu memakai koneksi/transaksi pemanggil. */
@Injectable()
export class PurchaseInvoiceRepository {
  async supplierById(db: DbOrTx, id: string) {
    const [s] = await db.select().from(suppliers).where(eq(suppliers.id, id));
    return s;
  }

  async supplierOfTenant(db: DbOrTx, tenantId: string, id: string) {
    const [s] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId)));
    return s;
  }

  async accountOfTenant(db: DbOrTx, tenantId: string, id: string) {
    const [a] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.tenantId, tenantId)));
    return a;
  }

  async invoiceById(db: DbOrTx, id: string) {
    const [i] = await db.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, id));
    return i;
  }

  async paymentById(db: DbOrTx, id: string) {
    const [p] = await db.select().from(supplierPayments).where(eq(supplierPayments.id, id));
    return p;
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh PurchaseInvoicesService.priceControl */
  queryApprovalRequest(db: DbOrTx, tenantId: string, id: string, supplierInvoiceNo: string) {
    return db.execute<{ id: string }>(sql`
          SELECT id FROM approval_requests WHERE tenant_id = ${tenantId} AND kind = 'PURCHASE_INVOICE_PRICE' AND status = 'PENDING'
            AND ref_id = ${id} AND payload->>'supplierInvoiceNo' = ${supplierInvoiceNo.trim()}`);
  }

  /** Dipakai oleh PurchaseInvoicesService.vatOn */
  findTenantsById(db: DbOrTx, tenantId: string) {
    return db
      .select({ ppnRate: tenants.ppnRate, settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
  }

  /** Dipakai oleh PurchaseInvoicesService.billReceived */
  listGoodsReceiptLinesWithGoodsReceiptsById(db: DbOrTx, id: string) {
    return db
      .select({
        rl: goodsReceiptLines,
        date: goodsReceipts.date,
        number: goodsReceipts.number,
        capitalized: goodsReceipts.vatCapitalized,
      })
      .from(goodsReceiptLines)
      .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.receiptId))
      .where(and(eq(goodsReceipts.purchaseOrderId, id), eq(goodsReceipts.status, 'RECEIVED')))
      .orderBy(asc(goodsReceipts.date), asc(goodsReceipts.number), asc(goodsReceiptLines.id))
      .for('update', { of: goodsReceiptLines });
  }

  /** Dipakai oleh PurchaseInvoicesService.billReceived */
  queryPurchaseInvoice(db: DbOrTx, id: string) {
    return db.execute<{ tax: string; sub: string; var: string }>(sql`
      SELECT COALESCE(SUM(tax_amount), 0) AS tax, COALESCE(SUM(subtotal), 0) AS sub, COALESCE(SUM(price_variance), 0) AS var FROM purchase_invoices WHERE purchase_order_id = ${id}`);
  }

  /** Dipakai oleh PurchaseInvoicesService.billReceived */
  insertGoodsReceiptBillings(
    db: DbOrTx,
    billings: { receiptId: string; receiptLineId: string; qty: Dec; value: Dec }[],
    tenantId: string,
    id: string,
    date: string,
  ) {
    return db.insert(goodsReceiptBillings).values(
      billings.map((b) => ({
        tenantId: tenantId,
        receiptId: b.receiptId,
        receiptLineId: b.receiptLineId,
        invoiceId: id,
        date: date,
        qty: b.qty.toFixed(4),
        value: b.value.toFixed(2),
      })),
    );
  }

  /** Dipakai oleh PurchaseInvoicesService.billReceived */
  queryStockBalance(db: DbOrTx, tenantId: string, productId: string, warehouseId: string) {
    return db.execute<{ qty: string }>(
      sql`SELECT qty FROM stock_balances WHERE tenant_id = ${tenantId} AND product_id = ${productId} AND warehouse_id = ${warehouseId}`,
    );
  }

  /** Dipakai oleh PurchaseInvoicesService.billReceived */
  listPurchaseOrderLinesByOrderId(db: DbOrTx, id: string) {
    return db
      .select({ qty: purchaseOrderLines.qty, billedQty: purchaseOrderLines.billedQty })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.orderId, id));
  }

  /** Dipakai oleh PurchaseInvoicesService.isPkp */
  findTenantsByIdForIsPkp(db: DbOrTx, tenantId: string) {
    return db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh PurchaseInvoicesService.receiveAndBill */
  insertPurchaseInvoiceLines(
    db: DbOrTx,
    id: string,
    lineValues: string,
    lineLineValues: string,
    lineValues2: string,
    lineValues3: string,
    over: Map<string, Dec>,
    lineValues4: string,
    lineValues5: string,
    pr: { rate: Dec; over: Map<string, Dec>; foreignPrice: Map<string, Dec>; given: Map<string, Dec> },
    lineValues6: string,
    dpp: Dec,
    unitCost: Dec,
    lineValues7: string,
  ) {
    return db.insert(purchaseInvoiceLines).values({
      invoiceId: id,
      productId: lineValues,
      uom: lineLineValues,
      uomFactor: lineValues2,
      qty: lineValues3,
      price: (over.get(lineValues4) ?? D(lineValues5)).toFixed(2),
      priceForeign: pr.foreignPrice.get(lineValues4)?.toFixed(4) ?? null,
      discountPct: lineValues6,
      lineTotal: dpp.toFixed(2),
      unitCost: unitCost.toFixed(4),
      priceVariance: dpp.minus(lineValues7).toFixed(2),
      orderLineId: lineValues4,
    });
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh PurchaseInvoicesService.billReceived */
  insertPurchaseInvoiceLinesForBillReceived(db: DbOrTx, values: typeof purchaseInvoiceLines.$inferInsert) {
    return db.insert(purchaseInvoiceLines).values(values);
  }
}
