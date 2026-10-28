// Skema database — sales
import { relations, sql } from 'drizzle-orm';
import { boolean, date, index, numeric, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, money, qty } from './columns';
import { tenantId } from './tenancy';
import { customers, products, warehouses } from './master-data';
import { invoiceStatusEnum, quotationStatusEnum, salesOrderStatusEnum } from './enums';
import { leads } from './crm';
import { projects, serviceInvoiceLines } from './services';

export const salesOrders = pgTable(
  'sales_orders',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    status: salesOrderStatusEnum('status').notNull().default('DRAFT'),
    subtotal: money('subtotal').notNull().default('0'),
    taxAmount: money('tax_amount').notNull().default('0'),
    total: money('total').notNull().default('0'),
    /** Harga diinput sudah termasuk PPN; baris disimpan sebagai DPP */
    pricesIncludeVat: boolean('prices_include_vat').notNull().default(false),
    /** Mata uang dokumen (ISO); IDR = Rupiah. Kolom rupiah lain selalu dalam Rupiah (kurs saat transaksi) */
    currency: text('currency').notNull().default('IDR'),
    fxRate: numeric('fx_rate', { precision: 18, scale: 6 }).notNull().default('1'),
    totalForeign: money('total_foreign'),
    notes: text('notes'),
    /** Sales yang memegang pesanan ini (dasar target & komisi); kosong = tidak dikaitkan ke sales */
    salespersonId: uuid('salesperson_id'),
    /** Nomor PO dari outlet (peritel modern); satu nomor tidak boleh ditagih dua kali */
    customerPoNo: text('customer_po_no'),
    cancelReason: text('cancel_reason'),
    cancelledById: uuid('cancelled_by_id'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sales_orders_number_uq').on(t.tenantId, t.number),
    index('sales_orders_date_idx').on(t.tenantId, t.date),
    index('sales_orders_salesperson_idx').on(t.salespersonId),
    uniqueIndex('sales_orders_customer_po_uq').on(t.tenantId, t.customerId, t.customerPoNo).where(sql`customer_po_no IS NOT NULL AND status <> 'CANCELLED'`),
  ],
);

export const salesOrderLines = pgTable('sales_order_lines', {
  id: id(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => salesOrders.id, { onDelete: 'cascade' }),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  uom: text('uom').notNull(),
  uomFactor: qty('uom_factor').notNull(),
  /** Dalam satuan `uom` */
  qty: qty('qty').notNull(),
  /** Harga per `uom` */
  price: money('price').notNull(),
  discountPct: numeric('discount_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  lineTotal: money('line_total').notNull(),
  /** Harga per `uom` termasuk PPN seperti diinput (dokumen harga termasuk PPN) */
  priceInclVat: money('price_incl_vat'),
  /** Harga per `uom` dalam mata uang dokumen (dokumen valas); `price` tetap Rupiah */
  priceForeign: numeric('price_foreign', { precision: 18, scale: 4 }),
  /** Promo yang menghasilkan potongan/bonus pada baris ini (dasar klaim ke prinsipal) */
  promoId: uuid('promo_id'),
  isBonus: boolean('is_bonus').notNull().default(false),
  /** Prinsipal penanggung & persennya saat pesanan dibuat (snapshot: mengubah promo kemudian tidak mengubah klaim pesanan lama) */
  promoFundedSupplierId: uuid('promo_funded_supplier_id'),
  promoFundedPct: numeric('promo_funded_pct', { precision: 5, scale: 2 }).notNull().default('0'),
});

/** Surat jalan: pengiriman barang atas pesanan penjualan. Stok keluar dan HPP dicatat saat surat jalan (atau saat faktur bila langsung difakturkan). */
export const deliveryOrders = pgTable(
  'delivery_orders',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    salesOrderId: uuid('sales_order_id')
      .notNull()
      .references(() => salesOrders.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    status: text('status').$type<'DELIVERED' | 'CANCELLED'>().notNull().default('DELIVERED'),
    cogsAmount: money('cogs_amount').notNull().default('0'),
    /** Jurnal HPP saat kirim; kosong bila langsung difakturkan (jurnal ada di faktur) */
    journalId: uuid('journal_id'),
    invoiceId: uuid('invoice_id'),
    notes: text('notes'),
    cancelReason: text('cancel_reason'),
    cancelledById: uuid('cancelled_by_id'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('delivery_orders_number_uq').on(t.tenantId, t.number),
    index('delivery_orders_order_idx').on(t.salesOrderId),
    index('delivery_orders_date_idx').on(t.tenantId, t.date),
  ],
);

export const deliveryOrderLines = pgTable('delivery_order_lines', {
  id: id(),
  deliveryId: uuid('delivery_id')
    .notNull()
    .references(() => deliveryOrders.id, { onDelete: 'cascade' }),
  orderLineId: uuid('order_line_id').notNull(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  uom: text('uom').notNull(),
  uomFactor: qty('uom_factor').notNull(),
  qty: qty('qty').notNull(),
  /** Harga pokok per satuan dasar saat dikirim */
  unitCost: numeric('unit_cost', { precision: 18, scale: 4 }).notNull(),
});

export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    dueDate: date('due_date').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    salesOrderId: uuid('sales_order_id').references(() => salesOrders.id),
    /** Surat jalan asal faktur (rantai pesanan → surat jalan → faktur) */
    deliveryOrderId: uuid('delivery_order_id'),
    /** Faktur saldo awal (piutang dari sistem lama) — bukan penjualan periode berjalan, tanpa PPN */
    isOpening: boolean('is_opening').notNull().default(false),
    subtotal: money('subtotal').notNull(),
    taxAmount: money('tax_amount').notNull(),
    total: money('total').notNull(),
    cogsAmount: money('cogs_amount').notNull().default('0'),
    paidAmount: money('paid_amount').notNull().default('0'),
    /** Nilai retur penjualan (mengurangi piutang) */
    returnedAmount: money('returned_amount').notNull().default('0'),
    status: invoiceStatusEnum('status').notNull().default('UNPAID'),
    /** GOODS = dari sales order · SERVICE = faktur jasa (baris di service_invoice_lines) */
    kind: text('kind').$type<'GOODS' | 'SERVICE'>().notNull().default('GOODS'),
    description: text('description'),
    projectId: uuid('project_id'),
    /** Mis. "Termin 2 (40%)" */
    termLabel: text('term_label'),
    /** Tagihan retensi: menunjuk tagihan termin induknya; jatuh tempo setelah masa pemeliharaan */
    retentionOfInvoiceId: uuid('retention_of_invoice_id'),
    /** PPh dipotong pelanggan (PPH23 = kredit pajak, PPH4_2 = final). Ikut dihitung di paidAmount. */
    withholdingType: text('withholding_type').$type<'PPH23' | 'PPH4_2'>(),
    withholdingRate: numeric('withholding_rate', { precision: 5, scale: 2 }),
    withholdingBase: money('withholding_base').notNull().default('0'),
    withholdingAmount: money('withholding_amount').notNull().default('0'),
    withholdingSlipNo: text('withholding_slip_no'),
    withholdingSlipDate: date('withholding_slip_date'),
    /** Uang muka pelanggan yang dipakai melunasi faktur ini (ikut dihitung di paidAmount) */
    depositApplied: money('deposit_applied').notNull().default('0'),
    currency: text('currency').notNull().default('IDR'),
    fxRate: numeric('fx_rate', { precision: 18, scale: 6 }).notNull().default('1'),
    totalForeign: money('total_foreign'),
    /** Pelunasan dalam mata uang dokumen */
    paidForeign: money('paid_foreign').notNull().default('0'),
    /** Nilai retur dalam mata uang dokumen */
    returnedForeign: money('returned_foreign').notNull().default('0'),
    journalId: uuid('journal_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invoices_number_uq').on(t.tenantId, t.number),
    uniqueIndex('invoices_sales_order_uq').on(t.salesOrderId),
    index('invoices_customer_idx').on(t.tenantId, t.customerId, t.status),
  ],
);

export const invoiceLines = pgTable('invoice_lines', {
  id: id(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  uom: text('uom').notNull(),
  uomFactor: qty('uom_factor').notNull(),
  qty: qty('qty').notNull(),
  price: money('price').notNull(),
  discountPct: numeric('discount_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  lineTotal: money('line_total').notNull(),
  /** HPP per satuan dasar saat faktur dibuat */
  unitCost: qty('unit_cost').notNull(),
  /** Kuantitas yang sudah diretur (satuan `uom`) */
  returnedQty: qty('returned_qty').notNull().default('0'),
  /** Faktur valas: harga per `uom` dalam mata uang faktur */
  priceForeign: numeric('price_foreign', { precision: 18, scale: 4 }),
});

export const payments = pgTable(
  'payments',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    amount: money('amount').notNull(),
    /** CASH | TRANSFER | GIRO */
    method: text('method').notNull().default('CASH'),
    /** Akun kas/bank penerima */
    cashAccountId: uuid('cash_account_id'),
    notes: text('notes'),
    journalId: uuid('journal_id'),
    /** Pelunasan faktur valas: `amount` = nilai piutang yang dilunasi (Rupiah, kurs faktur); `cashAmount` = kas diterima (kurs bayar) */
    currency: text('currency').notNull().default('IDR'),
    amountForeign: money('amount_foreign'),
    fxRate: numeric('fx_rate', { precision: 18, scale: 6 }),
    cashAmount: money('cash_amount'),
    /** Laba (+) / rugi (−) selisih kurs terealisasi */
    fxGainLoss: money('fx_gain_loss').notNull().default('0'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('payments_number_uq').on(t.tenantId, t.number)],
);

// ---------- Retur ----------
export const salesReturns = pgTable(
  'sales_returns',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    reason: text('reason'),
    subtotal: money('subtotal').notNull(),
    taxAmount: money('tax_amount').notNull(),
    total: money('total').notNull(),
    costAmount: money('cost_amount').notNull(),
    journalId: uuid('journal_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sales_returns_number_uq').on(t.tenantId, t.number)],
);

export const salesReturnLines = pgTable('sales_return_lines', {
  id: id(),
  returnId: uuid('return_id')
    .notNull()
    .references(() => salesReturns.id, { onDelete: 'cascade' }),
  invoiceLineId: uuid('invoice_line_id')
    .notNull()
    .references(() => invoiceLines.id),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  uom: text('uom').notNull(),
  qty: qty('qty').notNull(),
  lineTotal: money('line_total').notNull(),
});

export const quotations = pgTable(
  'quotations',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    validUntil: date('valid_until').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    leadId: uuid('lead_id').references(() => leads.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    status: quotationStatusEnum('status').notNull().default('DRAFT'),
    subtotal: money('subtotal').notNull().default('0'),
    taxAmount: money('tax_amount').notNull().default('0'),
    total: money('total').notNull().default('0'),
    pricesIncludeVat: boolean('prices_include_vat').notNull().default(false),
    notes: text('notes'),
    terms: text('terms'),
    salesOrderId: uuid('sales_order_id').references(() => salesOrders.id),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('quotations_number_uq').on(t.tenantId, t.number)],
);

export const quotationLines = pgTable('quotation_lines', {
  id: id(),
  quotationId: uuid('quotation_id')
    .notNull()
    .references(() => quotations.id, { onDelete: 'cascade' }),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  uom: text('uom').notNull(),
  uomFactor: qty('uom_factor').notNull(),
  qty: qty('qty').notNull(),
  price: money('price').notNull(),
  discountPct: numeric('discount_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  lineTotal: money('line_total').notNull(),
  priceInclVat: money('price_incl_vat'),
});

export const salesOrdersRelations = relations(salesOrders, ({ one, many }) => ({
  customer: one(customers, { fields: [salesOrders.customerId], references: [customers.id] }),
  warehouse: one(warehouses, { fields: [salesOrders.warehouseId], references: [warehouses.id] }),
  lines: many(salesOrderLines),
  invoice: one(invoices, { fields: [salesOrders.id], references: [invoices.salesOrderId] }),
}));

export const salesOrderLinesRelations = relations(salesOrderLines, ({ one }) => ({
  order: one(salesOrders, { fields: [salesOrderLines.orderId], references: [salesOrders.id] }),
  product: one(products, { fields: [salesOrderLines.productId], references: [products.id] }),
}));

export const deliveryOrdersRelations = relations(deliveryOrders, ({ one, many }) => ({
  customer: one(customers, { fields: [deliveryOrders.customerId], references: [customers.id] }),
  warehouse: one(warehouses, { fields: [deliveryOrders.warehouseId], references: [warehouses.id] }),
  salesOrder: one(salesOrders, { fields: [deliveryOrders.salesOrderId], references: [salesOrders.id] }),
  invoice: one(invoices, { fields: [deliveryOrders.invoiceId], references: [invoices.id] }),
  lines: many(deliveryOrderLines),
}));

export const deliveryOrderLinesRelations = relations(deliveryOrderLines, ({ one }) => ({
  delivery: one(deliveryOrders, { fields: [deliveryOrderLines.deliveryId], references: [deliveryOrders.id] }),
  product: one(products, { fields: [deliveryOrderLines.productId], references: [products.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  customer: one(customers, { fields: [invoices.customerId], references: [customers.id] }),
  salesOrder: one(salesOrders, { fields: [invoices.salesOrderId], references: [salesOrders.id] }),
  lines: many(invoiceLines),
  serviceLines: many(serviceInvoiceLines),
  payments: many(payments),
  project: one(projects, { fields: [invoices.projectId], references: [projects.id] }),
}));

export const invoiceLinesRelations = relations(invoiceLines, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceLines.invoiceId], references: [invoices.id] }),
  product: one(products, { fields: [invoiceLines.productId], references: [products.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  customer: one(customers, { fields: [payments.customerId], references: [customers.id] }),
  invoice: one(invoices, { fields: [payments.invoiceId], references: [invoices.id] }),
}));

export const salesReturnsRelations = relations(salesReturns, ({ one, many }) => ({
  invoice: one(invoices, { fields: [salesReturns.invoiceId], references: [invoices.id] }),
  customer: one(customers, { fields: [salesReturns.customerId], references: [customers.id] }),
  lines: many(salesReturnLines),
}));

export const salesReturnLinesRelations = relations(salesReturnLines, ({ one }) => ({
  ret: one(salesReturns, { fields: [salesReturnLines.returnId], references: [salesReturns.id] }),
  product: one(products, { fields: [salesReturnLines.productId], references: [products.id] }),
}));

export const quotationsRelations = relations(quotations, ({ one, many }) => ({
  customer: one(customers, { fields: [quotations.customerId], references: [customers.id] }),
  lead: one(leads, { fields: [quotations.leadId], references: [leads.id] }),
  warehouse: one(warehouses, { fields: [quotations.warehouseId], references: [warehouses.id] }),
  salesOrder: one(salesOrders, { fields: [quotations.salesOrderId], references: [salesOrders.id] }),
  lines: many(quotationLines),
}));

export const quotationLinesRelations = relations(quotationLines, ({ one }) => ({
  quotation: one(quotations, { fields: [quotationLines.quotationId], references: [quotations.id] }),
  product: one(products, { fields: [quotationLines.productId], references: [products.id] }),
}));
