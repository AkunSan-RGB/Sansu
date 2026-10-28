// Skema database — pos
import { relations, sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, money, qty } from './columns';
import { tenantId, users } from './tenancy';
import { customers, products, warehouses } from './master-data';
import { accounts, journalEntries } from './accounting';
import { PosTabLineStatus, PosTabStatus, posPaymentMethodEnum, posSessionStatusEnum } from './enums';
import { invoices } from './sales';
import { employees } from './hr';

export const posSessions = pgTable(
  'pos_sessions',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    /** Laci kas (akun kas) */
    cashAccountId: uuid('cash_account_id')
      .notNull()
      .references(() => accounts.id),
    /** Rekening untuk QRIS / debit / transfer */
    bankAccountId: uuid('bank_account_id')
      .notNull()
      .references(() => accounts.id),
    status: posSessionStatusEnum('status').notNull().default('OPEN'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    openingCash: money('opening_cash').notNull().default('0'),
    expectedCash: money('expected_cash'),
    countedCash: money('counted_cash'),
    difference: money('difference'),
    notes: text('notes'),
    closeJournalId: uuid('close_journal_id'),
  },
  (t) => [
    uniqueIndex('pos_sessions_number_uq').on(t.tenantId, t.number),
    // satu kasir hanya boleh punya satu sesi terbuka
    uniqueIndex('pos_sessions_open_uq').on(t.userId).where(sql`status = 'OPEN'`),
  ],
);

export const posOrders = pgTable(
  'pos_orders',
  {
    id: id(),
    tenantId: tenantId(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => posSessions.id),
    number: text('number').notNull(),
    date: date('date').notNull(),
    customerId: uuid('customer_id').references(() => customers.id),
    subtotal: money('subtotal').notNull(),
    taxAmount: money('tax_amount').notNull(),
    total: money('total').notNull(),
    /** Uang diterima (semua metode) dan kembalian tunai */
    tendered: money('tendered').notNull(),
    change: money('change').notNull().default('0'),
    cogsAmount: money('cogs_amount').notNull().default('0'),
    /** Harga kasir sudah termasuk PPN: lineTotal baris = harga bruto, subtotal = DPP */
    pricesIncludeVat: boolean('prices_include_vat').notNull().default(false),
    /** Jenis pesanan (makan di tempat, bawa pulang, antar) dan label meja/nama pemesan; opsional, untuk usaha makanan & minuman */
    orderType: text('order_type').$type<'DINE_IN' | 'TAKEAWAY' | 'DELIVERY'>(),
    /** Pajak pada transaksi: VAT = PPN keluaran, LOCAL = pajak restoran daerah (PB1/PBJT) */
    taxKind: text('tax_kind').$type<'VAT' | 'LOCAL'>().notNull().default('VAT'),
    /** Pesanan terbuka (meja) yang dibayar lewat transaksi ini */
    tabId: uuid('tab_id'),
    /** Pesanan online: kanal (GOFOOD…), nomor pesanan di platform, komisi platform yang dicatat, dan pencairan yang melunasinya */
    channel: text('channel'),
    externalRef: text('external_ref'),
    platformFee: money('platform_fee').notNull().default('0'),
    settlementId: uuid('settlement_id'),
    /** Program loyalitas: poin yang diperoleh / dipakai pada transaksi ini */
    loyaltyEarnedPoints: integer('loyalty_earned_points').notNull().default(0),
    loyaltyRedeemedPoints: integer('loyalty_redeemed_points').notNull().default(0),
    loyaltyRedeemedValue: money('loyalty_redeemed_value').notNull().default('0'),
    tableLabel: text('table_label'),
    journalId: uuid('journal_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('pos_orders_number_uq').on(t.tenantId, t.number),
    index('pos_orders_session_idx').on(t.sessionId),
  ],
);

/** Meja kafe/restoran per outlet */
export const posTables = pgTable(
  'pos_tables',
  {
    id: id(),
    tenantId: tenantId(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    seats: integer('seats'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('pos_tables_code_uq').on(t.tenantId, t.warehouseId, t.code)],
);

/**
 * Pesanan terbuka (tab): menu dipesan dulu (dikirim ke dapur), dibayar belakangan lewat transaksi kasir. Stok dan jurnal baru
 * terjadi saat dibayar; satu meja hanya punya satu pesanan terbuka.
 */
export const posTabs = pgTable(
  'pos_tabs',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    tableId: uuid('table_id').references(() => posTables.id),
    tableLabel: text('table_label'),
    /** Pesanan online: kanal dan nomor pesanan di platform (unik per kanal; dipakai agar kiriman ganda tidak membuat pesanan ganda) */
    channel: text('channel'),
    externalRef: text('external_ref'),
    orderType: text('order_type').$type<'DINE_IN' | 'TAKEAWAY' | 'DELIVERY'>().notNull().default('DINE_IN'),
    guestName: text('guest_name'),
    status: text('status').$type<PosTabStatus>().notNull().default('OPEN'),
    notes: text('notes'),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    cancelledById: uuid('cancelled_by_id'),
  },
  (t) => [
    uniqueIndex('pos_tabs_number_uq').on(t.tenantId, t.number),
    uniqueIndex('pos_tabs_open_table_uq').on(t.tableId).where(sql`status = 'OPEN' AND table_id IS NOT NULL`),
    uniqueIndex('pos_tabs_external_uq').on(t.tenantId, t.channel, t.externalRef).where(sql`external_ref IS NOT NULL`),
    index('pos_tabs_status_idx').on(t.tenantId, t.status),
  ],
);

export const posTabLines = pgTable(
  'pos_tab_lines',
  {
    id: id(),
    tabId: uuid('tab_id')
      .notNull()
      .references(() => posTabs.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    qty: qty('qty').notNull(),
    notes: text('notes'),
    /** DRAFT belum dikirim; NEW antre di dapur; PREPARING dimasak; READY siap diantar; SERVED sudah disajikan; VOID dibatalkan */
    status: text('status').$type<PosTabLineStatus>().notNull().default('DRAFT'),
    createdAt: createdAt(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    preparedAt: timestamp('prepared_at', { withTimezone: true }),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    servedAt: timestamp('served_at', { withTimezone: true }),
    voidReason: text('void_reason'),
    voidedById: uuid('voided_by_id'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    /** Status saat dibatalkan (pembatalan setelah dimasak/disajikan adalah titik rawan kecurangan) */
    voidFromStatus: text('void_from_status'),
    paidOrderId: uuid('paid_order_id').references(() => posOrders.id),
  },
  (t) => [index('pos_tab_lines_tab_idx').on(t.tabId), index('pos_tab_lines_kitchen_idx').on(t.status).where(sql`status IN ('NEW', 'PREPARING', 'READY')`)],
);

/** Pencairan dana dari platform pesan-antar atas sekumpulan pesanan online */
export const posPlatformSettlements = pgTable(
  'pos_platform_settlements',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    channel: text('channel').notNull(),
    date: date('date').notNull(),
    bankAccountId: uuid('bank_account_id')
      .notNull()
      .references(() => accounts.id),
    orderCount: integer('order_count').notNull(),
    /** Seharusnya diterima (total pesanan − komisi), dana yang benar-benar masuk, dan selisihnya */
    expected: money('expected').notNull(),
    received: money('received').notNull(),
    difference: money('difference').notNull(),
    notes: text('notes'),
    journalId: uuid('journal_id'),
    status: text('status').$type<'POSTED' | 'CANCELLED'>().notNull().default('POSTED'),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('pos_platform_settlements_number_uq').on(t.tenantId, t.number)],
);

/** Kunci API untuk menerima pesanan online dari luar (aplikasi pihak ketiga / integrator); hanya hash yang disimpan */
export const onlineApiKeys = pgTable(
  'online_api_keys',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('online_api_keys_hash_uq').on(t.keyHash)],
);

export const posOrderLines = pgTable('pos_order_lines', {
  id: id(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => posOrders.id, { onDelete: 'cascade' }),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  uom: text('uom').notNull(),
  uomFactor: qty('uom_factor').notNull(),
  qty: qty('qty').notNull(),
  price: money('price').notNull(),
  discountPct: numeric('discount_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  lineTotal: money('line_total').notNull(),
  unitCost: qty('unit_cost').notNull(),
  /** Baris menu: bahan dipotong sesuai resep saat dijual (retur tidak mengembalikan bahan yang sudah diolah) */
  fromRecipe: boolean('from_recipe').notNull().default(false),
  /** Bonus barang dari promo (harga 0, ditambahkan server) */
  isBonus: boolean('is_bonus').notNull().default(false),
  /** Petugas yang mengerjakan layanan ini (komisi/kinerja) */
  staffId: uuid('staff_id').references(() => employees.id),
  /** Sudah diretur (satuan sesuai baris) */
  returnedQty: qty('returned_qty').notNull().default('0'),
});

/** Retur / pembatalan penjualan kasir oleh supervisor */
export const posReturns = pgTable(
  'pos_returns',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => posOrders.id),
    /** Sesi kasir yang laci tunainya dipakai mengembalikan uang (hanya bila sesi asal masih terbuka) */
    sessionId: uuid('session_id'),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    refundMethod: text('refund_method').$type<'CASH' | 'BANK'>().notNull(),
    reason: text('reason').notNull(),
    subtotal: money('subtotal').notNull(),
    taxAmount: money('tax_amount').notNull(),
    total: money('total').notNull(),
    cogsAmount: money('cogs_amount').notNull(),
    /** Bagian retur yang dikembalikan sebagai poin loyalitas (bukan uang) */
    pointsRefund: money('points_refund').notNull().default('0'),
    journalId: uuid('journal_id'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('pos_returns_number_uq').on(t.tenantId, t.number), index('pos_returns_order_idx').on(t.orderId), index('pos_returns_session_idx').on(t.sessionId)],
);

export const posReturnLines = pgTable('pos_return_lines', {
  id: id(),
  returnId: uuid('return_id')
    .notNull()
    .references(() => posReturns.id, { onDelete: 'cascade' }),
  orderLineId: uuid('order_line_id')
    .notNull()
    .references(() => posOrderLines.id),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  qty: qty('qty').notNull(),
  unitCost: qty('unit_cost').notNull(),
});

export const posPayments = pgTable('pos_payments', {
  id: id(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => posOrders.id, { onDelete: 'cascade' }),
  method: posPaymentMethodEnum('method').notNull(),
  /** Jumlah bersih yang masuk (tunai sudah dikurangi kembalian) */
  amount: money('amount').notNull(),
});

export const posSessionsRelations = relations(posSessions, ({ one, many }) => ({
  user: one(users, { fields: [posSessions.userId], references: [users.id] }),
  warehouse: one(warehouses, { fields: [posSessions.warehouseId], references: [warehouses.id] }),
  cashAccount: one(accounts, { fields: [posSessions.cashAccountId], references: [accounts.id], relationName: 'posCash' }),
  bankAccount: one(accounts, { fields: [posSessions.bankAccountId], references: [accounts.id], relationName: 'posBank' }),
  orders: many(posOrders),
}));

export const posOrdersRelations = relations(posOrders, ({ one, many }) => ({
  session: one(posSessions, { fields: [posOrders.sessionId], references: [posSessions.id] }),
  customer: one(customers, { fields: [posOrders.customerId], references: [customers.id] }),
  lines: many(posOrderLines),
  payments: many(posPayments),
}));

export const posOrderLinesRelations = relations(posOrderLines, ({ one }) => ({
  order: one(posOrders, { fields: [posOrderLines.orderId], references: [posOrders.id] }),
  product: one(products, { fields: [posOrderLines.productId], references: [products.id] }),
}));

export const posTabsRelations = relations(posTabs, ({ one, many }) => ({
  lines: many(posTabLines),
  table: one(posTables, { fields: [posTabs.tableId], references: [posTables.id] }),
  warehouse: one(warehouses, { fields: [posTabs.warehouseId], references: [warehouses.id] }),
}));

export const posTabLinesRelations = relations(posTabLines, ({ one }) => ({
  tab: one(posTabs, { fields: [posTabLines.tabId], references: [posTabs.id] }),
  product: one(products, { fields: [posTabLines.productId], references: [products.id] }),
}));

export const posReturnsRelations = relations(posReturns, ({ one, many }) => ({
  order: one(posOrders, { fields: [posReturns.orderId], references: [posOrders.id] }),
  lines: many(posReturnLines),
}));

export const posReturnLinesRelations = relations(posReturnLines, ({ one }) => ({
  ret: one(posReturns, { fields: [posReturnLines.returnId], references: [posReturns.id] }),
  product: one(products, { fields: [posReturnLines.productId], references: [products.id] }),
}));

export const posPaymentsRelations = relations(posPayments, ({ one }) => ({
  order: one(posOrders, { fields: [posPayments.orderId], references: [posOrders.id] }),
}));

// ---------- Impor pesanan marketplace ----------
export const marketplaceOrders = pgTable(
  'marketplace_orders',
  {
    id: id(),
    tenantId: tenantId(),
    channel: text('channel').notNull(),
    orderNo: text('order_no').notNull(),
    date: date('date').notNull(),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    total: money('total').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('marketplace_orders_uq').on(t.tenantId, t.channel, t.orderNo)],
);

/** Toko marketplace yang tersambung untuk sinkron pesanan otomatis */
export const marketplaceConnections = pgTable(
  'marketplace_connections',
  {
    id: id(),
    tenantId: tenantId(),
    /** SHOPEE · TIKTOK · LAZADA · SIMULASI */
    provider: text('provider').notNull(),
    /** Nama saluran yang dipakai di faktur/laporan, mis. "Shopee" */
    channel: text('channel').notNull(),
    shopId: text('shop_id').notNull(),
    shopName: text('shop_name').notNull().default(''),
    /** Token akses (terenkripsi AES-256-GCM) */
    credentials: text('credentials'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    pricesIncludeVat: boolean('prices_include_vat').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    /** Batas waktu pesanan yang sudah diambil */
    syncedUntil: timestamp('synced_until', { withTimezone: true }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastResult: jsonb('last_result').$type<Record<string, unknown>>(),
    lastError: text('last_error'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('marketplace_conn_uq').on(t.tenantId, t.provider, t.shopId)],
);

/** Buku besar poin loyalitas: tiap perubahan poin satu baris; baris EARN/REFUND adalah "lot" dengan sisa dan tanggal kedaluwarsa (FIFO) */
export const loyaltyLedger = pgTable(
  'loyalty_ledger',
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    kind: text('kind').$type<'EARN' | 'REDEEM' | 'EXPIRE' | 'ADJUST' | 'REVERSE' | 'REFUND'>().notNull(),
    /** Perubahan poin (+ menambah, - mengurangi) */
    points: integer('points').notNull(),
    /** Perubahan nilai kewajiban (Rp) yang menyertai poin ini */
    value: money('value').notNull(),
    orderId: uuid('order_id').references(() => posOrders.id),
    expiresOn: date('expires_on'),
    remaining: integer('remaining'),
    note: text('note'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [index('loyalty_ledger_customer_idx').on(t.tenantId, t.customerId, t.createdAt)],
);

/** Rekonsiliasi pencairan QRIS/kartu debit dari penyelenggara: penjualan non-tunai (sudah masuk bank penuh) dicocokkan dengan uang bersih yang diterima */
export const posCardSettlements = pgTable(
  'pos_card_settlements',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    method: text('method').$type<'QRIS' | 'DEBIT'>().notNull(),
    bankAccountId: uuid('bank_account_id')
      .notNull()
      .references(() => accounts.id),
    gross: money('gross').notNull(),
    mdrPct: numeric('mdr_pct', { precision: 6, scale: 3 }).notNull(),
    mdrExpected: money('mdr_expected').notNull(),
    /** Retur non-tunai yang dipotongkan penyelenggara dari pencairan ini (tidak termasuk gross) */
    returnsTotal: money('returns_total').notNull().default('0'),
    received: money('received').notNull(),
    difference: money('difference').notNull(),
    itemCount: integer('item_count').notNull(),
    status: text('status').$type<'POSTED' | 'CANCELLED'>().notNull().default('POSTED'),
    note: text('note'),
    journalId: uuid('journal_id').references(() => journalEntries.id),
    reverseJournalId: uuid('reverse_journal_id').references(() => journalEntries.id),
    cancelReason: text('cancel_reason'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('pos_card_settlements_number_uq').on(t.tenantId, t.number)],
);

export const posCardSettlementItems = pgTable(
  'pos_card_settlement_items',
  {
    id: id(),
    tenantId: tenantId(),
    settlementId: uuid('settlement_id')
      .notNull()
      .references(() => posCardSettlements.id, { onDelete: 'cascade' }),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => posPayments.id, { onDelete: 'cascade' }),
    amount: money('amount').notNull(),
  },
  (t) => [uniqueIndex('pos_card_settlement_items_payment_uq').on(t.paymentId)],
);
