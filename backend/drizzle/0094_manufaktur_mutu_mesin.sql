ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "is_quarantine" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "warehouses_quarantine_uq" ON "warehouses" ("tenant_id") WHERE is_quarantine;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "qc_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_centers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'MACHINE' NOT NULL,
	"labor_rate" numeric(18, 2) DEFAULT 0 NOT NULL,
	"overhead_rate" numeric(18, 2) DEFAULT 0 NOT NULL,
	"capacity_hours" numeric(5, 2) DEFAULT 8 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_centers_code_uq" ON "work_centers" ("tenant_id", lower("code"));--> statement-breakpoint
ALTER TABLE "work_centers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "work_centers" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_center_downtime" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"work_center_id" uuid NOT NULL REFERENCES "work_centers"("id"),
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_center_downtime_range_chk" CHECK ("ends_at" > "starts_at")
);--> statement-breakpoint
ALTER TABLE "work_center_downtime" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "work_center_downtime" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bom_operations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"bom_id" uuid NOT NULL REFERENCES "boms"("id") ON DELETE CASCADE,
	"sequence" integer NOT NULL,
	"name" text NOT NULL,
	"work_center_id" uuid NOT NULL REFERENCES "work_centers"("id"),
	"minutes_per_batch" numeric(10, 2) NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bom_operations_seq_uq" ON "bom_operations" ("bom_id", "sequence");--> statement-breakpoint
ALTER TABLE "bom_operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "bom_operations" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "production_order_operations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"order_id" uuid NOT NULL REFERENCES "production_orders"("id") ON DELETE CASCADE,
	"sequence" integer NOT NULL,
	"name" text NOT NULL,
	"work_center_id" uuid NOT NULL REFERENCES "work_centers"("id"),
	"planned_minutes" numeric(10, 2) NOT NULL,
	"actual_minutes" numeric(10, 2),
	"status" text DEFAULT 'PENDING' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"scheduled_start" timestamp with time zone,
	"scheduled_end" timestamp with time zone,
	"operator_employee_id" uuid REFERENCES "employees"("id"),
	"labor_cost" numeric(18, 2) DEFAULT 0 NOT NULL,
	"overhead_cost" numeric(18, 2) DEFAULT 0 NOT NULL,
	"note" text,
	"finished_by_id" uuid,
	CONSTRAINT "po_ops_sched_chk" CHECK ("scheduled_end" IS NULL OR "scheduled_start" IS NULL OR "scheduled_end" > "scheduled_start")
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "po_ops_seq_uq" ON "production_order_operations" ("order_id", "sequence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "po_ops_wc_sched_idx" ON "production_order_operations" ("tenant_id", "work_center_id", "scheduled_start") WHERE scheduled_start IS NOT NULL;--> statement-breakpoint
ALTER TABLE "production_order_operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "production_order_operations" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"product_id" uuid NOT NULL REFERENCES "products"("id"),
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "qc_plans_product_uq" ON "qc_plans" ("tenant_id", "product_id");--> statement-breakpoint
ALTER TABLE "qc_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "qc_plans" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_plan_params" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"plan_id" uuid NOT NULL REFERENCES "qc_plans"("id") ON DELETE CASCADE,
	"sequence" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"min_value" numeric(18, 4),
	"max_value" numeric(18, 4),
	"unit" text,
	"critical" boolean DEFAULT false NOT NULL
);--> statement-breakpoint
ALTER TABLE "qc_plan_params" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "qc_plan_params" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_inspections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"number" text NOT NULL,
	"order_id" uuid REFERENCES "production_orders"("id"),
	"product_id" uuid NOT NULL REFERENCES "products"("id"),
	"plan_id" uuid REFERENCES "qc_plans"("id"),
	"warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id"),
	"release_warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id"),
	"qty" numeric(18, 4) NOT NULL,
	"unit_cost" numeric(18, 4) NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"qty_pass" numeric(18, 4),
	"qty_fail" numeric(18, 4),
	"qty_scrapped" numeric(18, 4) DEFAULT 0 NOT NULL,
	"completed_by_id" uuid,
	"inspector_id" uuid,
	"decided_at" timestamp with time zone,
	"note" text,
	"scrap_journal_id" uuid REFERENCES "journal_entries"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "qc_inspections_number_uq" ON "qc_inspections" ("tenant_id", "number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "qc_inspections_order_uq" ON "qc_inspections" ("order_id") WHERE order_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "qc_inspections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "qc_inspections" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_inspection_results" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"inspection_id" uuid NOT NULL REFERENCES "qc_inspections"("id") ON DELETE CASCADE,
	"sequence" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"min_value" numeric(18, 4),
	"max_value" numeric(18, 4),
	"unit" text,
	"critical" boolean DEFAULT false NOT NULL,
	"value" numeric(18, 4),
	"passed" boolean
);--> statement-breakpoint
ALTER TABLE "qc_inspection_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "qc_inspection_results" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
