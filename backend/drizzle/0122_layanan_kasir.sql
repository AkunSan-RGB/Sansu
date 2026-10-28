-- Jasa: layanan tanpa stok di kasir (bengkel, salon, klinik) dan petugas yang mengerjakan tiap baris
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "is_service" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_order_lines" ADD COLUMN IF NOT EXISTS "staff_id" uuid REFERENCES "employees"("id");
