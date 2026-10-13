-- Kontrol aset tetap: penanggung jawab dan pemeriksaan fisik (stok opname aset)
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "custodian" text;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "last_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "verification_status" text;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "verification_note" text;
