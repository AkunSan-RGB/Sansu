-- Permintaan persetujuan dapat ditujukan ke satu penyetuju yang berwenang (dipilih pemohon); kosong = semua penyetuju
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "assigned_to_id" uuid REFERENCES "users"("id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_assigned_idx" ON "approval_requests" ("tenant_id","assigned_to_id") WHERE status = 'PENDING';--> statement-breakpoint
SELECT sansu_install_tenant_guards();
