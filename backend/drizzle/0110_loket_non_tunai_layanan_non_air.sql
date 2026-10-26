-- Utilitas air: loket penerimaan (beberapa lokasi), konfirmasi rekap harian per loket, dan katalog layanan non-air.
CREATE TABLE IF NOT EXISTS "utility_counters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"bank_account_id" uuid REFERENCES "accounts"("id"),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_counters_code_uq" ON "utility_counters" ("tenant_id", "code");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_counter_closings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"counter_id" uuid NOT NULL REFERENCES "utility_counters"("id"),
	"date" date NOT NULL,
	"receipt_count" integer NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'CONFIRMED' NOT NULL,
	"decided_by_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_counter_closings_day_uq" ON "utility_counter_closings" ("counter_id", "date");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_charges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"name" text NOT NULL,
	"default_price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"revenue_key" text NOT NULL,
	"vatable" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_charges_name_uq" ON "utility_charges" ("tenant_id", "name");--> statement-breakpoint
ALTER TABLE "utility_counter_receipts" ADD COLUMN IF NOT EXISTS "counter_id" uuid REFERENCES "utility_counters"("id");--> statement-breakpoint
ALTER TABLE "utility_counter_receipts" ADD COLUMN IF NOT EXISTS "channel" text;--> statement-breakpoint
ALTER TABLE "utility_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_counters" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "utility_counter_closings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_counter_closings" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "utility_charges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_charges" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
