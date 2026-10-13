-- Pengaman pencatatan jurnal: jadwal jurnal balik otomatis, serta larangan ganda di tingkat database
-- untuk jurnal penutup tahun dan jurnal berulang/penyesuaian terjadwal.
CREATE TABLE "scheduled_reversals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"journal_id" uuid NOT NULL,
	"reverse_on" date NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"reversal_journal_id" uuid,
	"last_error" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "scheduled_reversals" ADD CONSTRAINT "scheduled_reversals_journal_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journal_entries"("id");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_reversals_journal_uq" ON "scheduled_reversals" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "scheduled_reversals_due_idx" ON "scheduled_reversals" USING btree ("tenant_id","status","reverse_on");--> statement-breakpoint
ALTER TABLE "scheduled_reversals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "scheduled_reversals" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
-- Satu jurnal penutup per tahun per perusahaan (hanya dibuat bila data lama tidak melanggar, agar migrasi tidak gagal)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE source_type = 'CLOSING' GROUP BY tenant_id, source_id HAVING COUNT(*) > 1) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS journal_closing_once_uq ON journal_entries (tenant_id, source_id) WHERE source_type = 'CLOSING';
  END IF;
END $$;--> statement-breakpoint
-- Satu jurnal per templat berulang per tanggal: pemrosesan ganda ditolak database
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM journal_entries WHERE source_type IN ('RECURRING', 'ADJUSTMENT') AND source_id IS NOT NULL
    GROUP BY tenant_id, source_id, date HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS journal_recurring_once_uq ON journal_entries (tenant_id, source_id, date) WHERE source_type IN ('RECURRING', 'ADJUSTMENT') AND source_id IS NOT NULL;
  END IF;
END $$;
