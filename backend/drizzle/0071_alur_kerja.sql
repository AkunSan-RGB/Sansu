-- Alur kerja operasional per jenis usaha: kasus (satu proses dari awal sampai selesai), dokumen terkait, dan riwayat tahap
CREATE TABLE IF NOT EXISTS "workflow_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"pipeline" text NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"stage" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL CHECK ("status" IN ('ACTIVE','DONE','CANCELLED')),
	"customer_id" uuid REFERENCES "customers"("id"),
	"supplier_id" uuid REFERENCES "suppliers"("id"),
	"amount" numeric(18,2) DEFAULT '0' NOT NULL,
	"due_date" date,
	"created_by_id" uuid NOT NULL,
	"stage_entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stage_entered_by_id" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_cases_number_uq" ON "workflow_cases" ("tenant_id","number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_cases_pipeline_idx" ON "workflow_cases" ("tenant_id","pipeline","status","stage");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"case_id" uuid NOT NULL REFERENCES "workflow_cases"("id") ON DELETE CASCADE,
	"link_type" text NOT NULL,
	"doc_id" uuid NOT NULL,
	"doc_number" text NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_links_doc_uq" ON "workflow_links" ("tenant_id","link_type","doc_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_links_case_idx" ON "workflow_links" ("case_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"case_id" uuid NOT NULL REFERENCES "workflow_cases"("id") ON DELETE CASCADE,
	"kind" text NOT NULL,
	"from_stage" text,
	"to_stage" text,
	"note" text,
	"by_id" uuid,
	"auto" boolean DEFAULT false NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_events_case_idx" ON "workflow_events" ("case_id","id");--> statement-breakpoint
ALTER TABLE "workflow_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "workflow_cases" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "workflow_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "workflow_links" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "workflow_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "workflow_events" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
