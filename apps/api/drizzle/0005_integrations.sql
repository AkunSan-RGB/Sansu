CREATE TABLE "bank_statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"balance" numeric(18, 2),
	"status" text DEFAULT 'UNMATCHED' NOT NULL,
	"journal_line_id" uuid,
	"journal_id" uuid,
	"matched_by" text
);
--> statement-breakpoint
CREATE TABLE "bank_statements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cash_account_id" uuid NOT NULL,
	"file_name" text,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"opening_balance" numeric(18, 2),
	"closing_balance" numeric(18, 2),
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"order_no" text NOT NULL,
	"date" date NOT NULL,
	"invoice_id" uuid,
	"total" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"type" text NOT NULL,
	"period" text NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"vat_out" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_in" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cash_account_id" uuid,
	"billing_code" text,
	"ntpn" text,
	"notes" text,
	"journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ALTER COLUMN "warehouse_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "purchase_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD COLUMN "line_type" text DEFAULT 'PRODUCT' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD COLUMN "asset_category_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD COLUMN "asset_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "kind" text DEFAULT 'GOODS' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "withholding_type" text;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "withholding_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statement_id_bank_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_journal_line_id_journal_lines_id_fk" FOREIGN KEY ("journal_line_id") REFERENCES "public"."journal_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_cash_account_id_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_orders" ADD CONSTRAINT "marketplace_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_orders" ADD CONSTRAINT "marketplace_orders_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_payments" ADD CONSTRAINT "tax_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_payments" ADD CONSTRAINT "tax_payments_cash_account_id_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_lines_statement_idx" ON "bank_statement_lines" USING btree ("statement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_lines_journal_line_uq" ON "bank_statement_lines" USING btree ("journal_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_orders_uq" ON "marketplace_orders" USING btree ("tenant_id","channel","order_no");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_payments_number_uq" ON "tax_payments" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "tax_payments_period_idx" ON "tax_payments" USING btree ("tenant_id","type","period");--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_asset_category_id_asset_categories_id_fk" FOREIGN KEY ("asset_category_id") REFERENCES "public"."asset_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE no action ON UPDATE no action;