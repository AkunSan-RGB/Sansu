CREATE TABLE IF NOT EXISTS "billing_rates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"employee_id" uuid REFERENCES "employees"("id"),
	"project_id" uuid REFERENCES "projects"("id"),
	"rate" numeric(18, 2) NOT NULL,
	"valid_from" date NOT NULL,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_rates_lookup_idx" ON "billing_rates" ("tenant_id", "project_id", "employee_id", "valid_from");--> statement-breakpoint
ALTER TABLE "billing_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "billing_rates" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"employee_id" uuid NOT NULL REFERENCES "employees"("id"),
	"project_id" uuid REFERENCES "projects"("id"),
	"customer_id" uuid NOT NULL REFERENCES "customers"("id"),
	"work_date" date NOT NULL,
	"hours" numeric(5, 2) NOT NULL,
	"description" text NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"rate" numeric(18, 2),
	"rate_note" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"invoice_id" uuid REFERENCES "invoices"("id"),
	"booking_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_hours_chk" CHECK ("hours" > 0 AND "hours" <= 16)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_emp_date_idx" ON "time_entries" ("tenant_id", "employee_id", "work_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_status_idx" ON "time_entries" ("tenant_id", "status", "customer_id");--> statement-breakpoint
ALTER TABLE "time_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "time_entries" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduling_resources" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"employee_id" uuid REFERENCES "employees"("id"),
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scheduling_resources_name_uq" ON "scheduling_resources" ("tenant_id", lower("name"));--> statement-breakpoint
ALTER TABLE "scheduling_resources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "scheduling_resources" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resource_bookings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"resource_id" uuid NOT NULL REFERENCES "scheduling_resources"("id"),
	"project_id" uuid REFERENCES "projects"("id"),
	"customer_id" uuid REFERENCES "customers"("id"),
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'BOOKED' NOT NULL,
	"note" text,
	"cancel_reason" text,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_bookings_range_chk" CHECK ("ends_at" > "starts_at")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_bookings_range_idx" ON "resource_bookings" ("tenant_id", "resource_id", "starts_at") WHERE status = 'BOOKED';--> statement-breakpoint
ALTER TABLE "resource_bookings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "resource_bookings" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
