-- Snapshot laporan keuangan yang dibekukan saat ditandatangani: rekaman per tahun yang tidak boleh diubah atau dihapus,
-- sehingga angka yang ditandatangani tetap bisa dibuktikan dan dibandingkan dengan pembukuan setelahnya (jurnal susulan).
CREATE TABLE IF NOT EXISTS "report_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"year" integer NOT NULL,
	"version" integer NOT NULL,
	"signed_by_id" uuid NOT NULL,
	"signed_by_name" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"content_hash" text NOT NULL,
	"payload" jsonb NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "report_snapshots_version_uq" ON "report_snapshots" ("tenant_id", "year", "version");--> statement-breakpoint
ALTER TABLE "report_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "report_snapshots" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE OR REPLACE FUNCTION forbid_snapshot_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Penghapusan data perusahaan (hak penghapusan data / reset demo) memakai pengecualian yang sama dengan jurnal
  IF TG_OP = 'DELETE' AND current_setting('sansu.allow_journal_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Snapshot laporan yang sudah dibekukan tidak boleh diubah atau dihapus; bekukan versi baru bila perlu'
    USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint
CREATE TRIGGER report_snapshots_immutable BEFORE UPDATE OR DELETE ON report_snapshots FOR EACH ROW EXECUTE FUNCTION forbid_snapshot_change();--> statement-breakpoint
SELECT sansu_install_tenant_guards();
