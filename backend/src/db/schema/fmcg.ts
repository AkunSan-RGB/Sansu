// Skema database — fmcg
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, money, qty } from './columns';
import { tenantId, users } from './tenancy';
import { customers, products, suppliers, warehouses } from './master-data';
import { invoices } from './sales';

/** Target omzet bulanan per sales dan aturan komisinya (komisi dihitung dari omzet neto setelah retur, tanpa PPN) */
export const salesTargets = pgTable(
  'sales_targets',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** YYYY-MM */
    period: text('period').notNull(),
    targetAmount: money('target_amount').notNull(),
    commissionPct: numeric('commission_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    /** Komisi hanya berlaku bila pencapaian ≥ persen ini dari target (0 = selalu) */
    minAchievementPct: numeric('min_achievement_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sales_targets_uq').on(t.tenantId, t.userId, t.period)],
);

/** Komisi sales yang sudah ditutup per bulan: angka dibekukan saat ditutup (tidak bisa diubah), dijurnal sebagai utang komisi lalu dibayar */
export const salesCommissions = pgTable(
  'sales_commissions',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    period: text('period').notNull(),
    netSales: money('net_sales').notNull(),
    targetAmount: money('target_amount').notNull(),
    commissionPct: numeric('commission_pct', { precision: 5, scale: 2 }).notNull(),
    amount: money('amount').notNull(),
    /** ACCRUED = sudah dijurnal sebagai utang komisi; PAID = sudah dibayar; VOID = dibatalkan sebelum dibayar */
    status: text('status').$type<'ACCRUED' | 'PAID' | 'VOID'>().notNull().default('ACCRUED'),
    accrualJournalId: uuid('accrual_journal_id'),
    paymentJournalId: uuid('payment_journal_id'),
    pph21Withheld: money('pph21_withheld').notNull().default('0'),
    cashAccountId: uuid('cash_account_id'),
    accruedById: uuid('accrued_by_id'),
    paidById: uuid('paid_by_id'),
    paidAt: date('paid_at'),
    voidReason: text('void_reason'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sales_commissions_uq').on(t.tenantId, t.userId, t.period).where(sql`status <> 'VOID'`), uniqueIndex('sales_commissions_number_uq').on(t.tenantId, t.number)],
);

/** Tukar-guling: barang rusak/kedaluwarsa/ditarik dari outlet ditukar barang yang sama dengan jumlah yang sama; baru berlaku setelah disetujui */
export const goodsSwaps = pgTable(
  'goods_swaps',
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
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    reason: text('reason').$type<'EXPIRED' | 'DAMAGED' | 'RECALL'>().notNull(),
    notes: text('notes'),
    status: text('status').$type<'PENDING' | 'APPROVED' | 'REJECTED'>().notNull().default('PENDING'),
    createdById: uuid('created_by_id'),
    decidedById: uuid('decided_by_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    rejectReason: text('reject_reason'),
    journalId: uuid('journal_id'),
    costAmount: money('cost_amount').notNull().default('0'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('goods_swaps_number_uq').on(t.tenantId, t.number), index('goods_swaps_invoice_idx').on(t.invoiceId)],
);

export const goodsSwapLines = pgTable('goods_swap_lines', {
  id: id(),
  swapId: uuid('swap_id')
    .notNull()
    .references(() => goodsSwaps.id, { onDelete: 'cascade' }),
  invoiceLineId: uuid('invoice_line_id').notNull(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  uom: text('uom').notNull(),
  uomFactor: qty('uom_factor').notNull(),
  /** Jumlah barang yang ditarik = jumlah penggantinya (satuan baris faktur) */
  qty: qty('qty').notNull(),
  lotNo: text('lot_no'),
});

/** Dokumen konsinyasi: kirim titipan ke outlet, laporan penjualan outlet (ditagih setelah diperiksa), tarik sisa */
export const consignmentDocs = pgTable(
  'consignment_docs',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    kind: text('kind').$type<'SHIP' | 'REPORT' | 'RETURN'>().notNull(),
    date: date('date').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    /** Gudang konsinyasi outlet */
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    /** REPORT: nomor laporan penjualan dari outlet (unik per outlet agar tidak ditagih dua kali) */
    reference: text('reference'),
    /** REPORT: REPORTED → INVOICED / REJECTED; SHIP & RETURN langsung DONE */
    status: text('status').$type<'DONE' | 'REPORTED' | 'INVOICED' | 'REJECTED'>().notNull().default('DONE'),
    lines: jsonb('lines').$type<{ productId: string; uom: string; qty: string }[]>().notNull(),
    transferId: uuid('transfer_id'),
    salesOrderId: uuid('sales_order_id'),
    invoiceId: uuid('invoice_id'),
    notes: text('notes'),
    rejectReason: text('reject_reason'),
    createdById: uuid('created_by_id'),
    decidedById: uuid('decided_by_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('consignment_docs_number_uq').on(t.tenantId, t.number),
    uniqueIndex('consignment_docs_ref_uq').on(t.tenantId, t.customerId, t.reference).where(sql`kind = 'REPORT' AND status <> 'REJECTED'`),
  ],
);

/** Rute kunjungan sales lapangan: urutan outlet yang dikunjungi pada hari tertentu */
export const salesRoutes = pgTable(
  'sales_routes',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    salespersonId: uuid('salesperson_id')
      .notNull()
      .references(() => users.id),
    /** 1 = Senin … 7 = Minggu; kosong = tidak terjadwal pada hari tertentu */
    weekday: integer('weekday'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sales_routes_name_uq').on(t.tenantId, sql`lower(${t.name})`)],
);

export const salesRouteStops = pgTable(
  'sales_route_stops',
  {
    id: id(),
    tenantId: tenantId(),
    routeId: uuid('route_id')
      .notNull()
      .references(() => salesRoutes.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    seq: integer('seq').notNull(),
  },
  (t) => [uniqueIndex('sales_route_stops_uq').on(t.routeId, t.customerId)],
);

/** Kunjungan sales ke outlet (satu per sales-outlet-hari), dengan koordinat saat check-in */
export const salesVisits = pgTable(
  'sales_visits',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    routeId: uuid('route_id'),
    date: date('date').notNull(),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }).notNull().defaultNow(),
    lat: numeric('lat', { precision: 9, scale: 6 }),
    lng: numeric('lng', { precision: 9, scale: 6 }),
    /** Jarak (meter) dari koordinat outlet tersimpan; kosong bila koordinat tidak ada */
    distanceM: integer('distance_m'),
    result: text('result').$type<'ORDER' | 'NO_ORDER' | 'CLOSED'>().notNull(),
    note: text('note'),
    salesOrderId: uuid('sales_order_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sales_visits_uq').on(t.userId, t.customerId, t.date)],
);

/** Uang tagihan yang diterima sales di lapangan: baru menjadi pelunasan setelah Keuangan menerima uangnya (selisih tercatat) */
export const canvassCollections = pgTable(
  'canvass_collections',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    date: date('date').notNull(),
    method: text('method').notNull().default('CASH'),
    amount: money('amount').notNull(),
    status: text('status').$type<'PENDING' | 'VERIFIED' | 'REJECTED'>().notNull().default('PENDING'),
    receivedAmount: money('received_amount'),
    shortage: money('shortage').notNull().default('0'),
    paymentId: uuid('payment_id'),
    verifiedById: uuid('verified_by_id'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    rejectReason: text('reject_reason'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('canvass_collections_number_uq').on(t.tenantId, t.number), index('canvass_collections_invoice_idx').on(t.invoiceId)],
);

/** Syarat dagang dengan peritel modern: rebate/back margin (% penjualan neto) atau biaya tetap bulanan (listing/merchandising) */
export const tradeTerms = pgTable('trade_terms', {
  id: id(),
  tenantId: tenantId(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id),
  name: text('name').notNull(),
  kind: text('kind').$type<'PCT_SALES' | 'FIXED_MONTHLY'>().notNull(),
  /** PCT_SALES: persen (0–100); FIXED_MONTHLY: rupiah per bulan */
  value: numeric('value', { precision: 18, scale: 4 }).notNull(),
  validFrom: date('valid_from'),
  validTo: date('valid_to'),
  isActive: boolean('is_active').notNull().default(true),
  createdById: uuid('created_by_id'),
  createdAt: createdAt(),
});

export const tradeAccruals = pgTable(
  'trade_accruals',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    termId: uuid('term_id')
      .notNull()
      .references(() => tradeTerms.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    period: text('period').notNull(),
    baseAmount: money('base_amount').notNull(),
    amount: money('amount').notNull(),
    settledAmount: money('settled_amount').notNull().default('0'),
    status: text('status').$type<'ACCRUED' | 'SETTLED' | 'VOID'>().notNull().default('ACCRUED'),
    accrualJournalId: uuid('accrual_journal_id'),
    accruedById: uuid('accrued_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('trade_accruals_uq').on(t.termId, t.period).where(sql`status <> 'VOID'`), uniqueIndex('trade_accruals_number_uq').on(t.tenantId, t.number)],
);

/** Klaim biaya promo ke prinsipal: dikumpulkan dari baris pesanan berpromo yang didanai prinsipal; tiap baris hanya bisa diklaim sekali */
export const principalClaims = pgTable(
  'principal_claims',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    period: text('period').notNull(),
    claimedAmount: money('claimed_amount').notNull(),
    approvedAmount: money('approved_amount').notNull().default('0'),
    status: text('status').$type<'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PAID' | 'REJECTED'>().notNull().default('DRAFT'),
    principalRef: text('principal_ref'),
    approvalJournalId: uuid('approval_journal_id'),
    paymentJournalId: uuid('payment_journal_id'),
    cashAccountId: uuid('cash_account_id'),
    createdById: uuid('created_by_id'),
    decidedById: uuid('decided_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('principal_claims_number_uq').on(t.tenantId, t.number)],
);

export const principalClaimLines = pgTable(
  'principal_claim_lines',
  {
    id: id(),
    tenantId: tenantId(),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => principalClaims.id, { onDelete: 'cascade' }),
    orderLineId: uuid('order_line_id').notNull(),
    promoId: uuid('promo_id'),
    kind: text('kind').$type<'DISCOUNT' | 'BONUS'>().notNull(),
    invoiceNumber: text('invoice_number'),
    description: text('description').notNull(),
    baseValue: money('base_value').notNull(),
    fundedPct: numeric('funded_pct', { precision: 5, scale: 2 }).notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [uniqueIndex('principal_claim_lines_uq').on(t.orderLineId)],
);

/** Riwayat pelunasan utang rebate/trade promo outlet per tanggal: dasar menghitung sisa utang rebate per tanggal tertentu */
export const tradeAccrualSettlements = pgTable(
  'trade_accrual_settlements',
  {
    id: id(),
    tenantId: tenantId(),
    accrualId: uuid('accrual_id')
      .notNull()
      .references(() => tradeAccruals.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    amount: money('amount').notNull(),
    mode: text('mode').$type<'DEDUCT' | 'PAY'>().notNull(),
    journalId: uuid('journal_id'),
    createdAt: createdAt(),
  },
  (t) => [index('trade_accrual_settlements_accrual_idx').on(t.accrualId, t.date)],
);
