// =============================================================
//  SANSU — skema database (Drizzle ORM, PostgreSQL)
//  Prinsip:
//   * Setiap tabel bisnis punya tenant_id (multi-tenant, skema bersama)
//   * Uang NUMERIC(18,2), kuantitas & biaya satuan NUMERIC(18,4) — tidak pernah float
//   * Tanggal dokumen bertipe DATE (string 'YYYY-MM-DD')
//   * Jurnal yang sudah diposting tidak diubah; koreksi lewat jurnal balik
//  Ubah file ini lalu jalankan `npm run db:generate -w backend` untuk membuat migrasi.
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
  customType,
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

import { decryptField, encryptField } from '../common/utils/secret';

/** Kolom identitas/rekening: terenkripsi AES-256-GCM di database, otomatis dibuka/ditutup saat dibaca/ditulis (lihat secret.ts) */
const encryptedText = customType<{ data: string | null; driverData: string | null }>({
  dataType: () => 'text',
  toDriver: (v) => encryptField(v),
  fromDriver: (v) => decryptField(v),
});
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

/** Peran khusus: peran dasar dikurangi daftar hak tulis (kunci rute "POST /purchase-orders") yang dicabut; hanya mempersempit */
export const customRoles = pgTable(
  'custom_roles',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    baseRole: roleEnum('base_role').notNull(),
    denied: text('denied').array().notNull().default(sql`'{}'`),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('custom_roles_name_uq').on(t.tenantId, sql`lower(${t.name})`)],
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
    /** Peran khusus (peran dasar dikurangi hak tulis tertentu); null = peran bawaan */
    customRoleId: uuid('custom_role_id'),
    isActive: boolean('is_active').notNull().default(true),
    /** Naik setiap kali sesi harus dicabut (ganti sandi, nonaktif, ganti peran, keluar dari semua perangkat) */
    tokenVersion: integer('token_version').notNull().default(0),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /** null = email belum diverifikasi */
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    /** Gudang yang boleh diakses; null/kosong = semua gudang */
    warehouseIds: uuid('warehouse_ids').array(),
    /** Pengguna hanya melihat laporan & transaksi cabang-cabang ini (kosong = semua cabang) */
    branchIds: uuid('branch_ids').array(),
    /** Verifikasi 2 langkah (TOTP): rahasia terenkripsi, aktif sejak, hash kode cadangan */
    totpSecret: text('totp_secret'),
    totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
    totpBackupCodes: jsonb('totp_backup_codes').$type<string[]>(),
    /** Notifikasi Telegram: chat pribadi yang sudah dihubungkan; kode tautan sekali pakai (kedaluwarsa singkat) */
    telegramChatId: text('telegram_chat_id'),
    telegramLinkCode: text('telegram_link_code'),
    telegramLinkExpires: timestamp('telegram_link_expires', { withTimezone: true }),
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
    /** Cabang pemilik gudang/toko; transaksi di gudang ini otomatis berlabel cabang tersebut */
    branchId: uuid('branch_id').references((): AnyPgColumn => branches.id),
    /** MAIN = gudang biasa; CONSIGNMENT = stok titipan di outlet (milik kita sampai dilaporkan terjual); VAN = stok mobil sales kanvas */
    kind: text('kind').$type<'MAIN' | 'CONSIGNMENT' | 'VAN'>().notNull().default('MAIN'),
    consigneeCustomerId: uuid('consignee_customer_id'),
    vanUserId: uuid('van_user_id'),
  },
  (t) => [
    uniqueIndex('warehouses_code_uq').on(t.tenantId, t.code),
    uniqueIndex('warehouses_consignee_uq').on(t.tenantId, t.consigneeCustomerId).where(sql`kind = 'CONSIGNMENT'`),
    uniqueIndex('warehouses_van_user_uq').on(t.tenantId, t.vanUserId).where(sql`kind = 'VAN'`),
  ],
);

/** Cabang / unit usaha dalam satu perusahaan (satu pembukuan; label cabang pada baris jurnal) */
export const branches = pgTable(
  'branches',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('branches_code_uq').on(t.tenantId, t.code)],
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
    /** GENERATED = dibuat sistem (tidak bisa diubah); MANUFACTURER = barcode pabrikan hasil scan */
    barcodeSource: text('barcode_source').$type<'GENERATED' | 'MANUFACTURER'>(),
    /** GOODS = bahan / barang dagang / barang jadi; SEMI = barang setengah jadi (akun persediaan tersendiri, hanya lewat produksi) */
    inventoryKind: text('inventory_kind').$type<'GOODS' | 'SEMI'>().notNull().default('GOODS'),
    /** Menu: dibuat saat dipesan. Kasir memotong bahan sesuai resep aktif (bukan stok produk ini) dan HPP dihitung dari bahan */
    madeToOrder: boolean('made_to_order').notNull().default(false),
    /** Umur simpan (hari): hasil produksi barang ini otomatis mendapat lot dengan tanggal kedaluwarsa = tanggal selesai + umur simpan */
    shelfLifeDays: integer('shelf_life_days'),
    /** Berat per satuan dasar (kg): dasar muatan rute pengiriman; kosong = belum diisi */
    weightKg: numeric('weight_kg', { precision: 18, scale: 3 }),
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
    npwp: encryptedText('npwp'),
    /** 0 = tanpa batas */
    creditLimit: money('credit_limit').notNull().default('0'),
    paymentTermDays: integer('payment_term_days').notNull().default(30),
    isActive: boolean('is_active').notNull().default(true),
    /** Daftar harga yang berlaku untuk pelanggan ini (segmen: grosir, minimarket, warung, ...); kosong = harga jual master */
    priceListId: uuid('price_list_id').references((): AnyPgColumn => priceLists.id),
    /** Koordinat outlet (untuk memeriksa kunjungan sales kanvas) */
    geoLat: numeric('geo_lat', { precision: 9, scale: 6 }),
    geoLng: numeric('geo_lng', { precision: 9, scale: 6 }),
    /** Peritel modern: setiap pesanan wajib membawa nomor PO outlet (unik per outlet) */
    requirePo: boolean('require_po').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('customers_code_uq').on(t.tenantId, t.code)],
);

// ---------- Daftar harga & promo (FMCG) ----------
/** Daftar harga per segmen pelanggan. Harga per satuan dasar; bisa bertingkat menurut jumlah beli (min_qty satuan dasar). */
export const priceLists = pgTable(
  'price_lists',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('price_lists_name_uq').on(t.tenantId, sql`lower(${t.name})`)],
);

export const priceListItems = pgTable(
  'price_list_items',
  {
    id: id(),
    tenantId: tenantId(),
    priceListId: uuid('price_list_id')
      .notNull()
      .references(() => priceLists.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    /** Berlaku mulai jumlah beli ini (satuan dasar); 1 = harga dasar daftar */
    minQty: qty('min_qty').notNull().default('1'),
    /** Harga per satuan dasar */
    price: qty('price').notNull(),
  },
  (t) => [uniqueIndex('price_list_items_uq').on(t.priceListId, t.productId, t.minQty), index('price_list_items_product_idx').on(t.productId)],
);

/** Promo penjualan: potongan harga bertingkat atau bonus barang. Diterapkan otomatis pada pesanan penjualan. */
export const promos = pgTable('promos', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  /** DISCOUNT = potongan % bila beli >= min_qty; BONUS = gratis bonus_qty barang bonus untuk tiap kelipatan min_qty */
  kind: text('kind').notNull(),
  /** Produk pemicu; kosong = semua produk (hanya untuk DISCOUNT) */
  productId: uuid('product_id').references(() => products.id),
  /** Jumlah beli minimum (satuan dasar) */
  minQty: qty('min_qty').notNull().default('1'),
  discountPct: numeric('discount_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  bonusProductId: uuid('bonus_product_id').references(() => products.id),
  bonusQty: qty('bonus_qty').notNull().default('0'),
  validFrom: date('valid_from'),
  validTo: date('valid_to'),
  /** Batasi ke pelanggan pada daftar harga ini; kosong = semua pelanggan */
  priceListId: uuid('price_list_id').references(() => priceLists.id),
  /** Prinsipal yang ikut menanggung biaya promo ini (dasar klaim) dan persentase tanggungannya */
  fundedSupplierId: uuid('funded_supplier_id'),
  fundedPct: numeric('funded_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
});

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

/**
 * Lot bahan dengan tanggal kedaluwarsa (informatif: tidak mengubah nilai persediaan atau jurnal). Barang masuk bisa membawa lot dan
 * tanggal kedaluwarsa; barang keluar mengurangi lot yang paling cepat kedaluwarsa lebih dulu (FEFO).
 */
export const stockLots = pgTable(
  'stock_lots',
  {
    id: id(),
    tenantId: tenantId(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    lotNo: text('lot_no'),
    expiryDate: date('expiry_date'),
    receivedDate: date('received_date').notNull(),
    qtyReceived: qty('qty_received').notNull(),
    qtyRemaining: qty('qty_remaining').notNull(),
    /** Dokumen asal (mis. GOODS_RECEIPT, STOCK_ADJUSTMENT, STOCK_TRANSFER) dan id-nya */
    sourceType: text('source_type').notNull(),
    sourceRef: text('source_ref').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('stock_lots_fefo_idx').on(t.productId, t.warehouseId, t.expiryDate, t.id).where(sql`qty_remaining > 0`),
    index('stock_lots_tenant_expiry_idx').on(t.tenantId, t.expiryDate).where(sql`qty_remaining > 0`),
    index('stock_lots_source_idx').on(t.sourceRef),
  ],
);

/**
 * Riwayat keluar tiap lot: dokumen apa (penjualan, transfer, penyesuaian, ...) mengambil berapa dari lot mana.
 * Dasar penelusuran penarikan produk (recall): dari satu nomor lot ke seluruh pelanggan penerimanya.
 */
export const stockLotIssues = pgTable(
  'stock_lot_issues',
  {
    id: id(),
    tenantId: tenantId(),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => stockLots.id),
    productId: uuid('product_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    qty: qty('qty').notNull(),
    moveType: text('move_type').notNull(),
    refType: text('ref_type').notNull(),
    refId: text('ref_id').notNull(),
    date: date('date').notNull(),
    /** true = direkonstruksi sistem dari mutasi lama (perkiraan alokasi FEFO), bukan dicatat saat barang keluar */
    isEstimate: boolean('is_estimate').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('stock_lot_issues_lot_idx').on(t.lotId), index('stock_lot_issues_ref_idx').on(t.refType, t.refId)],
);

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

/** Token sekali pakai untuk mengunduh ekspor seluruh data perusahaan: hanya hash yang disimpan, berlaku singkat, sekali pakai */
export const dataExportTokens = pgTable(
  'data_export_tokens',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('data_export_tokens_hash_uq').on(t.tokenHash)],
);

/** Permintaan penghapusan seluruh data perusahaan oleh pemilik: dijadwalkan dengan masa tenggang, dapat dibatalkan atau ditahan sebelum dieksekusi */
export const dataDeletionRequests = pgTable(
  'data_deletion_requests',
  {
    id: id(),
    tenantId: tenantId(),
    requestedById: uuid('requested_by_id').notNull(),
    requestedByEmail: text('requested_by_email').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    scheduledFor: date('scheduled_for').notNull(),
    status: text('status').$type<'SCHEDULED' | 'ON_HOLD' | 'CANCELLED' | 'EXECUTED'>().notNull().default('SCHEDULED'),
    reason: text('reason'),
    /** Pemilik menyatakan memahami kewajiban menyimpan pembukuan/dokumen pajak dan menanggung penyimpanannya sendiri */
    ackRetention: boolean('ack_retention').notNull().default(false),
    /** true = pemilik memilih menghapus tanpa mengunduh ekspor; false = penghapusan menunggu ekspor diunduh */
    exportWaived: boolean('export_waived').notNull().default(false),
    holdReason: text('hold_reason'),
    heldBy: text('held_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: text('cancelled_by'),
    lastReminderAt: timestamp('last_reminder_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('data_deletion_active_uq').on(t.tenantId).where(sql`status IN ('SCHEDULED', 'ON_HOLD')`)],
);

/**
 * Bukti penghapusan data perusahaan (akuntabilitas): sengaja TANPA foreign key dan tanpa isi data bisnis,
 * hanya identitas perusahaan, kapan, siapa yang meminta, dan jumlah baris yang dihapus per tabel.
 */
export const dataErasureLog = pgTable('data_erasure_log', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  companyName: text('company_name').notNull(),
  requestedByEmail: text('requested_by_email').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
  executedAt: timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
  exportWaived: boolean('export_waived').notNull(),
  rowsDeleted: integer('rows_deleted').notNull(),
  tablesTouched: integer('tables_touched').notNull(),
  detail: jsonb('detail').$type<Record<string, number>>().notNull(),
});

/** Lot yang ikut berpindah saat transfer gudang: dicatat saat barang keluar, dipakai lagi saat barang masuk di gudang tujuan */
export const stockLotTransit = pgTable(
  'stock_lot_transit',
  {
    id: id(),
    tenantId: tenantId(),
    refId: text('ref_id').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    lotNo: text('lot_no'),
    expiryDate: date('expiry_date'),
    receivedDate: date('received_date').notNull(),
    qtyLeft: qty('qty_left').notNull(),
  },
  (t) => [index('stock_lot_transit_ref_idx').on(t.refId, t.productId)],
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

/** Permintaan persetujuan atas transaksi bernilai besar (pesanan pembelian, jurnal manual) dari peran yang tidak berwenang */
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: id(),
    tenantId: tenantId(),
    kind: text('kind').$type<'PURCHASE_ORDER' | 'MANUAL_JOURNAL' | 'PURCHASE_INVOICE_PRICE' | 'ASSET_DISPOSAL' | 'CASH_TX' | 'PETTY_REPLENISH' | 'STOCK_ADJUSTMENT' | 'SUPPLIER_PAYMENT' | 'BILL' | 'SUPPLIER_BANK' | 'SALES_ORDER' | 'SALES_RETURN' | 'CUSTOMER_TERMS' | 'CUSTOMER_PAYMENT' | 'STOCK_COUNT' | 'AR_WRITE_OFF' | 'ASSET_METHOD'>().notNull(),
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
    /** Penyetuju yang dipilih pemohon (harus berwenang); kosong = semua penyetuju boleh memutuskan */
    assignedToId: uuid('assigned_to_id').references(() => users.id),
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

/** Kendaraan pengiriman beserta kapasitas muat (kg); kosong = tanpa batas */
export const deliveryVehicles = pgTable(
  'delivery_vehicles',
  {
    id: id(),
    tenantId: tenantId(),
    plate: text('plate').notNull(),
    name: text('name'),
    capacityKg: numeric('capacity_kg', { precision: 18, scale: 2 }),
    defaultDriver: text('default_driver'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('delivery_vehicles_plate_uq').on(t.tenantId, sql`lower(${t.plate})`)],
);

/** Rute pengiriman: satu kendaraan/pengemudi membawa beberapa surat jalan pada satu tanggal */
export const deliveryTrips = pgTable(
  'delivery_trips',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    vehicle: text('vehicle'),
    driverName: text('driver_name'),
    status: text('status').$type<'PLANNED' | 'ON_ROUTE' | 'COMPLETED' | 'CANCELLED'>().notNull().default('PLANNED'),
    notes: text('notes'),
    departedAt: timestamp('departed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    vehicleId: uuid('vehicle_id').references(() => deliveryVehicles.id),
    /** Jarak rute (meter) dan sumbernya: JALAN (layanan peta) atau LURUS (garis lurus antar titik) */
    distanceM: integer('distance_m'),
    distanceSource: text('distance_source').$type<'JALAN' | 'LURUS'>(),
    /** Lokasi terakhir yang dibagikan petugas saat rute berjalan */
    lastLat: numeric('last_lat', { precision: 9, scale: 6 }),
    lastLng: numeric('last_lng', { precision: 9, scale: 6 }),
    lastPositionAt: timestamp('last_position_at', { withTimezone: true }),
    /** Alasan Admin/Pemilik memberangkatkan muatan melebihi kapasitas */
    overCapacityReason: text('over_capacity_reason'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('delivery_trips_number_uq').on(t.tenantId, t.number), index('delivery_trips_date_idx').on(t.tenantId, t.date)],
);

export const deliveryTripStops = pgTable(
  'delivery_trip_stops',
  {
    id: id(),
    tenantId: tenantId(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => deliveryTrips.id, { onDelete: 'cascade' }),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveryOrders.id),
    sequence: integer('sequence').notNull(),
    status: text('status').$type<'PENDING' | 'DELIVERED' | 'FAILED'>().notNull().default('PENDING'),
    receivedBy: text('received_by'),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    failReason: text('fail_reason'),
    note: text('note'),
    /** Lokasi saat hasil dicatat dan jaraknya dari titik pelanggan (meter) */
    resultLat: numeric('result_lat', { precision: 9, scale: 6 }),
    resultLng: numeric('result_lng', { precision: 9, scale: 6 }),
    resultDistanceM: integer('result_distance_m'),
    /** Foto bukti dan tanda tangan penerima (data URL gambar, dikompres di tampilan) */
    proofPhoto: text('proof_photo'),
    proofSignature: text('proof_signature'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('delivery_trip_stops_active_uq').on(t.deliveryId).where(sql`${t.status} IN ('PENDING', 'DELIVERED')`),
    index('delivery_trip_stops_trip_idx').on(t.tripId, t.sequence),
  ],
);

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

// ---------- Mata uang asing ----------
export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: id(),
    tenantId: tenantId(),
    currency: text('currency').notNull(),
    date: date('date').notNull(),
    /** Rupiah per 1 satuan mata uang asing */
    rate: numeric('rate', { precision: 18, scale: 6 }).notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('exchange_rates_uq').on(t.tenantId, t.currency, t.date)],
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
    /** Rekening kas/bank milik cabang: transaksi lewat rekening ini otomatis berlabel cabang */
    branchId: uuid('branch_id').references((): AnyPgColumn => branches.id),
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
    /** Cabang (diturunkan otomatis dari gudang/kas bila tidak diisi); kosong = pusat / belum ditentukan */
    branchId: uuid('branch_id'),
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
    npwp: encryptedText('npwp'),
    paymentTermDays: integer('payment_term_days').notNull().default(30),
    isActive: boolean('is_active').notNull().default(true),
    /** Supplier favorit: PO / permintaan pembelian sampai batas ini disetujui otomatis (0 = tidak ada) */
    isPreferred: boolean('is_preferred').notNull().default(false),
    autoApproveLimit: money('auto_approve_limit').notNull().default('0'),
    /** Rekening pembayaran. Perubahan rekening yang sudah terisi wajib disetujui orang lain (anti pengalihan pembayaran) */
    bankName: text('bank_name'),
    bankAccountNo: encryptedText('bank_account_no'),
    bankAccountName: text('bank_account_name'),
    bankChangedAt: timestamp('bank_changed_at', { withTimezone: true }),
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
    /** Cabang transaksi kas/biaya (kosong = pusat) */
    branchId: uuid('branch_id'),
    /** POSTED | VOID (dibatalkan dengan jurnal pembalik; transaksi tidak pernah dihapus) */
    status: text('status').$type<'POSTED' | 'VOID'>().notNull().default('POSTED'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedById: uuid('voided_by_id'),
    voidReason: text('void_reason'),
    voidJournalId: uuid('void_journal_id'),
  },
  (t) => [
    uniqueIndex('cash_transactions_number_uq').on(t.tenantId, t.number),
    index('cash_transactions_date_idx').on(t.tenantId, t.date),
  ],
);

/**
 * Kas kecil dengan sistem dana tetap (imprest): dana ditetapkan sebesar plafon; pengeluaran dicatat dengan bukti kas kecil
 * (langsung dibebankan), lalu pengisian kembali mengembalikan dana ke plafon. Kas kecil + bukti belum diganti = plafon.
 */
export const pettyCashFunds = pgTable(
  'petty_cash_funds',
  {
    id: id(),
    tenantId: tenantId(),
    /** Akun kas kecil di bagan akun (mis. 1-1110) */
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    /** Sumber pengisian: kas besar / bank */
    fundingAccountId: uuid('funding_account_id').notNull().references(() => accounts.id),
    name: text('name').notNull(),
    custodianName: text('custodian_name').notNull(),
    imprestAmount: money('imprest_amount').notNull(),
    /** Batas nilai per bukti kas kecil */
    maxVoucher: money('max_voucher').notNull(),
    status: text('status').$type<'ACTIVE' | 'CLOSED'>().notNull().default('ACTIVE'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('petty_cash_funds_account_uq').on(t.tenantId, t.accountId)],
);

export const pettyCashVouchers = pgTable(
  'petty_cash_vouchers',
  {
    id: id(),
    tenantId: tenantId(),
    fundId: uuid('fund_id').notNull().references(() => pettyCashFunds.id),
    number: text('number').notNull(),
    date: date('date').notNull(),
    payee: text('payee').notNull(),
    description: text('description').notNull(),
    expenseAccountId: uuid('expense_account_id').notNull().references(() => accounts.id),
    amount: money('amount').notNull(),
    /** Nomor nota/kuitansi (wajib) */
    receiptRef: text('receipt_ref').notNull(),
    /** OPEN = belum diganti · REPLENISHED = sudah diganti lewat pengisian kembali · VOID = dibatalkan */
    status: text('status').$type<'OPEN' | 'REPLENISHED' | 'VOID'>().notNull().default('OPEN'),
    cashTransactionId: uuid('cash_transaction_id'),
    replenishmentId: uuid('replenishment_id'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('petty_cash_vouchers_number_uq').on(t.tenantId, t.number), index('petty_cash_vouchers_fund_idx').on(t.fundId, t.status)],
);

export const pettyCashReplenishments = pgTable(
  'petty_cash_replenishments',
  {
    id: id(),
    tenantId: tenantId(),
    fundId: uuid('fund_id').notNull().references(() => pettyCashFunds.id),
    number: text('number').notNull(),
    date: date('date').notNull(),
    total: money('total').notNull(),
    voucherCount: integer('voucher_count').notNull(),
    cashTransactionId: uuid('cash_transaction_id'),
    requestedById: uuid('requested_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('petty_cash_replenishments_number_uq').on(t.tenantId, t.number)],
);

/** Jurnal balik terjadwal (akrual yang dibalik otomatis di awal periode berikutnya) */
export const scheduledReversals = pgTable(
  'scheduled_reversals',
  {
    id: id(),
    tenantId: tenantId(),
    journalId: uuid('journal_id').notNull().references(() => journalEntries.id),
    reverseOn: date('reverse_on').notNull(),
    /** PENDING · DONE · SKIPPED (sudah dibalik manual) · CANCELLED */
    status: text('status').$type<'PENDING' | 'DONE' | 'SKIPPED' | 'CANCELLED'>().notNull().default('PENDING'),
    reversalJournalId: uuid('reversal_journal_id'),
    lastError: text('last_error'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('scheduled_reversals_journal_uq').on(t.journalId), index('scheduled_reversals_due_idx').on(t.tenantId, t.status, t.reverseOn)],
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
  /** Kas masuk non-penjualan: sumber dalam bahasa kegiatan usaha (akun ditentukan sistem) */
  sourceKey: text('source_key'),
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

export type PosTabStatus = 'OPEN' | 'PAID' | 'CANCELLED';
export type PosTabLineStatus = 'DRAFT' | 'NEW' | 'PREPARING' | 'READY' | 'SERVED' | 'VOID';

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
    nik: encryptedText('nik'),
    npwp: encryptedText('npwp'),
    ptkp: text('ptkp').notNull().default('TK/0'),
    jobTitle: text('job_title'),
    department: text('department'),
    joinDate: date('join_date').notNull(),
    birthDate: date('birth_date'),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    bankName: text('bank_name'),
    bankAccount: encryptedText('bank_account'),
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
    /** Status kepegawaian: TETAP · KONTRAK (PKWT) · HARIAN · TENAGA_LEPAS (dibayar per catatan kerja) · MAGANG · MITRA. Selain TETAP hanya untuk usaha jasa. */
    employmentType: text('employment_type').$type<'TETAP' | 'KONTRAK' | 'HARIAN' | 'TENAGA_LEPAS' | 'MAGANG' | 'MITRA'>().notNull().default('TETAP'),
    contractStart: date('contract_start'),
    /** Akhir kontrak / magang: gaji otomatis berhenti di tanggal ini kecuali diperpanjang lewat persetujuan */
    contractEnd: date('contract_end'),
    /** Upah per hari hadir (status HARIAN) */
    dailyWage: money('daily_wage').notNull().default('0'),
    /** Usaha jasa: karyawan baru baru ikut penggajian setelah diverifikasi orang lain (cegah karyawan fiktif) */
    verified: boolean('verified').notNull().default(true),
    createdById: uuid('created_by_id'),
    verifiedById: uuid('verified_by_id'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: createdAt(),
    /** Cabang tempat karyawan bekerja: gaji & BPJS otomatis berlabel cabang ini */
    branchId: uuid('branch_id').references((): AnyPgColumn => branches.id),
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
    /** Upah jasa (jam, sesi, borongan, komisi faktur) dari catatan kerja yang sudah disetujui; sudah termasuk di gross_pay */
    serviceIncome: money('service_income').notNull().default('0'),
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


/** Usaha jasa: perubahan data sensitif karyawan (gaji, rekening, status, kontrak, pajak) oleh HR baru berlaku setelah disetujui orang lain */
export const employeeChangeRequests = pgTable(
  'employee_change_requests',
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    /** { kolom: { from, to } } */
    changes: jsonb('changes').$type<Record<string, { from: unknown; to: unknown }>>().notNull(),
    reason: text('reason'),
    status: text('status').$type<'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'>().notNull().default('PENDING'),
    requestedById: uuid('requested_by_id').notNull(),
    decidedById: uuid('decided_by_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('employee_change_pending_uq').on(t.employeeId).where(sql`status = 'PENDING'`)],
);

/** Alur kerja operasional: satu kasus = satu proses (mis. proyek jasa, order outlet) yang bergerak antar tahap sesuai pipeline jenis usahanya */
export const workflowCases = pgTable(
  'workflow_cases',
  {
    id: id(),
    tenantId: tenantId(),
    pipeline: text('pipeline').notNull(),
    number: text('number').notNull(),
    title: text('title').notNull(),
    stage: text('stage').notNull(),
    status: text('status').$type<'ACTIVE' | 'DONE' | 'CANCELLED'>().notNull().default('ACTIVE'),
    customerId: uuid('customer_id').references(() => customers.id),
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    amount: money('amount').notNull().default('0'),
    dueDate: date('due_date'),
    createdById: uuid('created_by_id').notNull(),
    stageEnteredAt: timestamp('stage_entered_at', { withTimezone: true }).notNull().defaultNow(),
    stageEnteredById: uuid('stage_entered_by_id'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** Kunci kasus buatan sistem (mis. RESTOCK:produk:gudang) agar tidak ganda */
    refKey: text('ref_key'),
    autoOpened: boolean('auto_opened').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('workflow_cases_number_uq').on(t.tenantId, t.number), index('workflow_cases_pipeline_idx').on(t.tenantId, t.pipeline, t.status, t.stage)],
);

export const workflowLinks = pgTable(
  'workflow_links',
  {
    id: id(),
    tenantId: tenantId(),
    caseId: uuid('case_id').notNull().references(() => workflowCases.id, { onDelete: 'cascade' }),
    linkType: text('link_type').notNull(),
    docId: uuid('doc_id').notNull(),
    docNumber: text('doc_number').notNull(),
    createdById: uuid('created_by_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('workflow_links_doc_uq').on(t.tenantId, t.linkType, t.docId), index('workflow_links_case_idx').on(t.caseId)],
);

export const workflowEvents = pgTable(
  'workflow_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: tenantId(),
    caseId: uuid('case_id').notNull().references(() => workflowCases.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    fromStage: text('from_stage'),
    toStage: text('to_stage'),
    note: text('note'),
    byId: uuid('by_id'),
    auto: boolean('auto').notNull().default(false),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('workflow_events_case_idx').on(t.caseId, t.id)],
);

/** Kartu tarif usaha jasa: tarif per jam / sesi / borongan, atau persen komisi faktur. Yang mengisi catatan kerja tidak bisa mengubah tarif. */
export const serviceRates = pgTable(
  'service_rates',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    /** HOUR = per jam · SESSION = per sesi · JOB = borongan per pekerjaan · PERCENT = persen dari nilai faktur jasa */
    unit: text('unit').$type<'HOUR' | 'SESSION' | 'JOB' | 'PERCENT' | 'SHIFT' | 'PIECE'>().notNull(),
    rate: numeric('rate', { precision: 18, scale: 2 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('service_rates_name_uq').on(t.tenantId, t.name)],
);

/** Catatan kerja pegawai jasa → upah variabel di slip gaji. Dibuat HR, disetujui orang lain; angka dihitung server dari tarif (disalin saat dibuat). */
export const serviceWorkEntries = pgTable(
  'service_work_entries',
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    rateId: uuid('rate_id')
      .notNull()
      .references(() => serviceRates.id),
    unit: text('unit').$type<'HOUR' | 'SESSION' | 'JOB' | 'PERCENT' | 'SHIFT' | 'PIECE'>().notNull(),
    workDate: date('work_date').notNull(),
    projectId: uuid('project_id'),
    /** Hanya untuk komisi: faktur jasa yang dikomisikan */
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    /** Upah per hasil (pabrik): perintah produksi yang dikerjakan; jumlah hasil dibatasi oleh keluaran perintah itu */
    productionOrderId: uuid('production_order_id').references(() => productionOrders.id),
    /** Premi shift otomatis dari jadwal: penugasan yang menjadi dasarnya (satu penugasan hanya satu premi) */
    shiftAssignmentId: uuid('shift_assignment_id'),
    /** Jam / sesi / pekerjaan; untuk komisi = persen */
    quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(),
    rate: numeric('rate', { precision: 18, scale: 2 }).notNull(),
    /** Dasar komisi (nilai faktur sebelum PPN) — kosong untuk jam/sesi/borongan */
    baseAmount: money('base_amount'),
    amount: money('amount').notNull(),
    description: text('description'),
    /** PENDING → APPROVED | REJECTED; APPROVED → VOID (sebelum dibayar) */
    status: text('status').$type<'PENDING' | 'APPROVED' | 'REJECTED' | 'VOID'>().notNull().default('PENDING'),
    createdById: uuid('created_by_id').notNull(),
    decidedById: uuid('decided_by_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    /** Penggajian yang memuat catatan ini (kosong = belum digaji) */
    runId: uuid('run_id').references(() => payrollRuns.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('service_work_emp_date_idx').on(t.tenantId, t.employeeId, t.workDate),
    index('service_work_status_idx').on(t.tenantId, t.status, t.runId),
    uniqueIndex('service_work_commission_uq').on(t.tenantId, t.invoiceId, t.employeeId).where(sql`invoice_id IS NOT NULL AND status IN ('PENDING','APPROVED')`),
  ],
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
    /** Riwayat perubahan metode (berlaku ke depan): from = bulan berlaku, accumulatedAt = akumulasi tepat sebelum bulan itu */
    methodChanges: jsonb('method_changes').$type<{ from: string; method: string; prevMethod: string; accumulatedAt: string }[]>().notNull().default(sql`'[]'::jsonb`),
    /** Metode unit produksi: kapasitas total (mis. 200000 km) dan satuannya */
    totalUnits: numeric('total_units', { precision: 18, scale: 4 }),
    unitLabel: text('unit_label'),
    /** Akumulasi penyusutan sebelum memakai SANSU (aset lama) */
    openingAccumulated: money('opening_accumulated').notNull().default('0'),
    /** Akumulasi penyusutan fiskal sebelum memakai SANSU */
    openingFiscalAccumulated: money('opening_fiscal_accumulated').notNull().default('0'),
    location: text('location'),
    /** Penanggung jawab aset (orang/divisi yang memegang) */
    custodian: text('custodian'),
    /** Pemeriksaan fisik terakhir: FOUND (ada) | DAMAGED (rusak) | MISSING (tidak ditemukan) */
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    verificationStatus: text('verification_status').$type<'FOUND' | 'DAMAGED' | 'MISSING'>(),
    verificationNote: text('verification_note'),
    notes: text('notes'),
    status: text('status').notNull().default('ACTIVE'),
    acquisitionJournalId: uuid('acquisition_journal_id'),
    /** Dibeli lewat faktur supplier */
    purchaseInvoiceId: uuid('purchase_invoice_id'),
    disposalDate: date('disposal_date'),
    disposalPrice: money('disposal_price'),
    disposalJournalId: uuid('disposal_journal_id'),
    createdAt: createdAt(),
    /** Cabang pemilik aset: penyusutan otomatis berlabel cabang ini */
    branchId: uuid('branch_id').references((): AnyPgColumn => branches.id),
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
  /** Pengimpor — pengesahan rekonsiliasi harus orang lain (pemisahan tugas) */
  importedById: uuid('imported_by_id'),
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
    /** Alasan diabaikan / catatan */
    note: text('note'),
  },
  (t) => [index('bank_lines_statement_idx').on(t.statementId), uniqueIndex('bank_lines_journal_line_uq').on(t.journalLineId)],
);

/** Pemakaian aset per bulan (metode unit produksi): dasar penyusutan bulan itu */
export const assetUsage = pgTable(
  'asset_usage',
  {
    id: id(),
    tenantId: tenantId(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => fixedAssets.id, { onDelete: 'cascade' }),
    period: text('period').notNull(),
    units: numeric('units', { precision: 18, scale: 4 }).notNull(),
    note: text('note'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('asset_usage_asset_period_uq').on(t.assetId, t.period)],
);

/** Baris buku tambahan untuk satu mutasi bank (pencocokan satu-ke-banyak); baris buku pertama tetap di bank_statement_lines.journal_line_id */
export const bankLineExtraMatches = pgTable(
  'bank_line_extra_matches',
  {
    id: id(),
    tenantId: tenantId(),
    lineId: uuid('line_id')
      .notNull()
      .references(() => bankStatementLines.id, { onDelete: 'cascade' }),
    journalLineId: uuid('journal_line_id')
      .notNull()
      .references(() => journalLines.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('bank_extra_matches_jl_uq').on(t.journalLineId), index('bank_extra_matches_line_idx').on(t.lineId)],
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
    /** Terakhir yang mengisi jumlah fisik (pemisahan penghitung dan pemosting selisih) */
    countedById: uuid('counted_by_id'),
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
    /** Perintah induk yang memakai hasil perintah ini (barang setengah jadi); kosong = perintah tingkat atas */
    parentOrderId: uuid('parent_order_id'),
    /** Nomor rencana (MRP) yang membuat perintah berjenjang ini */
    planNo: text('plan_no'),
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
  (t) => [uniqueIndex('production_orders_number_uq').on(t.tenantId, t.number), index('production_orders_status_idx').on(t.tenantId, t.status), index('production_orders_parent_idx').on(t.parentOrderId)],
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

// ---------- Anggaran ----------
export const budgets = pgTable(
  'budgets',
  {
    id: id(),
    tenantId: tenantId(),
    year: integer('year').notNull(),
    name: text('name').notNull(),
    /** DRAFT (bisa diubah) | APPROVED (terkunci; dibuka kembali hanya Pemilik/Admin dengan alasan) */
    status: text('status').$type<'DRAFT' | 'APPROVED'>().notNull().default('DRAFT'),
    /** Realisasi beban melebihi anggaran sampai tahun-ke-tanggal + persen ini → peringatan */
    tolerancePct: integer('tolerance_pct').notNull().default(10),
    createdById: uuid('created_by_id'),
    approvedById: uuid('approved_by_id'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('budgets_year_uq').on(t.tenantId, t.year)],
);

export const budgetLines = pgTable(
  'budget_lines',
  {
    id: id(),
    tenantId: tenantId(),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    month: integer('month').notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [uniqueIndex('budget_lines_uq').on(t.budgetId, t.accountId, t.month)],
);

export const budgetAlerts = pgTable(
  'budget_alerts',
  {
    id: id(),
    tenantId: tenantId(),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').notNull(),
    month: integer('month').notNull(),
    level: text('level').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('budget_alerts_uq').on(t.budgetId, t.accountId, t.month, t.level)],
);

/** Aturan kategori otomatis mutasi bank (mis. 'BIAYA ADMIN' → Beban Administrasi Bank) */
export const bankRules = pgTable('bank_rules', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  keyword: text('keyword').notNull(),
  direction: text('direction').$type<'IN' | 'OUT' | 'ANY'>().notNull().default('ANY'),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  /** Di atas nilai ini mutasi tetap diproses manual */
  maxAmount: money('max_amount').notNull().default('5000000'),
  isActive: boolean('is_active').notNull().default(true),
  createdById: uuid('created_by_id'),
  createdAt: createdAt(),
});

/** Pengesahan rekonsiliasi bank akhir bulan */
export const bankReconciliations = pgTable(
  'bank_reconciliations',
  {
    id: id(),
    tenantId: tenantId(),
    cashAccountId: uuid('cash_account_id')
      .notNull()
      .references(() => accounts.id),
    period: text('period').notNull(),
    bookBalance: money('book_balance').notNull(),
    signedById: uuid('signed_by_id').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
  },
  (t) => [uniqueIndex('bank_reconciliations_uq').on(t.cashAccountId, t.period)],
);

/** Kontrak harga pemasok / prinsipal: harga per satuan dasar untuk periode tertentu (maker-checker: PENDING → ACTIVE oleh orang lain) */
export const supplierPriceAgreements = pgTable(
  'supplier_price_agreements',
  {
    id: id(),
    tenantId: tenantId(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    /** Rupiah per satuan dasar (sebelum PPN) */
    price: money('price').notNull(),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to').notNull(),
    status: text('status').$type<'PENDING' | 'ACTIVE' | 'REJECTED' | 'ENDED'>().notNull().default('PENDING'),
    note: text('note'),
    createdById: uuid('created_by_id').notNull(),
    decidedById: uuid('decided_by_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
  },
  (t) => [index('spa_lookup_idx').on(t.tenantId, t.supplierId, t.productId, t.status)],
);

/** Templat shift: jam kerja, jumlah minimal petugas, dan tarif premi (kartu tarif satuan SHIFT) */
export const shiftTemplates = pgTable(
  'shift_templates',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    minStaff: integer('min_staff').notNull().default(1),
    premiumRateId: uuid('premium_rate_id').references(() => serviceRates.id),
    isActive: boolean('is_active').notNull().default(true),
    createdById: uuid('created_by_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('shift_templates_name_uq').on(t.tenantId, t.name)],
);

/** Penugasan pegawai ke shift pada tanggal tertentu (jadwal / roster) */
export const shiftAssignments = pgTable(
  'shift_assignments',
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    templateId: uuid('template_id')
      .notNull()
      .references(() => shiftTemplates.id),
    workDate: date('work_date').notNull(),
    createdById: uuid('created_by_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('shift_assignments_uq').on(t.employeeId, t.workDate, t.templateId), index('shift_assignments_date_idx').on(t.tenantId, t.workDate)],
);

// ---------- Utilitas (air, listrik, internet) ----------
export const utilityTariffs = pgTable(
  'utility_tariffs',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    serviceType: text('service_type').$type<'AIR' | 'LISTRIK' | 'INTERNET' | 'GAS' | 'TV_KABEL' | 'KEBERSIHAN'>().notNull(),
    unit: text('unit').notNull(),
    metered: boolean('metered').notNull().default(true),
    fixedFee: money('fixed_fee').notNull().default('0'),
    adminFee: money('admin_fee').notNull().default('0'),
    minUsage: numeric('min_usage', { precision: 18, scale: 4 }).notNull().default('0'),
    blocks: jsonb('blocks').$type<{ upTo: number | null; price: number }[]>().notNull().default([]),
    vatable: boolean('vatable').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdById: uuid('created_by_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('utility_tariffs_name_uq').on(t.tenantId, t.name)],
);

export const utilityConnections = pgTable(
  'utility_connections',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    tariffId: uuid('tariff_id')
      .notNull()
      .references(() => utilityTariffs.id),
    meterNo: text('meter_no'),
    address: text('address').notNull(),
    status: text('status').$type<'ACTIVE' | 'SUSPENDED' | 'DISCONNECTED'>().notNull().default('ACTIVE'),
    installedAt: date('installed_at').notNull(),
    initialReading: numeric('initial_reading', { precision: 18, scale: 4 }).notNull().default('0'),
    statusChangedById: uuid('status_changed_by_id'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }),
    statusNote: text('status_note'),
    createdById: uuid('created_by_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('utility_connections_number_uq').on(t.tenantId, t.number), index('utility_connections_customer_idx').on(t.tenantId, t.customerId)],
);

export const utilityBills = pgTable(
  'utility_bills',
  {
    id: id(),
    tenantId: tenantId(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => utilityConnections.id),
    period: text('period').notNull(),
    /** Kosong = penagihan sedang berjalan / tertahan (klaim periode agar tidak tertagih dua kali) */
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    usage: numeric('usage', { precision: 18, scale: 4 }),
    subtotal: money('subtotal').notNull(),
    lateFee: money('late_fee').notNull().default('0'),
    createdById: uuid('created_by_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('utility_bills_period_uq').on(t.connectionId, t.period), uniqueIndex('utility_bills_invoice_uq').on(t.invoiceId)],
);

export const utilityReadings = pgTable(
  'utility_readings',
  {
    id: id(),
    tenantId: tenantId(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => utilityConnections.id),
    period: text('period').notNull(),
    previous: numeric('previous', { precision: 18, scale: 4 }).notNull(),
    current: numeric('current', { precision: 18, scale: 4 }).notNull(),
    usage: numeric('usage', { precision: 18, scale: 4 }).notNull(),
    meterReplaced: boolean('meter_replaced').notNull().default(false),
    flags: text('flags').array().notNull().default(sql`'{}'`),
    status: text('status').$type<'ENTERED' | 'VERIFIED' | 'BILLED' | 'REJECTED'>().notNull().default('ENTERED'),
    note: text('note'),
    enteredById: uuid('entered_by_id').notNull(),
    enteredAt: timestamp('entered_at', { withTimezone: true }).notNull().defaultNow(),
    verifiedById: uuid('verified_by_id'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifyNote: text('verify_note'),
    billId: uuid('bill_id').references(() => utilityBills.id),
    source: text('source').$type<'MANUAL' | 'LAPANGAN' | 'IMPORT' | 'API'>().notNull().default('MANUAL'),
    lat: numeric('lat', { precision: 9, scale: 6 }),
    lng: numeric('lng', { precision: 9, scale: 6 }),
    photo: text('photo'),
  },
  (t) => [uniqueIndex('utility_readings_period_uq').on(t.connectionId, t.period).where(sql`status <> 'REJECTED'`), index('utility_readings_status_idx').on(t.tenantId, t.status, t.period)],
);

export const utilityLateFees = pgTable(
  'utility_late_fees',
  {
    id: id(),
    tenantId: tenantId(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    billId: uuid('bill_id')
      .notNull()
      .references(() => utilityBills.id),
    amount: money('amount').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('utility_late_fees_invoice_uq').on(t.invoiceId)],
);

/** Kunci API untuk alat/gateway meter yang mengirim angka meter; hanya hash yang disimpan */
export const utilityIngestKeys = pgTable(
  'utility_ingest_keys',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('utility_ingest_keys_hash_uq').on(t.keyHash)],
);

/** Setoran harian kas loket: petugas menyetor total penerimaan tunainya, dikonfirmasi orang lain */
export const utilityRemittances = pgTable(
  'utility_remittances',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date').notNull(),
    collectorId: uuid('collector_id').notNull(),
    expected: money('expected').notNull(),
    counted: money('counted').notNull(),
    difference: money('difference').notNull(),
    receiptCount: integer('receipt_count').notNull(),
    status: text('status').$type<'SUBMITTED' | 'CONFIRMED' | 'DISPUTED'>().notNull().default('SUBMITTED'),
    note: text('note'),
    decidedById: uuid('decided_by_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    depositAccountId: uuid('deposit_account_id').references(() => accounts.id),
    journalId: uuid('journal_id').references(() => journalEntries.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('utility_remittances_number_uq').on(t.tenantId, t.number)],
);

/** Pembayaran tagihan utilitas yang diterima di loket (menunggu disetor) */
export const utilityCounterReceipts = pgTable(
  'utility_counter_receipts',
  {
    id: id(),
    tenantId: tenantId(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    collectorId: uuid('collector_id').notNull(),
    amount: money('amount').notNull(),
    /** CASH ikut setoran harian; TRANSFER/QRIS langsung masuk bank sehingga tidak disetor */
    method: text('method').$type<'CASH' | 'TRANSFER'>().notNull().default('CASH'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    remittanceId: uuid('remittance_id').references(() => utilityRemittances.id),
  },
  (t) => [uniqueIndex('utility_counter_receipts_payment_uq').on(t.paymentId)],
);
