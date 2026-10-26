-- Tagih bulanan berlatar: pekerjaan ratusan sampai puluhan ribu sambungan berjalan di server dengan bilah kemajuan
CREATE TABLE IF NOT EXISTS "utility_billing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"period" text NOT NULL,
	"status" text DEFAULT 'BERJALAN' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"billed_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"held" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_by_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_billing_jobs_running_uq" ON "utility_billing_jobs" ("tenant_id") WHERE status = 'BERJALAN';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_billing_jobs_tenant_idx" ON "utility_billing_jobs" ("tenant_id","started_at" DESC);--> statement-breakpoint
ALTER TABLE "utility_billing_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_billing_jobs" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
