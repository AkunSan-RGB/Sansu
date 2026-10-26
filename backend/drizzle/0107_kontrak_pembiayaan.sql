-- Data induk kontrak pembiayaan: pinjaman, sewa pembiayaan, dan biaya dibayar di muka. Jadwal pokok/bunga/amortisasinya dihitung
-- dari syarat kontrak (bukan disimpan), lalu dibandingkan dengan buku besar di menu Rincian & perhitungan akun.
CREATE TABLE IF NOT EXISTS "financing_contracts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"counterparty" text,
	"account_id" uuid NOT NULL REFERENCES "accounts"("id"),
	"expense_account_id" uuid REFERENCES "accounts"("id"),
	"start_date" date NOT NULL,
	"term_months" integer NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"rate_pct" numeric(9, 4),
	"method" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financing_contracts_kind_ck" CHECK ("kind" IN ('LOAN', 'LEASE', 'PREPAID')),
	CONSTRAINT "financing_contracts_term_ck" CHECK ("term_months" BETWEEN 1 AND 600),
	CONSTRAINT "financing_contracts_amount_ck" CHECK ("amount" > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "financing_contracts_name_uq" ON "financing_contracts" ("tenant_id", "name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financing_contracts_account_idx" ON "financing_contracts" ("tenant_id", "account_id");--> statement-breakpoint
ALTER TABLE "financing_contracts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "financing_contracts" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
