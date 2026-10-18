-- Jadwal shift (roster): templat shift, penugasan pegawai per tanggal, dan premi shift otomatis dari kehadiran
CREATE TABLE IF NOT EXISTS "shift_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"name" text NOT NULL,
	"start_time" text NOT NULL CHECK ("start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	"end_time" text NOT NULL CHECK ("end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	"min_staff" integer DEFAULT 1 NOT NULL CHECK ("min_staff" >= 0),
	"premium_rate_id" uuid REFERENCES "service_rates"("id"),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shift_templates_name_uq" ON "shift_templates" ("tenant_id","name");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shift_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"employee_id" uuid NOT NULL REFERENCES "employees"("id"),
	"template_id" uuid NOT NULL REFERENCES "shift_templates"("id"),
	"work_date" date NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shift_assignments_uq" ON "shift_assignments" ("employee_id","work_date","template_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shift_assignments_date_idx" ON "shift_assignments" ("tenant_id","work_date");--> statement-breakpoint
ALTER TABLE "service_work_entries" ADD COLUMN IF NOT EXISTS "shift_assignment_id" uuid REFERENCES "shift_assignments"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_work_entries_shift_uq" ON "service_work_entries" ("shift_assignment_id") WHERE shift_assignment_id IS NOT NULL AND status IN ('PENDING','APPROVED');--> statement-breakpoint
ALTER TABLE "shift_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "shift_templates" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "shift_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "shift_assignments" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
