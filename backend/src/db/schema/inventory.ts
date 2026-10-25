// Skema database — inventory
import { relations, sql } from 'drizzle-orm';
import { boolean, date, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenantId, users } from './tenancy';
import { products, warehouses } from './master-data';
import { createdAt, id, money, qty } from './columns';
import { stockMoveTypeEnum } from './enums';

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

export const stockBalancesRelations = relations(stockBalances, ({ one }) => ({
  product: one(products, { fields: [stockBalances.productId], references: [products.id] }),
  warehouse: one(warehouses, { fields: [stockBalances.warehouseId], references: [warehouses.id] }),
}));

export const stockMovesRelations = relations(stockMoves, ({ one }) => ({
  product: one(products, { fields: [stockMoves.productId], references: [products.id] }),
  warehouse: one(warehouses, { fields: [stockMoves.warehouseId], references: [warehouses.id] }),
}));

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
    /** Opname satu rak (gudang berrak); kosong = opname seluruh gudang */
    binId: uuid('bin_id'),
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
