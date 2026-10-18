-- Barcode produk dibuat sistem (internal) atau dari pabrikan (hasil scan, angka pemeriksa valid)
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "barcode_source" text CHECK ("barcode_source" IN ('GENERATED','MANUFACTURER'));--> statement-breakpoint
UPDATE "products" SET "barcode_source" = 'MANUFACTURER' WHERE "barcode" IS NOT NULL AND "barcode_source" IS NULL;--> statement-breakpoint
SELECT sansu_install_tenant_guards();
