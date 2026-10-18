-- Utilitas: tarif bertingkat, sambungan pelanggan, catat meter (dicatat → diverifikasi orang lain), tagihan bulanan, denda keterlambatan
CREATE TABLE IF NOT EXISTS "utility_tariffs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"name" text NOT NULL,
	"service_type" text NOT NULL CHECK ("service_type" IN ('AIR','LISTRIK','INTERNET','GAS','TV_KABEL','KEBERSIHAN')),
	"unit" text NOT NULL,
	"metered" boolean DEFAULT true NOT NULL,
	"fixed_fee" numeric(18,2) DEFAULT 0 NOT NULL CHECK ("fixed_fee" >= 0),
	"admin_fee" numeric(18,2) DEFAULT 0 NOT NULL CHECK ("admin_fee" >= 0),
	"min_usage" numeric(18,4) DEFAULT 0 NOT NULL CHECK ("min_usage" >= 0),
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vatable" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_tariffs_name_uq" ON "utility_tariffs" ("tenant_id","name");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL REFERENCES "customers"("id"),
	"tariff_id" uuid NOT NULL REFERENCES "utility_tariffs"("id"),
	"meter_no" text,
	"address" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL CHECK ("status" IN ('ACTIVE','SUSPENDED','DISCONNECTED')),
	"installed_at" date NOT NULL,
	"initial_reading" numeric(18,4) DEFAULT 0 NOT NULL CHECK ("initial_reading" >= 0),
	"status_changed_by_id" uuid,
	"status_changed_at" timestamp with time zone,
	"status_note" text,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_connections_number_uq" ON "utility_connections" ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_connections_meter_uq" ON "utility_connections" ("tenant_id","meter_no") WHERE "meter_no" IS NOT NULL AND "status" <> 'DISCONNECTED';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_connections_customer_idx" ON "utility_connections" ("tenant_id","customer_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_bills" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"connection_id" uuid NOT NULL REFERENCES "utility_connections"("id"),
	"period" text NOT NULL CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	"invoice_id" uuid REFERENCES "invoices"("id"),
	"usage" numeric(18,4),
	"subtotal" numeric(18,2) NOT NULL,
	"late_fee" numeric(18,2) DEFAULT 0 NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_bills_period_uq" ON "utility_bills" ("connection_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_bills_invoice_uq" ON "utility_bills" ("invoice_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_readings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"connection_id" uuid NOT NULL REFERENCES "utility_connections"("id"),
	"period" text NOT NULL CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	"previous" numeric(18,4) NOT NULL CHECK ("previous" >= 0),
	"current" numeric(18,4) NOT NULL CHECK ("current" >= 0),
	"usage" numeric(18,4) NOT NULL CHECK ("usage" >= 0),
	"meter_replaced" boolean DEFAULT false NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'ENTERED' NOT NULL CHECK ("status" IN ('ENTERED','VERIFIED','BILLED','REJECTED')),
	"note" text,
	"entered_by_id" uuid NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_by_id" uuid,
	"verified_at" timestamp with time zone,
	"verify_note" text,
	"bill_id" uuid REFERENCES "utility_bills"("id")
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_readings_period_uq" ON "utility_readings" ("connection_id","period") WHERE "status" <> 'REJECTED';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_readings_status_idx" ON "utility_readings" ("tenant_id","status","period");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_late_fees" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"invoice_id" uuid NOT NULL REFERENCES "invoices"("id"),
	"bill_id" uuid NOT NULL REFERENCES "utility_bills"("id"),
	"amount" numeric(18,2) NOT NULL CHECK ("amount" > 0),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_late_fees_invoice_uq" ON "utility_late_fees" ("invoice_id");--> statement-breakpoint
ALTER TABLE "utility_tariffs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "utility_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "utility_bills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "utility_readings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "utility_late_fees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_tariffs" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_connections" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_bills" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_readings" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_late_fees" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
