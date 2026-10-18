-- Metode penyusutan unit produksi: total unit aset + catatan pemakaian per bulan
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "total_units" numeric(18,4);--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "unit_label" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_usage" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"asset_id" uuid NOT NULL REFERENCES "fixed_assets"("id") ON DELETE CASCADE,
	"period" text NOT NULL,
	"units" numeric(18,4) NOT NULL,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_usage_asset_period_uq" ON "asset_usage" ("asset_id", "period");--> statement-breakpoint
ALTER TABLE "asset_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "asset_usage" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
