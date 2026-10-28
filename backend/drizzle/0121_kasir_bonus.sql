-- Ritel: baris bonus barang dari promo di kasir (harga 0, stok dan HPP tercatat)
ALTER TABLE "pos_order_lines" ADD COLUMN IF NOT EXISTS "is_bonus" boolean DEFAULT false NOT NULL;
