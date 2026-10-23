ALTER TABLE "stock_counts" ADD COLUMN IF NOT EXISTS "bin_id" uuid REFERENCES "warehouse_bins"("id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_counts_bin_idx" ON "stock_counts" ("bin_id") WHERE "bin_id" IS NOT NULL;
