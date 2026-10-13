-- Kontrol & otomatisasi bank: aturan kategori otomatis, pengesahan rekonsiliasi bulanan, jejak pengimpor & alasan abaikan
ALTER TABLE "bank_statement_lines" ADD COLUMN IF NOT EXISTS "note" text;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD COLUMN IF NOT EXISTS "imported_by_id" uuid;--> statement-breakpoint
CREATE TABLE "bank_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"keyword" text NOT NULL,
	"direction" text DEFAULT 'ANY' NOT NULL,
	"account_id" uuid NOT NULL,
	"max_amount" numeric(18, 2) DEFAULT '5000000' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "bank_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cash_account_id" uuid NOT NULL,
	"period" text NOT NULL,
	"book_balance" numeric(18, 2) NOT NULL,
	"signed_by_id" uuid NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text
);--> statement-breakpoint
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id");--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_account_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."accounts"("id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_reconciliations_uq" ON "bank_reconciliations" USING btree ("cash_account_id","period");--> statement-breakpoint
ALTER TABLE "bank_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "bank_rules" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY tenant_isolation ON "bank_reconciliations" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
