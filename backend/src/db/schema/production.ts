// Skema database — production
import { boolean, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, money, qty } from './columns';
import { tenantId } from './tenancy';
import { products, warehouses } from './master-data';

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
    /** Nomor versi resep; naik 1 tiap resep diubah (versi lama tersimpan di bom_revisions) */
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('boms_code_uq').on(t.tenantId, t.code)],
);

/** Isi resep pada satu versi (header dan bahan), disimpan sebelum resep diubah agar produksi lama dapat ditelusuri ke resep yang dipakainya */
export interface BomSnapshot {
  name: string;
  productId: string;
  outputQty: string;
  laborCost: string;
  overheadCost: string;
  notes: string | null;
  isActive: boolean;
  lines: { productId: string; qty: string }[];
}

/** Riwayat versi resep: satu baris per versi yang sudah digantikan (versi aktif ada di boms) */
export const bomRevisions = pgTable(
  'bom_revisions',
  {
    id: id(),
    tenantId: tenantId(),
    bomId: uuid('bom_id')
      .notNull()
      .references(() => boms.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').$type<BomSnapshot>().notNull(),
    /** Alasan perubahan yang menggantikan versi ini */
    reason: text('reason'),
    /** Saat versi ini digantikan */
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('bom_revisions_version_uq').on(t.bomId, t.version)],
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
    /** Versi resep saat perintah dibuat (kosong untuk perintah lama sebelum ada versi) */
    bomVersion: integer('bom_version'),
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
