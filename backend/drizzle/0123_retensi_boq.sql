-- Kontraktor: retensi (tagihan terpisah yang jatuh tempo setelah masa pemeliharaan) dan BoQ/RAB per proyek
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "retention_pct" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "retention_days" integer DEFAULT 180 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "retention_of_invoice_id" uuid REFERENCES "invoices"("id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_retention_of_idx" ON "invoices" ("retention_of_invoice_id") WHERE "retention_of_invoice_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_boq_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
	"line_no" integer NOT NULL,
	"code" text,
	"description" text NOT NULL,
	"unit" text NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"unit_price" numeric(18, 2) NOT NULL,
	"completed_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_boq_items_project_idx" ON "project_boq_items" ("project_id","line_no");--> statement-breakpoint
ALTER TABLE "project_boq_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "project_boq_items" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
