-- Hak data perusahaan: token unduh ekspor, permintaan penghapusan terjadwal, dan bukti penghapusan
CREATE TABLE IF NOT EXISTS "data_export_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "data_export_tokens_hash_uq" ON "data_export_tokens" ("token_hash");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "data_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"requested_by_id" uuid NOT NULL,
	"requested_by_email" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scheduled_for" date NOT NULL,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"reason" text,
	"ack_retention" boolean DEFAULT false NOT NULL,
	"export_waived" boolean DEFAULT false NOT NULL,
	"hold_reason" text,
	"held_by" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"last_reminder_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "data_deletion_active_uq" ON "data_deletion_requests" ("tenant_id") WHERE status IN ('SCHEDULED', 'ON_HOLD');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "data_erasure_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_name" text NOT NULL,
	"requested_by_email" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"export_waived" boolean NOT NULL,
	"rows_deleted" integer NOT NULL,
	"tables_touched" integer NOT NULL,
	"detail" jsonb NOT NULL
);--> statement-breakpoint
ALTER TABLE "data_export_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "data_export_tokens" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "data_deletion_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "data_deletion_requests" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
-- Bukti penghapusan hanya dibaca/ditulis pemilik layanan (sesi bypass); perusahaan tidak boleh melihatnya
ALTER TABLE "data_erasure_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY platform_only ON "data_erasure_log" USING (current_setting('app.bypass_rls', true) = 'on') WITH CHECK (current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
