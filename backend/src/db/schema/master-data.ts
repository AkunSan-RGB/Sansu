// Skema database — master-data
import { relations, sql } from 'drizzle-orm';
import { boolean, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { createdAt, encryptedText, id, money, qty } from './columns';
import { branches, tenantId } from './tenancy';
import { priceLists } from './pricing';
import { purchaseInvoices } from './purchasing';

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
    /** Gudang karantina: hasil produksi yang wajib QC menunggu di sini; stoknya tidak bisa dijual/dipakai sebelum lolos QC */
    isQuarantine: boolean('is_quarantine').notNull().default(false),
    /** Lokasi rak aktif: stok gudang ini juga dicatat per rak (lihat modules/inventory/bins.ts); mati = perilaku lama */
    binsEnabled: boolean('bins_enabled').notNull().default(false),
    /** Daftar harga toko: kasir di gudang ini memakai harga daftar ini (bila pelanggan tidak punya daftar sendiri); kosong = harga jual master */
    priceListId: uuid('price_list_id').references((): AnyPgColumn => priceLists.id),
  },
  (t) => [
    uniqueIndex('warehouses_code_uq').on(t.tenantId, t.code),
    uniqueIndex('warehouses_consignee_uq').on(t.tenantId, t.consigneeCustomerId).where(sql`kind = 'CONSIGNMENT'`),
    uniqueIndex('warehouses_van_user_uq').on(t.tenantId, t.vanUserId).where(sql`kind = 'VAN'`),
  ],
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
    /** Hasil produksi barang ini wajib diinspeksi QC (masuk karantina dulu) */
    qcRequired: boolean('qc_required').notNull().default(false),
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

export const productsRelations = relations(products, ({ many }) => ({ uoms: many(productUoms) }));

export const productUomsRelations = relations(productUoms, ({ one }) => ({
  product: one(products, { fields: [productUoms.productId], references: [products.id] }),
}));

export const suppliersRelations = relations(suppliers, ({ many }) => ({ purchaseInvoices: many(purchaseInvoices) }));

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
