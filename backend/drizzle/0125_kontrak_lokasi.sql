-- Kontrak per lokasi (kebersihan/keamanan/alih daya): pos jaga dengan jumlah petugas, jadwal jaga harian, tagihan bulanan per kontrak
CREATE TABLE IF NOT EXISTS "site_contracts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"customer_id" uuid NOT NULL REFERENCES "customers"("id"),
	"site_name" text NOT NULL,
	"title" text NOT NULL,
	"with_vat" boolean,
	"start_date" date NOT NULL,
	"end_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_contracts_customer_idx" ON "site_contracts" ("customer_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_posts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"contract_id" uuid NOT NULL REFERENCES "site_contracts"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	"headcount" integer NOT NULL,
	"monthly_rate" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_posts_contract_idx" ON "site_posts" ("contract_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_duty" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"post_id" uuid NOT NULL REFERENCES "site_posts"("id") ON DELETE CASCADE,
	"employee_id" uuid NOT NULL REFERENCES "employees"("id"),
	"duty_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "site_duty_employee_day_uq" ON "site_duty" ("employee_id","duty_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_duty_post_day_idx" ON "site_duty" ("post_id","duty_date");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_contract_invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"contract_id" uuid NOT NULL REFERENCES "site_contracts"("id"),
	"period" text NOT NULL,
	"invoice_id" uuid NOT NULL REFERENCES "invoices"("id"),
	"shortfall_head_days" numeric(10, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "site_contract_invoices_uq" ON "site_contract_invoices" ("contract_id","period");--> statement-breakpoint
ALTER TABLE "site_contracts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "site_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "site_duty" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "site_contract_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "site_contracts" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY tenant_isolation ON "site_posts" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY tenant_isolation ON "site_duty" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY tenant_isolation ON "site_contract_invoices" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
