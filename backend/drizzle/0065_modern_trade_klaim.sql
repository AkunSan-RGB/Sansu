-- Modern trade: nomor PO outlet, syarat dagang (rebate/listing fee), klaim promo ke prinsipal
ALTER TABLE "customers" ADD COLUMN "require_po" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "customer_po_no" text;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "promo_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "is_bonus" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "promos" ADD COLUMN "funded_supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "promos" ADD COLUMN "funded_pct" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "promos" ADD CONSTRAINT "promos_funded_chk" CHECK ("funded_pct" >= 0 AND "funded_pct" <= 100 AND ("funded_pct" = 0 OR "funded_supplier_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "promos" ADD CONSTRAINT "promos_funded_supplier_id_suppliers_id_fk" FOREIGN KEY ("funded_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_orders_customer_po_uq" ON "sales_orders" USING btree ("tenant_id","customer_id","customer_po_no") WHERE customer_po_no IS NOT NULL AND status <> 'CANCELLED';--> statement-breakpoint
CREATE TABLE "trade_terms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"value" numeric(18, 4) NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "trade_accruals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"term_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"period" text NOT NULL,
	"base_amount" numeric(18, 2) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"settled_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'ACCRUED' NOT NULL,
	"accrual_journal_id" uuid,
	"accrued_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "principal_claims" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"period" text NOT NULL,
	"claimed_amount" numeric(18, 2) NOT NULL,
	"approved_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"principal_ref" text,
	"approval_journal_id" uuid,
	"payment_journal_id" uuid,
	"cash_account_id" uuid,
	"created_by_id" uuid,
	"decided_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "principal_claim_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"promo_id" uuid,
	"kind" text NOT NULL,
	"invoice_number" text,
	"description" text NOT NULL,
	"base_value" numeric(18, 2) NOT NULL,
	"funded_pct" numeric(5, 2) NOT NULL,
	"amount" numeric(18, 2) NOT NULL
);--> statement-breakpoint
ALTER TABLE "trade_terms" ADD CONSTRAINT "trade_terms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_terms" ADD CONSTRAINT "trade_terms_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_terms" ADD CONSTRAINT "trade_terms_chk" CHECK ("kind" IN ('PCT_SALES', 'FIXED_MONTHLY') AND "value" >= 0 AND ("kind" <> 'PCT_SALES' OR "value" <= 100));--> statement-breakpoint
ALTER TABLE "trade_accruals" ADD CONSTRAINT "trade_accruals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_accruals" ADD CONSTRAINT "trade_accruals_term_id_trade_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."trade_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_accruals" ADD CONSTRAINT "trade_accruals_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_accruals" ADD CONSTRAINT "trade_accruals_chk" CHECK ("amount" > 0 AND "settled_amount" >= 0 AND "settled_amount" <= "amount" AND "status" IN ('ACCRUED', 'SETTLED', 'VOID'));--> statement-breakpoint
ALTER TABLE "principal_claims" ADD CONSTRAINT "principal_claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principal_claims" ADD CONSTRAINT "principal_claims_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principal_claims" ADD CONSTRAINT "principal_claims_chk" CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'PAID', 'REJECTED') AND "approved_amount" <= "claimed_amount");--> statement-breakpoint
ALTER TABLE "principal_claim_lines" ADD CONSTRAINT "principal_claim_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principal_claim_lines" ADD CONSTRAINT "principal_claim_lines_claim_id_principal_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."principal_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_accruals_uq" ON "trade_accruals" USING btree ("term_id","period") WHERE status <> 'VOID';--> statement-breakpoint
CREATE UNIQUE INDEX "trade_accruals_number_uq" ON "trade_accruals" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "principal_claims_number_uq" ON "principal_claims" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "principal_claim_lines_uq" ON "principal_claim_lines" USING btree ("order_line_id");--> statement-breakpoint
ALTER TABLE "trade_terms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "trade_terms" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "trade_accruals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "trade_accruals" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "principal_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "principal_claims" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "principal_claim_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "principal_claim_lines" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
