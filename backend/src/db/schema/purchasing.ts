// Skema database — purchasing
import { relations } from 'drizzle-orm';
import { boolean, date, index, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, money, qty } from './columns';
import { tenantId } from './tenancy';
import { products, suppliers, warehouses } from './master-data';
import { PurchaseRequestStatus, invoiceStatusEnum, purchaseOrderStatusEnum } from './enums';
import { accounts } from './accounting';
import { assetCategories, fixedAssets } from './assets';

/** Riwayat penagihan penerimaan barang per tanggal faktur: dasar menghitung "barang diterima belum ditagih" per tanggal tertentu */
export const goodsReceiptBillings = pgTable(
  'goods_receipt_billings',
  {
    id: id(),
    tenantId: tenantId(),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => goodsReceipts.id, { onDelete: 'cascade' }),
    receiptLineId: uuid('receipt_line_id')
      .notNull()
      .references(() => goodsReceiptLines.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id'),
    date: date('date').notNull(),
    qty: qty('qty').notNull(),
    value: money('value').notNull(),
    /** true = dibuat dari data lama (tanggalnya perkiraan: faktur terakhir yang menagih baris pesanannya) */
    estimated: boolean('estimated').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('goods_receipt_billings_receipt_idx').on(t.receiptId, t.date), index('goods_receipt_billings_tenant_date_idx').on(t.tenantId, t.date)],
);

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    status: purchaseOrderStatusEnum('status').notNull().default('DRAFT'),
    subtotal: money('subtotal').notNull().default('0'),
    taxAmount: money('tax_amount').notNull().default('0'),
    total: money('total').notNull().default('0'),
    /** Harga berasal dari penawaran supplier (pembelian cepat) — final menunggu faktur; biaya perolehan mengikuti faktur */
    priceEstimate: boolean('price_estimate').notNull().default(false),
    /** Mata uang dokumen (ISO); IDR = Rupiah. Kolom rupiah lain selalu dalam Rupiah (kurs saat transaksi) */
    currency: text('currency').notNull().default('IDR'),
    fxRate: numeric('fx_rate', { precision: 18, scale: 6 }).notNull().default('1'),
    totalForeign: money('total_foreign'),
    notes: text('notes'),
    createdById: uuid('created_by_id'),
    cancelReason: text('cancel_reason'),
    cancelledById: uuid('cancelled_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('purchase_orders_number_uq').on(t.tenantId, t.number)],
);

export const purchaseOrderLines = pgTable('purchase_order_lines', {
  id: id(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  uom: text('uom').notNull(),
  uomFactor: qty('uom_factor').notNull(),
  qty: qty('qty').notNull(),
  /** Harga beli per `uom`, belum PPN */
  price: money('price').notNull(),
  discountPct: numeric('discount_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  lineTotal: money('line_total').notNull(),
  priceForeign: numeric('price_foreign', { precision: 18, scale: 4 }),
  /** Jumlah yang sudah diterima gudang (satuan `uom` baris) — penerimaan barang bisa bertahap */
  receivedQty: qty('received_qty').notNull().default('0'),
  /** Jumlah yang sudah difakturkan dan nilai DPP-nya */
  billedQty: qty('billed_qty').notNull().default('0'),
  billedAmount: money('billed_amount').notNull().default('0'),
});

export const purchaseRequests = pgTable(
  'purchase_requests',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    /** Barang dibutuhkan paling lambat tanggal ini */
    neededBy: date('needed_by'),
    status: text('status').$type<PurchaseRequestStatus>().notNull().default('DRAFT'),
    notes: text('notes'),
    requestedById: uuid('requested_by_id'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedById: uuid('decided_by_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    /** Disetujui otomatis karena nilainya di bawah batas persetujuan otomatis */
    autoApproved: boolean('auto_approved').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('purchase_requests_number_uq').on(t.tenantId, t.number), index('purchase_requests_status_idx').on(t.tenantId, t.status)],
);

export const purchaseRequestLines = pgTable('purchase_request_lines', {
  id: id(),
  requestId: uuid('request_id')
    .notNull()
    .references(() => purchaseRequests.id, { onDelete: 'cascade' }),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  uom: text('uom').notNull(),
  uomFactor: qty('uom_factor').notNull(),
  qty: qty('qty').notNull(),
  /** Supplier usulan (opsional; bisa ditentukan saat menjadi PO) */
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  /** Perkiraan harga beli per `uom`, belum PPN (opsional) */
  estPrice: money('est_price'),
  /** Pesanan pembelian hasil konversi; kosong = belum dipesan */
  purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id),
});

/**
 * Penerimaan barang (GRN) atas pesanan pembelian — mata rantai antara pesanan dan faktur:
 *   pesanan → penerimaan (bisa bertahap) → faktur supplier (bisa bertahap) → pembayaran
 * Penerimaan menambah stok dan mencatat Dr Persediaan | Cr Barang Diterima Belum Ditagih; faktur menutup akun itu ke Utang Usaha.
 */
export const goodsReceipts = pgTable(
  'goods_receipts',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    purchaseOrderId: uuid('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    status: text('status').$type<'RECEIVED' | 'CANCELLED'>().notNull().default('RECEIVED'),
    /** Nomor surat jalan dari supplier */
    supplierDeliveryNo: text('supplier_delivery_no'),
    /** Nilai persediaan yang diterima (dasar jurnal) */
    value: money('value').notNull().default('0'),
    /** Non-PKP: PPN supplier ikut ke harga perolehan sejak penerimaan */
    vatCapitalized: boolean('vat_capitalized').notNull().default(false),
    /** Jurnal Dr Persediaan | Cr Barang Diterima Belum Ditagih; kosong bila dibuat otomatis bersama faktur */
    journalId: uuid('journal_id'),
    /** Terisi bila penerimaan ini dibuat otomatis bersama faktur (jalur langsung faktur) */
    autoInvoiceId: uuid('auto_invoice_id'),
    notes: text('notes'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('goods_receipts_number_uq').on(t.tenantId, t.number),
    index('goods_receipts_order_idx').on(t.purchaseOrderId),
    index('goods_receipts_date_idx').on(t.tenantId, t.date),
  ],
);

export const goodsReceiptLines = pgTable('goods_receipt_lines', {
  id: id(),
  receiptId: uuid('receipt_id')
    .notNull()
    .references(() => goodsReceipts.id, { onDelete: 'cascade' }),
  orderLineId: uuid('order_line_id').notNull(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  uom: text('uom').notNull(),
  uomFactor: qty('uom_factor').notNull(),
  qty: qty('qty').notNull(),
  unitCost: qty('unit_cost').notNull(),
  /** Nilai persediaan baris ini (dibulatkan 2 desimal) */
  value: money('value').notNull(),
  /** Bagian yang sudah ditagih oleh faktur */
  billedQty: qty('billed_qty').notNull().default('0'),
  billedValue: money('billed_value').notNull().default('0'),
});

export const purchaseInvoices = pgTable(
  'purchase_invoices',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    /** Nomor faktur dari supplier */
    supplierInvoiceNo: text('supplier_invoice_no').notNull(),
    date: date('date').notNull(),
    dueDate: date('due_date').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id),
    /** GOODS = barang dagang dari PO; BILL = tagihan biaya / aset tetap */
    kind: text('kind').notNull().default('GOODS'),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id),
    description: text('description'),
    subtotal: money('subtotal').notNull(),
    taxAmount: money('tax_amount').notNull(),
    /** PPh yang dipotong saat membayar supplier (PPh 23 / 4 ayat 2) */
    withholdingType: text('withholding_type'),
    withholdingAmount: money('withholding_amount').notNull().default('0'),
    /** Dasar pemotongan (DPP) & tarif PPh — untuk rekap bukti potong e-Bupot */
    withholdingBase: money('withholding_base').notNull().default('0'),
    withholdingRate: numeric('withholding_rate', { precision: 5, scale: 2 }),
    /** Tagihan biaya untuk proyek tertentu (biaya langsung proyek) */
    projectId: uuid('project_id'),
    /** Perusahaan non-PKP: PPN supplier tidak dikreditkan, dimasukkan ke harga perolehan */
    vatCapitalized: boolean('vat_capitalized').notNull().default(false),
    /** Jumlah yang dibayar ke supplier = subtotal + PPN − PPh dipotong */
    total: money('total').notNull(),
    paidAmount: money('paid_amount').notNull().default('0'),
    returnedAmount: money('returned_amount').notNull().default('0'),
    /** Selisih DPP faktur terhadap harga PO (+ faktur lebih mahal); biaya perolehan stok mengikuti harga faktur */
    priceVariance: money('price_variance').notNull().default('0'),
    /** Pengendalian selisih harga: alasan, catatan, penanda (mis. ABOVE_MARKET), pembuat faktur, dan persetujuan yang menyetujuinya */
    varianceReason: text('variance_reason'),
    varianceNote: text('variance_note'),
    priceFlags: text('price_flags'),
    createdById: uuid('created_by_id'),
    approvalId: uuid('approval_id'),
    currency: text('currency').notNull().default('IDR'),
    fxRate: numeric('fx_rate', { precision: 18, scale: 6 }).notNull().default('1'),
    totalForeign: money('total_foreign'),
    paidForeign: money('paid_foreign').notNull().default('0'),
    /** Nilai retur dalam mata uang dokumen */
    returnedForeign: money('returned_foreign').notNull().default('0'),
    status: invoiceStatusEnum('status').notNull().default('UNPAID'),
    journalId: uuid('journal_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('purchase_invoices_number_uq').on(t.tenantId, t.number),
    index('purchase_invoices_po_idx').on(t.purchaseOrderId),
    uniqueIndex('purchase_invoices_supplier_no_uq').on(t.tenantId, t.supplierId, t.supplierInvoiceNo),
  ],
);

export const purchaseInvoiceLines = pgTable('purchase_invoice_lines', {
  id: id(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => purchaseInvoices.id, { onDelete: 'cascade' }),
  /** PRODUCT = barang dagang, EXPENSE = biaya ke akun, ASSET = aset tetap baru */
  lineType: text('line_type').notNull().default('PRODUCT'),
  productId: uuid('product_id').references(() => products.id),
  accountId: uuid('account_id').references(() => accounts.id),
  assetCategoryId: uuid('asset_category_id').references(() => assetCategories.id),
  assetId: uuid('asset_id').references(() => fixedAssets.id),
  description: text('description'),
  uom: text('uom').notNull(),
  uomFactor: qty('uom_factor').notNull(),
  qty: qty('qty').notNull(),
  price: money('price').notNull(),
  discountPct: numeric('discount_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  lineTotal: money('line_total').notNull(),
  /** Biaya per satuan dasar (DPP / qty dasar) yang masuk ke persediaan */
  unitCost: qty('unit_cost').notNull(),
  /** Selisih DPP baris terhadap harga PO (+ faktur lebih mahal) */
  priceVariance: money('price_variance').notNull().default('0'),
  /** Faktur valas: harga per `uom` dalam mata uang faktur */
  priceForeign: numeric('price_foreign', { precision: 18, scale: 4 }),
  returnedQty: qty('returned_qty').notNull().default('0'),
  /** Baris pesanan pembelian yang ditagih (faktur dari pesanan) */
  orderLineId: uuid('order_line_id'),
});

export const supplierPayments = pgTable(
  'supplier_payments',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    purchaseInvoiceId: uuid('purchase_invoice_id')
      .notNull()
      .references(() => purchaseInvoices.id),
    amount: money('amount').notNull(),
    cashAccountId: uuid('cash_account_id')
      .notNull()
      .references(() => accounts.id),
    notes: text('notes'),
    journalId: uuid('journal_id'),
    currency: text('currency').notNull().default('IDR'),
    amountForeign: money('amount_foreign'),
    fxRate: numeric('fx_rate', { precision: 18, scale: 6 }),
    cashAmount: money('cash_amount'),
    fxGainLoss: money('fx_gain_loss').notNull().default('0'),
    createdAt: createdAt(),
    /** POSTED | VOID (dibatalkan dengan jurnal pembalik; pembayaran tidak pernah dihapus) */
    status: text('status').$type<'POSTED' | 'VOID'>().notNull().default('POSTED'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedById: uuid('voided_by_id'),
    voidReason: text('void_reason'),
    voidJournalId: uuid('void_journal_id'),
  },
  (t) => [uniqueIndex('supplier_payments_number_uq').on(t.tenantId, t.number)],
);

export const purchaseReturns = pgTable(
  'purchase_returns',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    purchaseInvoiceId: uuid('purchase_invoice_id')
      .notNull()
      .references(() => purchaseInvoices.id),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    reason: text('reason'),
    subtotal: money('subtotal').notNull(),
    taxAmount: money('tax_amount').notNull(),
    total: money('total').notNull(),
    journalId: uuid('journal_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('purchase_returns_number_uq').on(t.tenantId, t.number)],
);

export const purchaseReturnLines = pgTable('purchase_return_lines', {
  id: id(),
  returnId: uuid('return_id')
    .notNull()
    .references(() => purchaseReturns.id, { onDelete: 'cascade' }),
  invoiceLineId: uuid('invoice_line_id')
    .notNull()
    .references(() => purchaseInvoiceLines.id),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  uom: text('uom').notNull(),
  qty: qty('qty').notNull(),
  lineTotal: money('line_total').notNull(),
});

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [purchaseOrders.supplierId], references: [suppliers.id] }),
  warehouse: one(warehouses, { fields: [purchaseOrders.warehouseId], references: [warehouses.id] }),
  lines: many(purchaseOrderLines),
  invoices: many(purchaseInvoices),
  receipts: many(goodsReceipts),
}));

export const goodsReceiptsRelations = relations(goodsReceipts, ({ one, many }) => ({
  order: one(purchaseOrders, { fields: [goodsReceipts.purchaseOrderId], references: [purchaseOrders.id] }),
  supplier: one(suppliers, { fields: [goodsReceipts.supplierId], references: [suppliers.id] }),
  warehouse: one(warehouses, { fields: [goodsReceipts.warehouseId], references: [warehouses.id] }),
  lines: many(goodsReceiptLines),
}));

export const goodsReceiptLinesRelations = relations(goodsReceiptLines, ({ one }) => ({
  receipt: one(goodsReceipts, { fields: [goodsReceiptLines.receiptId], references: [goodsReceipts.id] }),
  product: one(products, { fields: [goodsReceiptLines.productId], references: [products.id] }),
}));

export const purchaseRequestsRelations = relations(purchaseRequests, ({ one, many }) => ({
  warehouse: one(warehouses, { fields: [purchaseRequests.warehouseId], references: [warehouses.id] }),
  lines: many(purchaseRequestLines),
}));

export const purchaseRequestLinesRelations = relations(purchaseRequestLines, ({ one }) => ({
  request: one(purchaseRequests, { fields: [purchaseRequestLines.requestId], references: [purchaseRequests.id] }),
  product: one(products, { fields: [purchaseRequestLines.productId], references: [products.id] }),
  supplier: one(suppliers, { fields: [purchaseRequestLines.supplierId], references: [suppliers.id] }),
  order: one(purchaseOrders, { fields: [purchaseRequestLines.purchaseOrderId], references: [purchaseOrders.id] }),
}));

export const purchaseOrderLinesRelations = relations(purchaseOrderLines, ({ one }) => ({
  order: one(purchaseOrders, { fields: [purchaseOrderLines.orderId], references: [purchaseOrders.id] }),
  product: one(products, { fields: [purchaseOrderLines.productId], references: [products.id] }),
}));

export const purchaseInvoicesRelations = relations(purchaseInvoices, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [purchaseInvoices.supplierId], references: [suppliers.id] }),
  purchaseOrder: one(purchaseOrders, { fields: [purchaseInvoices.purchaseOrderId], references: [purchaseOrders.id] }),
  lines: many(purchaseInvoiceLines),
  payments: many(supplierPayments),
}));

export const purchaseInvoiceLinesRelations = relations(purchaseInvoiceLines, ({ one }) => ({
  invoice: one(purchaseInvoices, { fields: [purchaseInvoiceLines.invoiceId], references: [purchaseInvoices.id] }),
  product: one(products, { fields: [purchaseInvoiceLines.productId], references: [products.id] }),
  account: one(accounts, { fields: [purchaseInvoiceLines.accountId], references: [accounts.id] }),
  assetCategory: one(assetCategories, { fields: [purchaseInvoiceLines.assetCategoryId], references: [assetCategories.id] }),
  asset: one(fixedAssets, { fields: [purchaseInvoiceLines.assetId], references: [fixedAssets.id] }),
}));

export const supplierPaymentsRelations = relations(supplierPayments, ({ one }) => ({
  supplier: one(suppliers, { fields: [supplierPayments.supplierId], references: [suppliers.id] }),
  invoice: one(purchaseInvoices, { fields: [supplierPayments.purchaseInvoiceId], references: [purchaseInvoices.id] }),
  cashAccount: one(accounts, { fields: [supplierPayments.cashAccountId], references: [accounts.id] }),
}));

export const purchaseReturnsRelations = relations(purchaseReturns, ({ one, many }) => ({
  invoice: one(purchaseInvoices, { fields: [purchaseReturns.purchaseInvoiceId], references: [purchaseInvoices.id] }),
  supplier: one(suppliers, { fields: [purchaseReturns.supplierId], references: [suppliers.id] }),
  lines: many(purchaseReturnLines),
}));

export const purchaseReturnLinesRelations = relations(purchaseReturnLines, ({ one }) => ({
  ret: one(purchaseReturns, { fields: [purchaseReturnLines.returnId], references: [purchaseReturns.id] }),
  product: one(products, { fields: [purchaseReturnLines.productId], references: [products.id] }),
}));
