-- Menu yang dibuat saat dipesan: kasir memotong bahan sesuai resep, bukan stok produk jadi
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "made_to_order" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_order_lines" ADD COLUMN IF NOT EXISTS "from_recipe" boolean DEFAULT false NOT NULL;
