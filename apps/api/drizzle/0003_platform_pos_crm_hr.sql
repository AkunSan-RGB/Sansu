CREATE TYPE "public"."activity_type" AS ENUM('CALL', 'WHATSAPP', 'MEETING', 'EMAIL', 'TODO');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('HADIR', 'IZIN', 'SAKIT', 'CUTI', 'ALPA', 'LIBUR');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('OPEN', 'WON', 'LOST');--> statement-breakpoint
CREATE TYPE "public"."leave_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."leave_type" AS ENUM('ANNUAL', 'SICK', 'UNPAID', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."payroll_status" AS ENUM('DRAFT', 'POSTED', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."pos_payment_method" AS ENUM('CASH', 'QRIS', 'DEBIT', 'TRANSFER');--> statement-breakpoint
CREATE TYPE "public"."pos_session_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."quotation_status" AS ENUM('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'CASHIER';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'HR';--> statement-breakpoint
CREATE TABLE "attendances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" "attendance_status" NOT NULL,
	"check_in" text,
	"check_out" text,
	"overtime_hours" numeric(5, 2) DEFAULT '0' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "crm_activities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"type" "activity_type" NOT NULL,
	"summary" text NOT NULL,
	"due_date" date NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"result" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_stages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sequence" integer NOT NULL,
	"probability" integer DEFAULT 10 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"nik" text,
	"npwp" text,
	"ptkp" text DEFAULT 'TK/0' NOT NULL,
	"job_title" text,
	"department" text,
	"join_date" date NOT NULL,
	"birth_date" date,
	"phone" text,
	"email" text,
	"address" text,
	"bank_name" text,
	"bank_account" text,
	"base_salary" numeric(18, 2) DEFAULT '0' NOT NULL,
	"fixed_allowance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"daily_allowance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"bpjs_kes" boolean DEFAULT true NOT NULL,
	"bpjs_tk" boolean DEFAULT true NOT NULL,
	"bpjs_jp" boolean DEFAULT true NOT NULL,
	"annual_leave" integer DEFAULT 12 NOT NULL,
	"user_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"resign_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"customer_id" uuid,
	"contact_name" text,
	"company_name" text,
	"phone" text,
	"email" text,
	"source" text,
	"expected_revenue" numeric(18, 2) DEFAULT '0' NOT NULL,
	"probability" integer DEFAULT 10 NOT NULL,
	"stage_id" uuid NOT NULL,
	"owner_id" uuid,
	"status" "lead_status" DEFAULT 'OPEN' NOT NULL,
	"lost_reason" text,
	"expected_close_date" date,
	"notes" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" "leave_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" integer NOT NULL,
	"reason" text,
	"status" "leave_status" DEFAULT 'PENDING' NOT NULL,
	"decided_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"period" text NOT NULL,
	"pay_date" date NOT NULL,
	"status" "payroll_status" DEFAULT 'DRAFT' NOT NULL,
	"total_gross" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_employer_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_pph21" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_net" numeric(18, 2) DEFAULT '0' NOT NULL,
	"journal_id" uuid,
	"payment_journal_id" uuid,
	"cash_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_days" integer NOT NULL,
	"present_days" integer NOT NULL,
	"absent_days" integer DEFAULT 0 NOT NULL,
	"overtime_hours" numeric(6, 2) DEFAULT '0' NOT NULL,
	"base_salary" numeric(18, 2) NOT NULL,
	"fixed_allowance" numeric(18, 2) NOT NULL,
	"daily_allowance" numeric(18, 2) NOT NULL,
	"overtime_pay" numeric(18, 2) NOT NULL,
	"other_income" numeric(18, 2) DEFAULT '0' NOT NULL,
	"absence_deduction" numeric(18, 2) DEFAULT '0' NOT NULL,
	"gross_pay" numeric(18, 2) NOT NULL,
	"bpjs_kes_employee" numeric(18, 2) NOT NULL,
	"jht_employee" numeric(18, 2) NOT NULL,
	"jp_employee" numeric(18, 2) NOT NULL,
	"bpjs_kes_company" numeric(18, 2) NOT NULL,
	"jht_company" numeric(18, 2) NOT NULL,
	"jp_company" numeric(18, 2) NOT NULL,
	"jkk_company" numeric(18, 2) NOT NULL,
	"jkm_company" numeric(18, 2) NOT NULL,
	"taxable_gross" numeric(18, 2) NOT NULL,
	"ter_category" text NOT NULL,
	"ter_rate" numeric(5, 2) NOT NULL,
	"pph21" numeric(18, 2) NOT NULL,
	"other_deduction" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_pay" numeric(18, 2) NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "pos_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"uom" text NOT NULL,
	"uom_factor" numeric(18, 4) NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"price" numeric(18, 2) NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(18, 2) NOT NULL,
	"unit_cost" numeric(18, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"customer_id" uuid,
	"subtotal" numeric(18, 2) NOT NULL,
	"tax_amount" numeric(18, 2) NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"tendered" numeric(18, 2) NOT NULL,
	"change" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cogs_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"method" "pos_payment_method" NOT NULL,
	"amount" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"user_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"cash_account_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"status" "pos_session_status" DEFAULT 'OPEN' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"opening_cash" numeric(18, 2) DEFAULT '0' NOT NULL,
	"expected_cash" numeric(18, 2),
	"counted_cash" numeric(18, 2),
	"difference" numeric(18, 2),
	"notes" text,
	"close_journal_id" uuid
);
--> statement-breakpoint
CREATE TABLE "quotation_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"quotation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"uom" text NOT NULL,
	"uom_factor" numeric(18, 4) NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"price" numeric(18, 2) NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"valid_until" date NOT NULL,
	"customer_id" uuid NOT NULL,
	"lead_id" uuid,
	"warehouse_id" uuid NOT NULL,
	"status" "quotation_status" DEFAULT 'DRAFT' NOT NULL,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"terms" text,
	"sales_order_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_apps" (
	"tenant_id" uuid NOT NULL,
	"app_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_apps_tenant_id_app_key_pk" PRIMARY KEY("tenant_id","app_key")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_stages" ADD CONSTRAINT "crm_stages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_stage_id_crm_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."crm_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_cash_account_id_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_order_lines" ADD CONSTRAINT "pos_order_lines_order_id_pos_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."pos_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_order_lines" ADD CONSTRAINT "pos_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_session_id_pos_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."pos_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payments" ADD CONSTRAINT "pos_payments_order_id_pos_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."pos_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_cash_account_id_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_bank_account_id_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_apps" ADD CONSTRAINT "tenant_apps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendances_emp_date_uq" ON "attendances" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "attendances_tenant_date_idx" ON "attendances" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "crm_activities_due_idx" ON "crm_activities" USING btree ("tenant_id","done","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_code_uq" ON "employees" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "leads_tenant_stage_idx" ON "leads" USING btree ("tenant_id","status","stage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_period_uq" ON "payroll_runs" USING btree ("tenant_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_number_uq" ON "payroll_runs" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_run_emp_uq" ON "payslips" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_orders_number_uq" ON "pos_orders" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "pos_orders_session_idx" ON "pos_orders" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_sessions_number_uq" ON "pos_sessions" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_sessions_open_uq" ON "pos_sessions" USING btree ("user_id") WHERE status = 'OPEN';--> statement-breakpoint
CREATE UNIQUE INDEX "quotations_number_uq" ON "quotations" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "products_barcode_uq" ON "products" USING btree ("tenant_id","barcode") WHERE barcode IS NOT NULL;--> statement-breakpoint
-- Perusahaan yang sudah ada: aktifkan aplikasi bawaan
INSERT INTO "tenant_apps" ("tenant_id", "app_key")
SELECT t.id, a.k FROM "tenants" t CROSS JOIN (VALUES ('sales'), ('purchase'), ('inventory'), ('accounting'), ('cash')) AS a(k)
ON CONFLICT DO NOTHING;
