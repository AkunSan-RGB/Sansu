-- Karyawan usaha jasa: status kepegawaian, kontrak, upah harian, verifikasi karyawan baru, persetujuan perubahan data sensitif
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "employment_type" text DEFAULT 'TETAP' NOT NULL CHECK ("employment_type" IN ('TETAP','KONTRAK','HARIAN','TENAGA_LEPAS','MAGANG','MITRA'));--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "contract_start" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "contract_end" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "daily_wage" numeric(18,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "verified" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "created_by_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "verified_by_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "verified_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"employee_id" uuid NOT NULL REFERENCES "employees"("id"),
	"changes" jsonb NOT NULL,
	"reason" text,
	"status" text DEFAULT 'PENDING' NOT NULL CHECK ("status" IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
	"requested_by_id" uuid NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employee_change_pending_uq" ON "employee_change_requests" ("employee_id") WHERE status = 'PENDING';--> statement-breakpoint
ALTER TABLE "employee_change_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "employee_change_requests" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
