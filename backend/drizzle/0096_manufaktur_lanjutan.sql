ALTER TABLE "qc_inspections" ADD COLUMN IF NOT EXISTS "source_type" text DEFAULT 'PRODUCTION' NOT NULL;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD COLUMN IF NOT EXISTS "receipt_id" uuid REFERENCES "goods_receipts"("id");--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD COLUMN IF NOT EXISTS "parent_id" uuid REFERENCES "qc_inspections"("id");--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD COLUMN IF NOT EXISTS "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD COLUMN IF NOT EXISTS "qty_reworked" numeric(18, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD COLUMN IF NOT EXISTS "lot_no" text;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD COLUMN IF NOT EXISTS "expiry_date" date;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD COLUMN IF NOT EXISTS "sample_size" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD COLUMN IF NOT EXISTS "accept_defects" integer;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD COLUMN IF NOT EXISTS "sample_defects" integer;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_rework_chk" CHECK ("qty_reworked" >= 0);--> statement-breakpoint
DROP INDEX IF EXISTS "qc_inspections_order_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "qc_inspections_order_uq" ON "qc_inspections" ("order_id", "attempt") WHERE order_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qc_inspections_receipt_idx" ON "qc_inspections" ("tenant_id", "receipt_id") WHERE receipt_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "qc_plans" ADD COLUMN IF NOT EXISTS "sample_pct" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "qc_plans" ADD COLUMN IF NOT EXISTS "sample_min" integer;--> statement-breakpoint
ALTER TABLE "qc_plans" ADD COLUMN IF NOT EXISTS "sample_max" integer;--> statement-breakpoint
ALTER TABLE "qc_plans" ADD COLUMN IF NOT EXISTS "accept_defects" integer;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_attachments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"inspection_id" uuid NOT NULL REFERENCES "qc_inspections"("id") ON DELETE CASCADE,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"ref" text NOT NULL,
	"uploaded_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qc_attachments_insp_idx" ON "qc_attachments" ("inspection_id");--> statement-breakpoint
ALTER TABLE "qc_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "qc_attachments" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "production_order_operations" ADD COLUMN IF NOT EXISTS "off_shift" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_center_shifts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"work_center_id" uuid NOT NULL REFERENCES "work_centers"("id") ON DELETE CASCADE,
	"weekday" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	CONSTRAINT "work_center_shifts_chk" CHECK ("weekday" BETWEEN 1 AND 7 AND "start_minute" >= 0 AND "end_minute" <= 1440 AND "start_minute" < "end_minute")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_center_shifts_wc_idx" ON "work_center_shifts" ("tenant_id", "work_center_id", "weekday");--> statement-breakpoint
ALTER TABLE "work_center_shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "work_center_shifts" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
