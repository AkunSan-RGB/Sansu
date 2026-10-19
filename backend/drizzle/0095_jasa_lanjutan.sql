ALTER TABLE "scheduling_resources" ADD COLUMN IF NOT EXISTS "work_start" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduling_resources" ADD COLUMN IF NOT EXISTS "work_end" integer DEFAULT 17 NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduling_resources" ADD COLUMN IF NOT EXISTS "work_days" text DEFAULT '1,2,3,4,5,6' NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduling_resources" ADD CONSTRAINT "scheduling_resources_hours_chk" CHECK ("work_start" >= 0 AND "work_end" <= 24 AND "work_start" < "work_end");--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD COLUMN IF NOT EXISTS "series_id" uuid;--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD COLUMN IF NOT EXISTS "off_hours" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_bookings_series_idx" ON "resource_bookings" ("tenant_id", "series_id") WHERE series_id IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_timers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"employee_id" uuid NOT NULL REFERENCES "employees"("id"),
	"project_id" uuid REFERENCES "projects"("id"),
	"customer_id" uuid NOT NULL REFERENCES "customers"("id"),
	"description" text NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "time_timers_emp_uq" ON "time_timers" ("tenant_id", "employee_id");--> statement-breakpoint
ALTER TABLE "time_timers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "time_timers" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_retainers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"customer_id" uuid NOT NULL REFERENCES "customers"("id"),
	"project_id" uuid REFERENCES "projects"("id"),
	"title" text NOT NULL,
	"monthly_fee" numeric(18, 2) NOT NULL,
	"with_vat" boolean,
	"start_date" date NOT NULL,
	"end_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_retainers_fee_chk" CHECK ("monthly_fee" > 0)
);--> statement-breakpoint
ALTER TABLE "service_retainers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "service_retainers" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_retainer_invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"retainer_id" uuid NOT NULL REFERENCES "service_retainers"("id"),
	"period" text NOT NULL,
	"invoice_id" uuid NOT NULL REFERENCES "invoices"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_retainer_invoices_uq" ON "service_retainer_invoices" ("retainer_id", "period");--> statement-breakpoint
ALTER TABLE "service_retainer_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "service_retainer_invoices" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
