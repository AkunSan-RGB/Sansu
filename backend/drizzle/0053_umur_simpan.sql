-- Umur simpan produk (hari): hasil produksi otomatis mendapat lot dengan tanggal kedaluwarsa
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "shelf_life_days" integer;
