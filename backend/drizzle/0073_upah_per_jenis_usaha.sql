-- Upah kerja untuk semua jenis usaha: satuan baru (shift, per hasil) dan kaitan ke perintah produksi
ALTER TABLE "service_work_entries" ADD COLUMN IF NOT EXISTS "production_order_id" uuid REFERENCES "production_orders"("id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_work_entries_prod_idx" ON "service_work_entries" ("production_order_id") WHERE production_order_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "service_rates" DROP CONSTRAINT IF EXISTS "service_rates_unit_check";--> statement-breakpoint
ALTER TABLE "service_rates" ADD CONSTRAINT "service_rates_unit_check" CHECK ("unit" IN ('HOUR','SESSION','JOB','PERCENT','SHIFT','PIECE'));--> statement-breakpoint
ALTER TABLE "service_work_entries" DROP CONSTRAINT IF EXISTS "service_work_entries_unit_check";--> statement-breakpoint
ALTER TABLE "service_work_entries" ADD CONSTRAINT "service_work_entries_unit_check" CHECK ("unit" IN ('HOUR','SESSION','JOB','PERCENT','SHIFT','PIECE'));--> statement-breakpoint
SELECT sansu_install_tenant_guards();
