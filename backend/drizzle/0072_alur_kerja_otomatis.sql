-- Alur kerja otomatis: kunci kasus yang dibuka sistem (mis. restok produk tertentu) agar tidak ganda
ALTER TABLE "workflow_cases" ADD COLUMN IF NOT EXISTS "ref_key" text;--> statement-breakpoint
ALTER TABLE "workflow_cases" ADD COLUMN IF NOT EXISTS "auto_opened" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_cases_ref_uq" ON "workflow_cases" ("tenant_id","ref_key") WHERE ref_key IS NOT NULL AND status = 'ACTIVE';
