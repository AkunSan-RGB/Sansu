// Skema database — pricing
import { sql } from 'drizzle-orm';
import { boolean, date, index, numeric, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, qty } from './columns';
import { tenantId } from './tenancy';
import { products } from './master-data';

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
