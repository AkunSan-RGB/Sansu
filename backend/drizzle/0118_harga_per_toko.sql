-- Ritel: daftar harga per toko (gudang). Kasir di toko ini memakai harga daftar itu (bila pelanggan tidak punya daftar sendiri) dan promo aktif.
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "price_list_id" uuid REFERENCES "price_lists"("id");
