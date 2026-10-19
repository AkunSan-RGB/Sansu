ALTER TABLE "utility_readings" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "utility_readings" ADD COLUMN IF NOT EXISTS "lat" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "utility_readings" ADD COLUMN IF NOT EXISTS "lng" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "utility_readings" ADD COLUMN IF NOT EXISTS "photo" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_ingest_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"created_by_id" uuid NOT NULL REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_ingest_keys_hash_uq" ON "utility_ingest_keys" ("key_hash");--> statement-breakpoint
ALTER TABLE "utility_ingest_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_ingest_keys" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_remittances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"number" text NOT NULL,
	"date" date NOT NULL,
	"collector_id" uuid NOT NULL,
	"expected" numeric(18, 2) NOT NULL,
	"counted" numeric(18, 2) NOT NULL,
	"difference" numeric(18, 2) NOT NULL,
	"receipt_count" integer NOT NULL,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"note" text,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"deposit_account_id" uuid REFERENCES "accounts"("id"),
	"journal_id" uuid REFERENCES "journal_entries"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_remittances_number_uq" ON "utility_remittances" ("tenant_id", "number");--> statement-breakpoint
ALTER TABLE "utility_remittances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_remittances" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_counter_receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"payment_id" uuid NOT NULL REFERENCES "payments"("id"),
	"invoice_id" uuid NOT NULL REFERENCES "invoices"("id"),
	"collector_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"method" text DEFAULT 'CASH' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"remittance_id" uuid REFERENCES "utility_remittances"("id")
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_counter_receipts_payment_uq" ON "utility_counter_receipts" ("payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_counter_receipts_open_idx" ON "utility_counter_receipts" ("tenant_id", "collector_id") WHERE remittance_id IS NULL;--> statement-breakpoint
ALTER TABLE "utility_counter_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_counter_receipts" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
