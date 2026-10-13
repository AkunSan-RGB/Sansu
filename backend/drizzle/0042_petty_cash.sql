-- Kas kecil dengan sistem dana tetap (imprest): dana, bukti kas kecil, pengisian kembali
CREATE TABLE "petty_cash_funds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"funding_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"custodian_name" text NOT NULL,
	"imprest_amount" numeric(18, 2) NOT NULL,
	"max_voucher" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "petty_cash_replenishments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fund_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"voucher_count" integer NOT NULL,
	"cash_transaction_id" uuid,
	"requested_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "petty_cash_vouchers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fund_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"payee" text NOT NULL,
	"description" text NOT NULL,
	"expense_account_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"receipt_ref" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"cash_transaction_id" uuid,
	"replenishment_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "petty_cash_funds" ADD CONSTRAINT "petty_cash_funds_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id");--> statement-breakpoint
ALTER TABLE "petty_cash_funds" ADD CONSTRAINT "petty_cash_funds_funding_account_id_accounts_id_fk" FOREIGN KEY ("funding_account_id") REFERENCES "public"."accounts"("id");--> statement-breakpoint
ALTER TABLE "petty_cash_replenishments" ADD CONSTRAINT "petty_cash_replenishments_fund_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."petty_cash_funds"("id");--> statement-breakpoint
ALTER TABLE "petty_cash_vouchers" ADD CONSTRAINT "petty_cash_vouchers_fund_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."petty_cash_funds"("id");--> statement-breakpoint
ALTER TABLE "petty_cash_vouchers" ADD CONSTRAINT "petty_cash_vouchers_expense_account_id_accounts_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."accounts"("id");--> statement-breakpoint
CREATE UNIQUE INDEX "petty_cash_funds_account_uq" ON "petty_cash_funds" USING btree ("tenant_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "petty_cash_vouchers_number_uq" ON "petty_cash_vouchers" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "petty_cash_vouchers_fund_idx" ON "petty_cash_vouchers" USING btree ("fund_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "petty_cash_replenishments_number_uq" ON "petty_cash_replenishments" USING btree ("tenant_id","number");--> statement-breakpoint
-- Row-level security sama seperti tabel bertenant lainnya (migrasi 0038 hanya mencakup tabel yang ada saat itu)
ALTER TABLE "petty_cash_funds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "petty_cash_vouchers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "petty_cash_replenishments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "petty_cash_funds" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY tenant_isolation ON "petty_cash_vouchers" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY tenant_isolation ON "petty_cash_replenishments" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
