// =============================================================
//  SANSU — skema database (Drizzle ORM, PostgreSQL)
//  Prinsip:
//   * Setiap tabel bisnis punya tenant_id (multi-tenant, skema bersama)
//   * Uang NUMERIC(18,2), kuantitas & biaya satuan NUMERIC(18,4) — tidak pernah float
//   * Tanggal dokumen bertipe DATE (string 'YYYY-MM-DD')
//   * Jurnal yang sudah diposting tidak diubah; koreksi lewat jurnal balik
//  Ubah file ini lalu jalankan `npm run db:generate -w apps/api` untuk membuat migrasi.
// =============================================================
import { relations, sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  ACCOUNT_TYPES,
  ACTIVITY_TYPES,
  ATTENDANCE_STATUSES,
  CASH_TX_TYPES,
  INVOICE_STATUSES,
  LEAD_STATUSES,
  LEAVE_STATUSES,
  LEAVE_TYPES,
  PAYROLL_STATUSES,
  POS_PAYMENT_METHODS,
  POS_SESSION_STATUSES,
  QUOTATION_STATUSES,
  PURCHASE_ORDER_STATUSES,
  ROLES,
  SALES_ORDER_STATUSES,
  STOCK_MOVE_TYPES,
} from '@sansu/shared';

const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
const qty = (name: string) => numeric(name, { precision: 18, scale: 4 });
/** UUIDv7 (bawaan PostgreSQL 18): berurutan waktu → indeks B-tree lebih rapat & insert lebih cepat */
const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// ---------- Enum ----------
// Nilai enum berasal dari @sansu/shared agar backend & frontend selalu sama
export const roleEnum = pgEnum('role', ROLES);
export const accountTypeEnum = pgEnum('account_type', ACCOUNT_TYPES);
export const salesOrderStatusEnum = pgEnum('sales_order_status', SALES_ORDER_STATUSES);
export const invoiceStatusEnum = pgEnum('invoice_status', INVOICE_STATUSES);
export const stockMoveTypeEnum = pgEnum('stock_move_type', STOCK_MOVE_TYPES);
export const purchaseOrderStatusEnum = pgEnum('purchase_order_status', PURCHASE_ORDER_STATUSES);
export const cashTxTypeEnum = pgEnum('cash_tx_type', CASH_TX_TYPES);
export const posPaymentMethodEnum = pgEnum('pos_payment_method', POS_PAYMENT_METHODS);
export const posSessionStatusEnum = pgEnum('pos_session_status', POS_SESSION_STATUSES);
export const leadStatusEnum = pgEnum('lead_status', LEAD_STATUSES);
export const activityTypeEnum = pgEnum('activity_type', ACTIVITY_TYPES);
export const quotationStatusEnum = pgEnum('quotation_status', QUOTATION_STATUSES);
export const attendanceStatusEnum = pgEnum('attendance_status', ATTENDANCE_STATUSES);
export const leaveTypeEnum = pgEnum('leave_type', LEAVE_TYPES);
export const leaveStatusEnum = pgEnum('leave_status', LEAVE_STATUSES);
export const payrollStatusEnum = pgEnum('payroll_status', PAYROLL_STATUSES);

export type Role = (typeof roleEnum.enumValues)[number];
export type AccountType = (typeof accountTypeEnum.enumValues)[number];
export type SalesOrderStatus = (typeof salesOrderStatusEnum.enumValues)[number];
export type InvoiceStatus = (typeof invoiceStatusEnum.enumValues)[number];
export type StockMoveType = (typeof stockMoveTypeEnum.enumValues)[number];
export type PurchaseOrderStatus = (typeof purchaseOrderStatusEnum.enumValues)[number];
export type CashTxType = (typeof cashTxTypeEnum.enumValues)[number];

// ---------- Sistem ----------
export const tenants = pgTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  npwp: text('npwp'),
  address: text('address'),
  ppnRate: numeric('ppn_rate', { precision: 5, scale: 2 }).notNull().default('11'),
  /** Tutup buku: transaksi bertanggal <= tanggal ini ditolak */
  lockedUntil: date('locked_until'),
  /** Pengaturan lain (penggajian, POS, ...) — lihat TenantSettings */
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

/** Aplikasi yang diaktifkan per perusahaan */
export const tenantApps = pgTable(
  'tenant_apps',
  {
    tenantId: tenantId(),
    appKey: text('app_key').notNull(),
    enabledAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.appKey] })],
);

export const users = pgTable(
  'users',
  {
    id: id(),
    tenantId: tenantId(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: roleEnum('role').notNull().default('ADMIN'),
    isActive: boolean('is_active').notNull().default(true),
    /** Naik setiap kali sesi harus dicabut (ganti sandi, nonaktif, ganti peran, keluar dari semua perangkat) */
    tokenVersion: integer('token_version').notNull().default(0),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /** null = email belum diverifikasi */
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    /** Gudang yang boleh diakses; null/kosong = semua gudang */
    warehouseIds: uuid('warehouse_ids').array(),
    /** Verifikasi 2 langkah (TOTP): rahasia terenkripsi, aktif sejak, hash kode cadangan */
    totpSecret: text('totp_secret'),
    totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
    totpBackupCodes: jsonb('totp_backup_codes').$type<string[]>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email), index('users_tenant_idx').on(t.tenantId)],
);

/** Penomoran dokumen tanpa celah per tenant / jenis / periode (mis. INV/2026/10/0001) */
export const documentSequences = pgTable(
  'document_sequences',
  {
    tenantId: tenantId(),
    docType: text('doc_type').notNull(),
    period: text('period').notNull(),
    lastNumber: integer('last_number').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.docType, t.period] })],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: tenantId(),
    userId: uuid('user_id'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    data: jsonb('data'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_entity_idx').on(t.tenantId, t.entity, t.entityId)],
);

// ---------- Master data ----------
export const warehouses = pgTable(
  'warehouses',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('warehouses_code_uq').on(t.tenantId, t.code)],
);

export const products = pgTable(
  'products',
  {
    id: id(),
    tenantId: tenantId(),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    category: text('category'),
    baseUom: text('base_uom').notNull().default('PCS'),
    /** Harga jual per satuan dasar, belum PPN */
    sellPrice: money('sell_price').notNull().default('0'),
    /** Barcode / EAN untuk scan di kasir */
    barcode: text('barcode'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('products_sku_uq').on(t.tenantId, t.sku),
    index('products_name_idx').on(t.tenantId, t.name),
    uniqueIndex('products_barcode_uq').on(t.tenantId, t.barcode).where(sql`barcode IS NOT NULL`),
  ],
);

/** Satuan bertingkat: 1 DUS = 24 PCS */
export const productUoms = pgTable(
  'product_uoms',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    uom: text('uom').notNull(),
    /** Jumlah satuan dasar dalam 1 satuan ini */
    factor: qty('factor').notNull(),
  },
  (t) => [uniqueIndex('product_uoms_uq').on(t.productId, t.uom)],
);

export const customers = pgTable(
  'customers',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    /** Alamat email untuk pengingat tagihan otomatis */
    email: text('email'),
    address: text('address'),
    npwp: text('npwp'),
    /** 0 = tanpa batas */
    creditLimit: money('credit_limit').notNull().default('0'),
    paymentTermDays: integer('payment_term_days').notNull().default(30),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('customers_code_uq').on(t.tenantId, t.code)],
);

// ---------- Inventori ----------
export const stockBalances = pgTable(
  'stock_balances',
  {
    tenantId: tenantId(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    /** Satuan dasar */
    qty: qty('qty').notNull().default('0'),
    /** HPP rata-rata bergerak per satuan dasar */
    avgCost: qty('avg_cost').notNull().default('0'),
    /** Bagian penurunan nilai (NRV) per satuan yang masih melekat pada stok — batas pemulihan & dasar koreksi fiskal */
    writedownUnit: qty('writedown_unit').notNull().default('0'),
  },
  (t) => [primaryKey({ columns: [t.productId, t.warehouseId] }), index('stock_balances_tenant_idx').on(t.tenantId)],
);

/** Lapisan biaya persediaan untuk metode FIFO (MPKP): satu baris per penerimaan, dikonsumsi dari yang paling lama */
export const stockLayers = pgTable(
  'stock_layers',
  {
    id: id(),
    tenantId: tenantId(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    receivedDate: date('received_date').notNull(),
    /** Sisa kuantitas lapisan (satuan dasar) */
    qtyRemaining: qty('qty_remaining').notNull(),
    unitCost: qty('unit_cost').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('stock_layers_fifo_idx').on(t.productId, t.warehouseId, t.receivedDate, t.id)],
);

/** Kartu stok: setiap perubahan stok tercatat dan tidak pernah diedit */
export const stockMoves = pgTable(
  'stock_moves',
  {
    id: id(),
    tenantId: tenantId(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    type: stockMoveTypeEnum('type').notNull(),
    /** + masuk, - keluar (satuan dasar) */
    qty: qty('qty').notNull(),
    unitCost: qty('unit_cost').notNull(),
    balanceAfter: qty('balance_after').notNull(),
    /**
     * Nilai penurunan nilai persediaan yang ikut berpindah: + masuk / dibentuk, − keluar / dipulihkan.
     * Σ s.d. tanggal = beda temporer persediaan (komersial vs fiskal).
     */
    writedownValue: money('writedown_value').notNull().default('0'),
    refType: text('ref_type').notNull(),
    refId: text('ref_id').notNull(),
    refNumber: text('ref_number'),
    date: date('date').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('stock_moves_card_idx').on(t.tenantId, t.productId, t.warehouseId, t.createdAt),
    index('stock_moves_ref_idx').on(t.refType, t.refId),
  ],
);

// ---------- Penjualan ----------
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
    notes: text('notes'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sales_orders_number_uq').on(t.tenantId, t.number), index('sales_orders_date_idx').on(t.tenantId, t.date)],
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
});

/** Permintaan persetujuan atas transaksi bernilai besar (pesanan pembelian, jurnal manual) dari peran yang tidak berwenang */
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: id(),
    tenantId: tenantId(),
    kind: text('kind').$type<'PURCHASE_ORDER' | 'MANUAL_JOURNAL' | 'PURCHASE_INVOICE_PRICE'>().notNull(),
    /** Dokumen yang dimintakan persetujuan (PO); kosong untuk jurnal manual yang baru diposting setelah disetujui */
    refId: text('ref_id'),
    title: text('title').notNull(),
    amount: money('amount').notNull(),
    /** Isi permintaan yang dijalankan saat disetujui (jurnal manual) */
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    status: text('status').$type<'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'>().notNull().default('PENDING'),
    requestedById: uuid('requested_by_id').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedById: uuid('decided_by_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    /** Nomor dokumen hasil persetujuan (mis. nomor jurnal) */
    resultRef: text('result_ref'),
  },
  (t) => [
    index('approval_requests_status_idx').on(t.tenantId, t.status, t.requestedAt),
    uniqueIndex('approval_requests_pending_uq').on(t.tenantId, t.kind, t.refId).where(sql`status IN ('PENDING', 'APPROVED') AND ref_id IS NOT NULL`),
  ],
);

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
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('delivery_orders_number_uq').on(t.tenantId, t.number),
    uniqueIndex('delivery_orders_order_uq').on(t.salesOrderId).where(sql`status = 'DELIVERED'`),
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
    /** PPh dipotong pelanggan (PPH23 = kredit pajak, PPH4_2 = final). Ikut dihitung di paidAmount. */
    withholdingType: text('withholding_type').$type<'PPH23' | 'PPH4_2'>(),
    withholdingRate: numeric('withholding_rate', { precision: 5, scale: 2 }),
    withholdingBase: money('withholding_base').notNull().default('0'),
    withholdingAmount: money('withholding_amount').notNull().default('0'),
    withholdingSlipNo: text('withholding_slip_no'),
    withholdingSlipDate: date('withholding_slip_date'),
    /** Uang muka pelanggan yang dipakai melunasi faktur ini (ikut dihitung di paidAmount) */
    depositApplied: money('deposit_applied').notNull().default('0'),
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
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('payments_number_uq').on(t.tenantId, t.number)],
);

// ---------- Akuntansi ----------
export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: accountTypeEnum('type').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => accounts.id),
    isPostable: boolean('is_postable').notNull().default(true),
    /** Kunci akun sistem untuk jurnal otomatis (CASH, AR, INVENTORY, SALES, ...) */
    systemKey: text('system_key'),
    /** Akun kas / rekening bank (muncul di modul Kas & Bank) */
    isCashAccount: boolean('is_cash_account').notNull().default(false),
    /** Kelompok penyajian laporan keuangan SAK EP (lihat REPORT_GROUPS di @sansu/shared) */
    reportGroup: text('report_group'),
    /** Perlakuan fiskal untuk rekonsiliasi PPh Badan */
    fiscalTreatment: text('fiscal_treatment').notNull().default('NORMAL'),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('accounts_code_uq').on(t.tenantId, t.code), uniqueIndex('accounts_system_key_uq').on(t.tenantId, t.systemKey)],
);

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    description: text('description').notNull(),
    /** MANUAL | INVOICE | PAYMENT | STOCK_ADJUSTMENT | REVERSAL */
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id'),
    reversalOfId: uuid('reversal_of_id').references((): AnyPgColumn => journalEntries.id),
    /** Nomor bukti transaksi (kuitansi, nota, faktur pihak lain) */
    reference: text('reference'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('journal_entries_number_uq').on(t.tenantId, t.number),
    uniqueIndex('journal_entries_reversal_uq').on(t.reversalOfId),
    index('journal_entries_date_idx').on(t.tenantId, t.date),
    index('journal_entries_source_idx').on(t.sourceType, t.sourceId),
  ],
);

export const journalLines = pgTable(
  'journal_lines',
  {
    id: id(),
    journalId: uuid('journal_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    debit: money('debit').notNull().default('0'),
    credit: money('credit').notNull().default('0'),
    memo: text('memo'),
    /** Jurnal umum: biaya/pendapatan untuk proyek tertentu (usaha jasa) */
    projectId: uuid('project_id'),
  },
  (t) => [index('journal_lines_account_idx').on(t.accountId), index('journal_lines_journal_idx').on(t.journalId)],
);

// ---------- Pembelian & hutang ----------
export const suppliers = pgTable(
  'suppliers',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    address: text('address'),
    npwp: text('npwp'),
    paymentTermDays: integer('payment_term_days').notNull().default(30),
    isActive: boolean('is_active').notNull().default(true),
    /** Supplier favorit: PO / permintaan pembelian sampai batas ini disetujui otomatis (0 = tidak ada) */
    isPreferred: boolean('is_preferred').notNull().default(false),
    autoApproveLimit: money('auto_approve_limit').notNull().default('0'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('suppliers_code_uq').on(t.tenantId, t.code)],
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
    notes: text('notes'),
    createdById: uuid('created_by_id'),
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
  /** Jumlah yang sudah diterima gudang (satuan `uom` baris) — penerimaan barang bisa bertahap */
  receivedQty: qty('received_qty').notNull().default('0'),
  /** Jumlah yang sudah difakturkan dan nilai DPP-nya */
  billedQty: qty('billed_qty').notNull().default('0'),
  billedAmount: money('billed_amount').notNull().default('0'),
});

/** Permintaan pembelian internal (gudang / divisi) — disetujui lalu diubah menjadi pesanan pembelian per supplier */
export const PURCHASE_REQUEST_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED'] as const;
export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUSES)[number];

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
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('supplier_payments_number_uq').on(t.tenantId, t.number)],
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

// ---------- Kas & bank ----------
export const cashTransactions = pgTable(
  'cash_transactions',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    type: cashTxTypeEnum('type').notNull(),
    /** Akun kas/bank sumber (OUT, TRANSFER) atau tujuan (IN) */
    cashAccountId: uuid('cash_account_id')
      .notNull()
      .references(() => accounts.id),
    /** Hanya TRANSFER: rekening tujuan */
    toCashAccountId: uuid('to_cash_account_id').references(() => accounts.id),
    amount: money('amount').notNull(),
    description: text('description').notNull(),
    reference: text('reference'),
    journalId: uuid('journal_id'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('cash_transactions_number_uq').on(t.tenantId, t.number),
    index('cash_transactions_date_idx').on(t.tenantId, t.date),
  ],
);

/** Lawan akun kas masuk/keluar (mis. Beban Listrik, Modal) */
export const cashTransactionLines = pgTable('cash_transaction_lines', {
  id: id(),
  transactionId: uuid('transaction_id')
    .notNull()
    .references(() => cashTransactions.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  amount: money('amount').notNull(),
  memo: text('memo'),
  /** Biaya langsung proyek (usaha jasa) */
  projectId: uuid('project_id'),
});

// ---------- Relasi (untuk db.query.*.findMany({ with: ... })) ----------
// ---------- POS / kasir ----------
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
    journalId: uuid('journal_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('pos_orders_number_uq').on(t.tenantId, t.number),
    index('pos_orders_session_idx').on(t.sessionId),
  ],
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

// ---------- CRM ----------
export const crmStages = pgTable('crm_stages', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  sequence: integer('sequence').notNull(),
  /** Peluang default (%) saat prospek masuk tahap ini */
  probability: integer('probability').notNull().default(10),
});

export const leads = pgTable(
  'leads',
  {
    id: id(),
    tenantId: tenantId(),
    title: text('title').notNull(),
    customerId: uuid('customer_id').references(() => customers.id),
    contactName: text('contact_name'),
    companyName: text('company_name'),
    phone: text('phone'),
    email: text('email'),
    source: text('source'),
    expectedRevenue: money('expected_revenue').notNull().default('0'),
    probability: integer('probability').notNull().default(10),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => crmStages.id),
    ownerId: uuid('owner_id').references(() => users.id),
    status: leadStatusEnum('status').notNull().default('OPEN'),
    lostReason: text('lost_reason'),
    expectedCloseDate: date('expected_close_date'),
    notes: text('notes'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('leads_tenant_stage_idx').on(t.tenantId, t.status, t.stageId)],
);

export const crmActivities = pgTable(
  'crm_activities',
  {
    id: id(),
    tenantId: tenantId(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    type: activityTypeEnum('type').notNull(),
    summary: text('summary').notNull(),
    dueDate: date('due_date').notNull(),
    done: boolean('done').notNull().default(false),
    doneAt: timestamp('done_at', { withTimezone: true }),
    result: text('result'),
    userId: uuid('user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('crm_activities_due_idx').on(t.tenantId, t.done, t.dueDate)],
);

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

// ---------- SDM & penggajian ----------
export const employees = pgTable(
  'employees',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    nik: text('nik'),
    npwp: text('npwp'),
    ptkp: text('ptkp').notNull().default('TK/0'),
    jobTitle: text('job_title'),
    department: text('department'),
    joinDate: date('join_date').notNull(),
    birthDate: date('birth_date'),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    bankName: text('bank_name'),
    bankAccount: text('bank_account'),
    baseSalary: money('base_salary').notNull().default('0'),
    /** Tunjangan tetap bulanan (ikut dasar BPJS) */
    fixedAllowance: money('fixed_allowance').notNull().default('0'),
    /** Uang makan/transport per hari hadir */
    dailyAllowance: money('daily_allowance').notNull().default('0'),
    bpjsKes: boolean('bpjs_kes').notNull().default(true),
    bpjsTk: boolean('bpjs_tk').notNull().default(true),
    /** Jaminan Pensiun (umumnya diikuti karyawan < usia pensiun) */
    bpjsJp: boolean('bpjs_jp').notNull().default(true),
    annualLeave: integer('annual_leave').notNull().default(12),
    userId: uuid('user_id').references(() => users.id),
    /** Ditempatkan di proyek: gaji & iuran BPJS perusahaan menjadi biaya langsung proyek */
    projectId: uuid('project_id'),
    /** Tenaga kerja langsung produksi: gaji & iuran BPJS perusahaan dicatat ke Upah Langsung Produksi (bagian HPP) */
    isProduction: boolean('is_production').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    resignDate: date('resign_date'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('employees_code_uq').on(t.tenantId, t.code)],
);

export const attendances = pgTable(
  'attendances',
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    date: date('date').notNull(),
    status: attendanceStatusEnum('status').notNull(),
    checkIn: text('check_in'),
    checkOut: text('check_out'),
    overtimeHours: numeric('overtime_hours', { precision: 5, scale: 2 }).notNull().default('0'),
    notes: text('notes'),
  },
  (t) => [uniqueIndex('attendances_emp_date_uq').on(t.employeeId, t.date), index('attendances_tenant_date_idx').on(t.tenantId, t.date)],
);

export const leaveRequests = pgTable('leave_requests', {
  id: id(),
  tenantId: tenantId(),
  employeeId: uuid('employee_id')
    .notNull()
    .references(() => employees.id),
  type: leaveTypeEnum('type').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  days: integer('days').notNull(),
  reason: text('reason'),
  status: leaveStatusEnum('status').notNull().default('PENDING'),
  decidedById: uuid('decided_by_id'),
  createdAt: createdAt(),
});

export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    /** YYYY-MM */
    period: text('period').notNull(),
    payDate: date('pay_date').notNull(),
    status: payrollStatusEnum('status').notNull().default('DRAFT'),
    totalGross: money('total_gross').notNull().default('0'),
    totalEmployerCost: money('total_employer_cost').notNull().default('0'),
    totalPph21: money('total_pph21').notNull().default('0'),
    totalNet: money('total_net').notNull().default('0'),
    journalId: uuid('journal_id'),
    paymentJournalId: uuid('payment_journal_id'),
    cashAccountId: uuid('cash_account_id').references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('payroll_runs_period_uq').on(t.tenantId, t.period), uniqueIndex('payroll_runs_number_uq').on(t.tenantId, t.number)],
);

export const payslips = pgTable(
  'payslips',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => payrollRuns.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    workDays: integer('work_days').notNull(),
    presentDays: integer('present_days').notNull(),
    absentDays: integer('absent_days').notNull().default(0),
    overtimeHours: numeric('overtime_hours', { precision: 6, scale: 2 }).notNull().default('0'),
    baseSalary: money('base_salary').notNull(),
    fixedAllowance: money('fixed_allowance').notNull(),
    dailyAllowance: money('daily_allowance').notNull(),
    overtimePay: money('overtime_pay').notNull(),
    otherIncome: money('other_income').notNull().default('0'),
    absenceDeduction: money('absence_deduction').notNull().default('0'),
    /** Penghasilan tunai sebelum potongan */
    grossPay: money('gross_pay').notNull(),
    bpjsKesEmployee: money('bpjs_kes_employee').notNull(),
    jhtEmployee: money('jht_employee').notNull(),
    jpEmployee: money('jp_employee').notNull(),
    bpjsKesCompany: money('bpjs_kes_company').notNull(),
    jhtCompany: money('jht_company').notNull(),
    jpCompany: money('jp_company').notNull(),
    jkkCompany: money('jkk_company').notNull(),
    jkmCompany: money('jkm_company').notNull(),
    /** Penghasilan bruto untuk PPh 21 (termasuk premi JKK, JKM, BPJS Kes dari perusahaan) */
    taxableGross: money('taxable_gross').notNull(),
    terCategory: text('ter_category').notNull(),
    terRate: numeric('ter_rate', { precision: 5, scale: 2 }).notNull(),
    pph21: money('pph21').notNull(),
    otherDeduction: money('other_deduction').notNull().default('0'),
    netPay: money('net_pay').notNull(),
    notes: text('notes'),
    /** Proyek tempat karyawan bekerja pada periode ini (salinan saat gaji dihitung) */
    projectId: uuid('project_id'),
  },
  (t) => [uniqueIndex('payslips_run_emp_uq').on(t.runId, t.employeeId)],
);

// ---------- Aset tetap ----------
export const assetCategories = pgTable(
  'asset_categories',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    assetAccountId: uuid('asset_account_id')
      .notNull()
      .references(() => accounts.id),
    accumulatedAccountId: uuid('accumulated_account_id').references(() => accounts.id),
    expenseAccountId: uuid('expense_account_id').references(() => accounts.id),
    /** STRAIGHT_LINE | DECLINING_BALANCE | NONE */
    method: text('method').notNull().default('STRAIGHT_LINE'),
    usefulLifeMonths: integer('useful_life_months').notNull().default(48),
    /** Kelompok harta fiskal (Pasal 11 UU PPh) */
    fiscalGroup: text('fiscal_group').notNull().default('GROUP_1'),
    /** Metode penyusutan fiskal: STRAIGHT_LINE | DECLINING_BALANCE */
    fiscalMethod: text('fiscal_method').notNull().default('STRAIGHT_LINE'),
  },
  (t) => [uniqueIndex('asset_categories_name_uq').on(t.tenantId, t.name)],
);

export const fixedAssets = pgTable(
  'fixed_assets',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => assetCategories.id),
    acquisitionDate: date('acquisition_date').notNull(),
    /** Bulan pertama disusutkan (YYYY-MM-01) */
    depreciationStart: date('depreciation_start').notNull(),
    cost: money('cost').notNull(),
    residualValue: money('residual_value').notNull().default('0'),
    usefulLifeMonths: integer('useful_life_months').notNull(),
    method: text('method').notNull(),
    /** Akumulasi penyusutan sebelum memakai SANSU (aset lama) */
    openingAccumulated: money('opening_accumulated').notNull().default('0'),
    /** Akumulasi penyusutan fiskal sebelum memakai SANSU */
    openingFiscalAccumulated: money('opening_fiscal_accumulated').notNull().default('0'),
    location: text('location'),
    notes: text('notes'),
    status: text('status').notNull().default('ACTIVE'),
    acquisitionJournalId: uuid('acquisition_journal_id'),
    /** Dibeli lewat faktur supplier */
    purchaseInvoiceId: uuid('purchase_invoice_id'),
    disposalDate: date('disposal_date'),
    disposalPrice: money('disposal_price'),
    disposalJournalId: uuid('disposal_journal_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('fixed_assets_code_uq').on(t.tenantId, t.code)],
);

export const assetDepreciations = pgTable(
  'asset_depreciations',
  {
    id: id(),
    tenantId: tenantId(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => fixedAssets.id),
    /** YYYY-MM */
    period: text('period').notNull(),
    amount: money('amount').notNull(),
    journalId: uuid('journal_id'),
  },
  (t) => [uniqueIndex('asset_depreciations_uq').on(t.assetId, t.period), index('asset_depreciations_tenant_idx').on(t.tenantId, t.period)],
);

// ---------- Jurnal berulang ----------
export const recurringJournals = pgTable('recurring_journals', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  /** MONTHLY | QUARTERLY | YEARLY */
  frequency: text('frequency').notNull().default('MONTHLY'),
  nextDate: date('next_date').notNull(),
  endDate: date('end_date'),
  /** Batasi jumlah kejadian (mis. amortisasi sewa 12 bulan) */
  remaining: integer('remaining'),
  isAdjustment: boolean('is_adjustment').notNull().default(true),
  lines: jsonb('lines').$type<{ accountId: string; debit?: string; credit?: string; memo?: string }[]>().notNull(),
  isActive: boolean('is_active').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------- Fiskal & CALK ----------
export const fiscalAdjustments = pgTable('fiscal_adjustments', {
  id: id(),
  tenantId: tenantId(),
  year: integer('year').notNull(),
  description: text('description').notNull(),
  /** POSITIVE (menambah laba fiskal) | NEGATIVE */
  kind: text('kind').notNull(),
  amount: money('amount').notNull(),
});

export const fiscalYears = pgTable(
  'fiscal_years',
  {
    tenantId: tenantId(),
    year: integer('year').notNull(),
    /** Kompensasi kerugian fiskal tahun sebelumnya */
    lossCarryforward: money('loss_carryforward').notNull().default('0'),
    /** Peredaran bruto (bila diisi manual, menggantikan hitungan otomatis) */
    grossRevenueOverride: money('gross_revenue_override'),
    /** Biaya untuk penghasilan PPh final (bila diisi manual, menggantikan hitungan otomatis) */
    finalCostOverride: money('final_cost_override'),
    taxJournalId: uuid('tax_journal_id'),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.year] })],
);

/** Teks CALK yang diubah pengguna (menggantikan teks otomatis untuk bagian tertentu) */
export const reportNotes = pgTable(
  'report_notes',
  {
    tenantId: tenantId(),
    year: integer('year').notNull(),
    key: text('key').notNull(),
    content: text('content').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.year, t.key] })],
);

export const productsRelations = relations(products, ({ many }) => ({ uoms: many(productUoms) }));
export const productUomsRelations = relations(productUoms, ({ one }) => ({
  product: one(products, { fields: [productUoms.productId], references: [products.id] }),
}));
export const stockBalancesRelations = relations(stockBalances, ({ one }) => ({
  product: one(products, { fields: [stockBalances.productId], references: [products.id] }),
  warehouse: one(warehouses, { fields: [stockBalances.warehouseId], references: [warehouses.id] }),
}));
export const stockMovesRelations = relations(stockMoves, ({ one }) => ({
  product: one(products, { fields: [stockMoves.productId], references: [products.id] }),
  warehouse: one(warehouses, { fields: [stockMoves.warehouseId], references: [warehouses.id] }),
}));
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
export const journalEntriesRelations = relations(journalEntries, ({ many }) => ({ lines: many(journalLines) }));
export const journalLinesRelations = relations(journalLines, ({ one }) => ({
  journal: one(journalEntries, { fields: [journalLines.journalId], references: [journalEntries.id] }),
  account: one(accounts, { fields: [journalLines.accountId], references: [accounts.id] }),
}));

export const suppliersRelations = relations(suppliers, ({ many }) => ({ purchaseInvoices: many(purchaseInvoices) }));
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
export const salesReturnsRelations = relations(salesReturns, ({ one, many }) => ({
  invoice: one(invoices, { fields: [salesReturns.invoiceId], references: [invoices.id] }),
  customer: one(customers, { fields: [salesReturns.customerId], references: [customers.id] }),
  lines: many(salesReturnLines),
}));
export const salesReturnLinesRelations = relations(salesReturnLines, ({ one }) => ({
  ret: one(salesReturns, { fields: [salesReturnLines.returnId], references: [salesReturns.id] }),
  product: one(products, { fields: [salesReturnLines.productId], references: [products.id] }),
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
export const cashTransactionsRelations = relations(cashTransactions, ({ one, many }) => ({
  cashAccount: one(accounts, { fields: [cashTransactions.cashAccountId], references: [accounts.id], relationName: 'cashFrom' }),
  toCashAccount: one(accounts, { fields: [cashTransactions.toCashAccountId], references: [accounts.id], relationName: 'cashTo' }),
  lines: many(cashTransactionLines),
}));
export const cashTransactionLinesRelations = relations(cashTransactionLines, ({ one }) => ({
  transaction: one(cashTransactions, { fields: [cashTransactionLines.transactionId], references: [cashTransactions.id] }),
  account: one(accounts, { fields: [cashTransactionLines.accountId], references: [accounts.id] }),
}));

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
export const posPaymentsRelations = relations(posPayments, ({ one }) => ({
  order: one(posOrders, { fields: [posPayments.orderId], references: [posOrders.id] }),
}));
export const leadsRelations = relations(leads, ({ one, many }) => ({
  stage: one(crmStages, { fields: [leads.stageId], references: [crmStages.id] }),
  customer: one(customers, { fields: [leads.customerId], references: [customers.id] }),
  owner: one(users, { fields: [leads.ownerId], references: [users.id] }),
  activities: many(crmActivities),
  quotations: many(quotations),
}));
export const crmActivitiesRelations = relations(crmActivities, ({ one }) => ({
  lead: one(leads, { fields: [crmActivities.leadId], references: [leads.id] }),
  user: one(users, { fields: [crmActivities.userId], references: [users.id] }),
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
export const employeesRelations = relations(employees, ({ one, many }) => ({
  user: one(users, { fields: [employees.userId], references: [users.id] }),
  attendances: many(attendances),
  leaves: many(leaveRequests),
}));
export const attendancesRelations = relations(attendances, ({ one }) => ({
  employee: one(employees, { fields: [attendances.employeeId], references: [employees.id] }),
}));
export const leaveRequestsRelations = relations(leaveRequests, ({ one }) => ({
  employee: one(employees, { fields: [leaveRequests.employeeId], references: [employees.id] }),
}));
export const payrollRunsRelations = relations(payrollRuns, ({ many, one }) => ({
  payslips: many(payslips),
  cashAccount: one(accounts, { fields: [payrollRuns.cashAccountId], references: [accounts.id] }),
}));
export const payslipsRelations = relations(payslips, ({ one }) => ({
  run: one(payrollRuns, { fields: [payslips.runId], references: [payrollRuns.id] }),
  employee: one(employees, { fields: [payslips.employeeId], references: [employees.id] }),
}));

export const assetCategoriesRelations = relations(assetCategories, ({ one, many }) => ({
  assetAccount: one(accounts, { fields: [assetCategories.assetAccountId], references: [accounts.id], relationName: 'catAsset' }),
  accumulatedAccount: one(accounts, { fields: [assetCategories.accumulatedAccountId], references: [accounts.id], relationName: 'catAccum' }),
  expenseAccount: one(accounts, { fields: [assetCategories.expenseAccountId], references: [accounts.id], relationName: 'catExpense' }),
  assets: many(fixedAssets),
}));
export const fixedAssetsRelations = relations(fixedAssets, ({ one, many }) => ({
  category: one(assetCategories, { fields: [fixedAssets.categoryId], references: [assetCategories.id] }),
  depreciations: many(assetDepreciations),
}));
export const assetDepreciationsRelations = relations(assetDepreciations, ({ one }) => ({
  asset: one(fixedAssets, { fields: [assetDepreciations.assetId], references: [fixedAssets.id] }),
}));

// ---------- Rekonsiliasi bank ----------
export const bankStatements = pgTable('bank_statements', {
  id: id(),
  tenantId: tenantId(),
  cashAccountId: uuid('cash_account_id')
    .notNull()
    .references(() => accounts.id),
  fileName: text('file_name'),
  periodFrom: date('period_from').notNull(),
  periodTo: date('period_to').notNull(),
  openingBalance: money('opening_balance'),
  closingBalance: money('closing_balance'),
  status: text('status').notNull().default('OPEN'),
  createdAt: createdAt(),
});

export const bankStatementLines = pgTable(
  'bank_statement_lines',
  {
    id: id(),
    tenantId: tenantId(),
    statementId: uuid('statement_id')
      .notNull()
      .references(() => bankStatements.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    date: date('date').notNull(),
    description: text('description').notNull(),
    /** + uang masuk (kredit di rekening koran), − uang keluar */
    amount: money('amount').notNull(),
    balance: money('balance'),
    /** UNMATCHED · MATCHED (cocok dengan baris buku) · CREATED (jurnal dibuat dari sini) · IGNORED */
    status: text('status').notNull().default('UNMATCHED'),
    journalLineId: uuid('journal_line_id').references(() => journalLines.id, { onDelete: 'set null' }),
    journalId: uuid('journal_id'),
    matchedBy: text('matched_by'),
  },
  (t) => [index('bank_lines_statement_idx').on(t.statementId), uniqueIndex('bank_lines_journal_line_uq').on(t.journalLineId)],
);

// ---------- Setoran pajak ----------
export const taxPayments = pgTable(
  'tax_payments',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    /** PPN · PPH21 · PPH23 · PPH4_2 · PPH25 · PPH29 · PPH_FINAL · BPJS */
    type: text('type').notNull(),
    /** Masa pajak YYYY-MM (tahunan: YYYY-12) */
    period: text('period').notNull(),
    date: date('date').notNull(),
    amount: money('amount').notNull(),
    /** PPN: bagian PPN keluaran & masukan yang dikompensasikan */
    vatOut: money('vat_out').notNull().default('0'),
    vatIn: money('vat_in').notNull().default('0'),
    cashAccountId: uuid('cash_account_id').references(() => accounts.id),
    billingCode: text('billing_code'),
    ntpn: text('ntpn'),
    notes: text('notes'),
    journalId: uuid('journal_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('tax_payments_number_uq').on(t.tenantId, t.number), index('tax_payments_period_idx').on(t.tenantId, t.type, t.period)],
);

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

export const bankStatementsRelations = relations(bankStatements, ({ one, many }) => ({
  cashAccount: one(accounts, { fields: [bankStatements.cashAccountId], references: [accounts.id] }),
  lines: many(bankStatementLines),
}));
export const bankStatementLinesRelations = relations(bankStatementLines, ({ one }) => ({
  statement: one(bankStatements, { fields: [bankStatementLines.statementId], references: [bankStatements.id] }),
}));
export const taxPaymentsRelations = relations(taxPayments, ({ one }) => ({
  cashAccount: one(accounts, { fields: [taxPayments.cashAccountId], references: [accounts.id] }),
}));

// =============================================================
//  Layanan SaaS: verifikasi email, langganan, penagihan, sinkron marketplace
// =============================================================

/** Token sekali pakai (reset sandi / verifikasi email). Yang disimpan hanya hash SHA-256-nya. */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose').$type<'RESET' | 'VERIFY'>().notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('auth_tokens_hash_uq').on(t.tokenHash), index('auth_tokens_user_idx').on(t.userId, t.purpose)],
);

/** Paket langganan yang dijual */
export const plans = pgTable('plans', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  priceMonthly: money('price_monthly').notNull(),
  priceYearly: money('price_yearly').notNull(),
  /** null = tanpa batas */
  maxUsers: integer('max_users'),
  maxWarehouses: integer('max_warehouses'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
});

/** Langganan per perusahaan (satu baris per tenant) */
export const subscriptions = pgTable('subscriptions', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id),
  planId: uuid('plan_id')
    .notNull()
    .references(() => plans.id),
  /** TRIAL · ACTIVE · SUSPENDED · CANCELLED (kedaluwarsa dihitung dari tanggal) */
  status: text('status').$type<'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED'>().notNull(),
  cycle: text('cycle').$type<'MONTHLY' | 'YEARLY'>().notNull().default('MONTHLY'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  /** Akhir masa aktif berbayar. null pada status ACTIVE = tanpa batas (akun internal / gratis) */
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  notes: text('notes').notNull().default(''),
  /** Pengingat yang sudah dikirim, mis. { "trial-3": "2026-10-01" } */
  reminders: jsonb('reminders').$type<Record<string, string>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});

/** Tagihan langganan dari SANSU ke pelanggan */
export const billingInvoices = pgTable(
  'billing_invoices',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull().unique(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    cycle: text('cycle').$type<'MONTHLY' | 'YEARLY'>().notNull(),
    /** Harga paket (DPP) sebelum PPN */
    subtotal: money('subtotal').notNull().default('0'),
    vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    vatAmount: money('vat_amount').notNull().default('0'),
    /** Total dibayar = subtotal + PPN */
    amount: money('amount').notNull(),
    /** UNPAID · WAITING (bukti transfer dikirim) · PAID · CANCELLED */
    status: text('status').$type<'UNPAID' | 'WAITING' | 'PAID' | 'CANCELLED'>().notNull().default('UNPAID'),
    method: text('method').$type<'MANUAL' | 'MIDTRANS' | 'XENDIT'>().notNull().default('MANUAL'),
    dueDate: date('due_date').notNull(),
    proof: text('proof'),
    proofNote: text('proof_note'),
    rejectReason: text('reject_reason'),
    gatewayRef: text('gateway_ref'),
    gatewayUrl: text('gateway_url'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    confirmedBy: text('confirmed_by'),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('billing_invoices_tenant_idx').on(t.tenantId, t.createdAt), index('billing_invoices_status_idx').on(t.status)],
);

/** Pengaturan milik pemilik layanan (rekening transfer, masa trial, dsb.) — satu baris kunci/nilai */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

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

// =============================================================
//  Gudang: transfer antar gudang, stock opname, stok minimum
// =============================================================

/** Transfer barang antar gudang (langsung terposting: stok keluar dari asal & masuk ke tujuan dengan HPP asal) */
export const stockTransfers = pgTable(
  'stock_transfers',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    fromWarehouseId: uuid('from_warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    toWarehouseId: uuid('to_warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    notes: text('notes'),
    totalValue: money('total_value').notNull().default('0'),
    /** IN_TRANSIT (dikirim, belum diterima) · RECEIVED · CANCELLED (kembali ke gudang asal) */
    status: text('status').$type<'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED'>().notNull().default('RECEIVED'),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    receivedDate: date('received_date'),
    receivedById: uuid('received_by_id').references(() => users.id),
    receiveNotes: text('receive_notes'),
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('stock_transfers_number_uq').on(t.tenantId, t.number), index('stock_transfers_date_idx').on(t.tenantId, t.date)],
);

export const stockTransferLines = pgTable('stock_transfer_lines', {
  id: id(),
  transferId: uuid('transfer_id')
    .notNull()
    .references(() => stockTransfers.id, { onDelete: 'cascade' }),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  /** Satuan dasar */
  qty: qty('qty').notNull(),
  unitCost: qty('unit_cost').notNull(),
  writedownUnit: qty('writedown_unit').notNull().default('0'),
  /** Jumlah yang benar-benar diterima (null = belum diterima) */
  receivedQty: qty('received_qty'),
});

/** Stock opname: hitung fisik per gudang → selisih otomatis menjadi penyesuaian stok */
export const stockCounts = pgTable(
  'stock_counts',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    /** DRAFT (sedang dihitung) · POSTED (selisih sudah dibukukan) · CANCELLED */
    status: text('status').$type<'DRAFT' | 'POSTED' | 'CANCELLED'>().notNull().default('DRAFT'),
    category: text('category'),
    notes: text('notes'),
    adjustmentNumber: text('adjustment_number'),
    createdById: uuid('created_by_id').references(() => users.id),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('stock_counts_number_uq').on(t.tenantId, t.number)],
);

export const stockCountLines = pgTable(
  'stock_count_lines',
  {
    id: id(),
    countId: uuid('count_id')
      .notNull()
      .references(() => stockCounts.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    /** Stok sistem saat lembar hitung dibuat (informasi) */
    systemQty: qty('system_qty').notNull(),
    /** Hasil hitung fisik; null = belum dihitung (tidak disesuaikan) */
    countedQty: qty('counted_qty'),
    /** Stok sistem saat diposting & selisih yang dibukukan */
    postedSystemQty: qty('posted_system_qty'),
    difference: qty('difference'),
  },
  (t) => [uniqueIndex('stock_count_lines_uq').on(t.countId, t.productId)],
);

/** Stok minimum per produk per gudang (peringatan stok menipis) */
export const stockMinimums = pgTable(
  'stock_minimums',
  {
    tenantId: tenantId(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    minQty: qty('min_qty').notNull(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.warehouseId] }), index('stock_minimums_tenant_idx').on(t.tenantId)],
);

/** Catatan error server (5xx) untuk pemantauan pemilik layanan */
export const errorLogs = pgTable(
  'error_logs',
  {
    id: id(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    status: integer('status').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    message: text('message').notNull(),
    stack: text('stack'),
    tenantId: uuid('tenant_id'),
    userId: uuid('user_id'),
  },
  (t) => [index('error_logs_at_idx').on(t.at)],
);

/** Opname kas: hitung fisik uang per pecahan → selisih terhadap saldo buku dibukukan ke Selisih Kas */
export const cashCounts = pgTable(
  'cash_counts',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    /** DRAFT · WAITING_APPROVAL (selisih besar, menunggu Pemilik) · POSTED · CANCELLED */
    status: text('status').$type<'DRAFT' | 'WAITING_APPROVAL' | 'POSTED' | 'CANCELLED'>().notNull().default('DRAFT'),
    denominations: jsonb('denominations').$type<Record<string, number>>().notNull().default({}),
    items: jsonb('items').$type<{ type: 'ADD' | 'LESS'; description: string; amount: string }[]>().notNull().default([]),
    bookBalance: money('book_balance').notNull().default('0'),
    countedTotal: money('counted_total').notNull().default('0'),
    itemsTotal: money('items_total').notNull().default('0'),
    difference: money('difference').notNull().default('0'),
    custodianName: text('custodian_name'),
    notes: text('notes'),
    /** Penjelasan selisih (wajib bila ada selisih) */
    reason: text('reason'),
    rejectReason: text('reject_reason'),
    journalId: uuid('journal_id'),
    createdById: uuid('created_by_id').references(() => users.id),
    approvedById: uuid('approved_by_id').references(() => users.id),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('cash_counts_number_uq').on(t.tenantId, t.number), index('cash_counts_account_idx').on(t.accountId, t.date)],
);

/**
 * Penurunan nilai persediaan ke nilai realisasi neto (SAK EP Bab 13): biaya rata-rata barang
 * diturunkan; selisihnya dibebankan ke Kerugian Penurunan Nilai Persediaan.
 */
export const inventoryWritedowns = pgTable(
  'inventory_writedowns',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    /** WRITEDOWN = penurunan nilai · REVERSAL = pemulihan (maks. sebesar penurunan sebelumnya) */
    kind: text('kind').$type<'WRITEDOWN' | 'REVERSAL'>().notNull().default('WRITEDOWN'),
    reason: text('reason').notNull(),
    lines: jsonb('lines')
      .$type<{ productId: string; sku: string; name: string; unit: string; qty: string; oldCost: string; newCost: string; amount: string }[]>()
      .notNull()
      .default([]),
    total: money('total').notNull().default('0'),
    journalId: uuid('journal_id'),
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('inventory_writedowns_number_uq').on(t.tenantId, t.number), index('inventory_writedowns_date_idx').on(t.tenantId, t.date)],
);

/** Baris faktur jasa (tanpa barang/stok): uraian + akun pendapatan */
export const serviceInvoiceLines = pgTable('service_invoice_lines', {
  id: id(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  qty: qty('qty').notNull(),
  unit: text('unit').notNull().default('Paket'),
  price: money('price').notNull(),
  lineTotal: money('line_total').notNull(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
});

/** Proyek / kontrak jasa: nilai kontrak dan penagihan per termin */
export const projects = pgTable(
  'projects',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    /** Nilai kontrak (DPP, belum PPN) */
    contractValue: money('contract_value').notNull().default('0'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    status: text('status').$type<'ACTIVE' | 'DONE' | 'CANCELLED'>().notNull().default('ACTIVE'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('projects_code_uq').on(t.tenantId, t.code)],
);

/** Uang muka (DP) dari pelanggan: dicatat sebagai liabilitas sampai dipakai melunasi faktur */
export const customerDeposits = pgTable(
  'customer_deposits',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    projectId: uuid('project_id').references(() => projects.id),
    method: text('method').notNull().default('TRANSFER'),
    cashAccountId: uuid('cash_account_id'),
    /** Diterima (bruto, termasuk PPN uang muka bila PKP) */
    amount: money('amount').notNull(),
    dpp: money('dpp').notNull(),
    taxAmount: money('tax_amount').notNull().default('0'),
    appliedAmount: money('applied_amount').notNull().default('0'),
    description: text('description'),
    journalId: uuid('journal_id'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('customer_deposits_number_uq').on(t.tenantId, t.number), index('customer_deposits_customer_idx').on(t.tenantId, t.customerId)],
);

export const depositApplications = pgTable('deposit_applications', {
  id: id(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  depositId: uuid('deposit_id')
    .notNull()
    .references(() => customerDeposits.id),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id),
  date: date('date').notNull(),
  amount: money('amount').notNull(),
  dpp: money('dpp').notNull(),
  taxAmount: money('tax_amount').notNull().default('0'),
  journalId: uuid('journal_id'),
  createdAt: createdAt(),
});

export const serviceInvoiceLinesRelations = relations(serviceInvoiceLines, ({ one }) => ({
  invoice: one(invoices, { fields: [serviceInvoiceLines.invoiceId], references: [invoices.id] }),
  account: one(accounts, { fields: [serviceInvoiceLines.accountId], references: [accounts.id] }),
}));
export const projectsRelations = relations(projects, ({ one }) => ({
  customer: one(customers, { fields: [projects.customerId], references: [customers.id] }),
}));

/**
 * Kemajuan pekerjaan proyek (SAK EP Bab 23 — metode persentase penyelesaian).
 * Pendapatan yang sudah dihasilkan = nilai kontrak × % selesai. Selisih terhadap yang sudah ditagih dicatat sebagai
 * Pendapatan Belum Ditagih (aset kontrak) atau Pendapatan Diterima Dimuka (liabilitas kontrak).
 */
export const projectProgress = pgTable(
  'project_progress',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    date: date('date').notNull(),
    percent: numeric('percent', { precision: 5, scale: 2 }).notNull(),
    earned: money('earned').notNull(),
    billed: money('billed').notNull(),
    /** + aset kontrak / − liabilitas kontrak, sebelum & sesudah pencatatan ini */
    accrualBefore: money('accrual_before').notNull(),
    accrualAfter: money('accrual_after').notNull(),
    adjustment: money('adjustment').notNull(),
    revenueAccountId: uuid('revenue_account_id').references(() => accounts.id),
    notes: text('notes'),
    journalId: uuid('journal_id'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [index('project_progress_project_idx').on(t.projectId, t.date)],
);

/** Resep / Bill of Materials: bahan per batch untuk menghasilkan produk jadi */
export const boms = pgTable(
  'boms',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    /** Jumlah produk jadi per batch (satuan dasar) */
    outputQty: qty('output_qty').notNull(),
    /** Biaya konversi standar per batch: upah langsung & overhead pabrik */
    laborCost: money('labor_cost').notNull().default('0'),
    overheadCost: money('overhead_cost').notNull().default('0'),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('boms_code_uq').on(t.tenantId, t.code)],
);

export const bomLines = pgTable('bom_lines', {
  id: id(),
  bomId: uuid('bom_id')
    .notNull()
    .references(() => boms.id, { onDelete: 'cascade' }),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  /** Kebutuhan bahan per batch (satuan dasar), termasuk susut normal */
  qty: qty('qty').notNull(),
});

/**
 * Perintah produksi: DRAFT → IN_PROGRESS (bahan dikeluarkan ke Barang dalam Proses) → COMPLETED (produk jadi masuk
 * gudang dengan harga pokok = bahan + upah langsung + overhead dibebankan) / CANCELLED (bahan kembali).
 */
export const productionOrders = pgTable(
  'production_orders',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    bomId: uuid('bom_id')
      .notNull()
      .references(() => boms.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    /** Jumlah batch & rencana hasil (satuan dasar) */
    batches: qty('batches').notNull(),
    plannedQty: qty('planned_qty').notNull(),
    status: text('status').$type<'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'>().notNull().default('DRAFT'),
    startedDate: date('started_date'),
    completedDate: date('completed_date'),
    cancelledDate: date('cancelled_date'),
    outputQty: qty('output_qty').notNull().default('0'),
    materialCost: money('material_cost').notNull().default('0'),
    laborCost: money('labor_cost').notNull().default('0'),
    overheadCost: money('overhead_cost').notNull().default('0'),
    totalCost: money('total_cost').notNull().default('0'),
    unitCost: qty('unit_cost').notNull().default('0'),
    notes: text('notes'),
    startJournalId: uuid('start_journal_id'),
    completeJournalId: uuid('complete_journal_id'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('production_orders_number_uq').on(t.tenantId, t.number), index('production_orders_status_idx').on(t.tenantId, t.status)],
);

export const productionOrderLines = pgTable('production_order_lines', {
  id: id(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => productionOrders.id, { onDelete: 'cascade' }),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  /** Kebutuhan menurut resep dan yang benar-benar dikeluarkan (satuan dasar) */
  plannedQty: qty('planned_qty').notNull(),
  issuedQty: qty('issued_qty').notNull().default('0'),
  unitCost: qty('unit_cost').notNull().default('0'),
  value: money('value').notNull().default('0'),
});


// ---------- Pengingat otomatis ----------
/** Pengingat yang ditunda pengguna sampai tanggal tertentu */
export const reminderSnoozes = pgTable(
  'reminder_snoozes',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    until: date('until').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('reminder_snoozes_user_key_uq').on(t.userId, t.key)],
);

/** Catatan pengiriman pengingat agar tidak terkirim dua kali (ringkasan harian, pengingat tagihan pelanggan) */
export const reminderLog = pgTable(
  'reminder_log',
  {
    id: id(),
    tenantId: tenantId(),
    /** DIGEST = ringkasan harian ke pengguna; CUSTOMER = pengingat tagihan ke pelanggan */
    kind: text('kind').$type<'DIGEST' | 'CUSTOMER'>().notNull(),
    /** Pengguna (DIGEST) atau faktur (CUSTOMER) */
    ref: text('ref').notNull(),
    /** Tanggal (DIGEST) atau tahap pengingat (CUSTOMER: BEFORE, DUE, OVERDUE-1, ...) */
    stage: text('stage').notNull(),
    sentTo: text('sent_to'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('reminder_log_uq').on(t.tenantId, t.kind, t.ref, t.stage)],
);
