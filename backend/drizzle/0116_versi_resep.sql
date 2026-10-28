-- Versi resep (BOM): nomor versi pada resep, riwayat versi yang digantikan, dan versi yang dipakai tiap perintah produksi
ALTER TABLE "boms" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "bom_version" integer;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bom_revisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"bom_id" uuid NOT NULL REFERENCES "boms"("id") ON DELETE CASCADE,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bom_revisions_version_uq" ON "bom_revisions" ("bom_id","version");--> statement-breakpoint
ALTER TABLE "bom_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "bom_revisions" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
