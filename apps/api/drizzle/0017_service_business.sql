CREATE TABLE "customer_deposits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"customer_id" uuid NOT NULL,
	"project_id" uuid,
	"method" text DEFAULT 'TRANSFER' NOT NULL,
	"cash_account_id" uuid,
	"amount" numeric(18, 2) NOT NULL,
	"dpp" numeric(18, 2) NOT NULL,
	"tax_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"applied_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"description" text,
	"journal_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposit_applications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"deposit_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"dpp" numeric(18, 2) NOT NULL,
	"tax_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"contract_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"start_date" date,
	"end_date" date,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" text NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"unit" text DEFAULT 'Paket' NOT NULL,
	"price" numeric(18, 2) NOT NULL,
	"line_total" numeric(18, 2) NOT NULL,
	"account_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "kind" text DEFAULT 'GOODS' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "term_label" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "withholding_type" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "withholding_rate" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "withholding_base" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "withholding_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "withholding_slip_no" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "withholding_slip_date" date;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "deposit_applied" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_deposits" ADD CONSTRAINT "customer_deposits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_deposits" ADD CONSTRAINT "customer_deposits_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_deposits" ADD CONSTRAINT "customer_deposits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_applications" ADD CONSTRAINT "deposit_applications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_applications" ADD CONSTRAINT "deposit_applications_deposit_id_customer_deposits_id_fk" FOREIGN KEY ("deposit_id") REFERENCES "public"."customer_deposits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_applications" ADD CONSTRAINT "deposit_applications_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_invoice_lines" ADD CONSTRAINT "service_invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_invoice_lines" ADD CONSTRAINT "service_invoice_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_deposits_number_uq" ON "customer_deposits" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "customer_deposits_customer_idx" ON "customer_deposits" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_code_uq" ON "projects" USING btree ("tenant_id","code");