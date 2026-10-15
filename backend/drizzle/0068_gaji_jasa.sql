-- Gaji usaha jasa: kartu tarif + catatan kerja (jam/sesi/borongan/komisi faktur) yang disetujui lalu masuk slip gaji
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "service_income" numeric(18,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"name" text NOT NULL,
	"unit" text NOT NULL CHECK ("unit" IN ('HOUR','SESSION','JOB','PERCENT')),
	"rate" numeric(18,2) NOT NULL CHECK ("rate" > 0),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_rates_name_uq" ON "service_rates" ("tenant_id","name");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_work_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"employee_id" uuid NOT NULL REFERENCES "employees"("id"),
	"rate_id" uuid NOT NULL REFERENCES "service_rates"("id"),
	"unit" text NOT NULL CHECK ("unit" IN ('HOUR','SESSION','JOB','PERCENT')),
	"work_date" date NOT NULL,
	"project_id" uuid,
	"invoice_id" uuid REFERENCES "invoices"("id"),
	"quantity" numeric(12,2) NOT NULL CHECK ("quantity" > 0),
	"rate" numeric(18,2) NOT NULL,
	"base_amount" numeric(18,2),
	"amount" numeric(18,2) NOT NULL CHECK ("amount" >= 0),
	"description" text,
	"status" text DEFAULT 'PENDING' NOT NULL CHECK ("status" IN ('PENDING','APPROVED','REJECTED','VOID')),
	"created_by_id" uuid NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"run_id" uuid REFERENCES "payroll_runs"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_work_emp_date_idx" ON "service_work_entries" ("tenant_id","employee_id","work_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_work_status_idx" ON "service_work_entries" ("tenant_id","status","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_work_commission_uq" ON "service_work_entries" ("tenant_id","invoice_id","employee_id") WHERE invoice_id IS NOT NULL AND status IN ('PENDING','APPROVED');--> statement-breakpoint
ALTER TABLE "service_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "service_rates" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "service_work_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "service_work_entries" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
