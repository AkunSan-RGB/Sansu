-- Antrean pesan otomatis (WhatsApp/SMS lewat penyedia webhook perusahaan): dikirim berlatar dengan percobaan ulang
CREATE TABLE IF NOT EXISTS "utility_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"connection_id" uuid NOT NULL REFERENCES "utility_connections"("id"),
	"invoice_id" uuid REFERENCES "invoices"("id"),
	"to_address" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'ANTRE' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_try_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_outbox_queue_idx" ON "utility_outbox" ("status","next_try_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_outbox_tenant_idx" ON "utility_outbox" ("tenant_id","created_at" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_outbox_open_uq" ON "utility_outbox" ("tenant_id","connection_id","kind","channel") WHERE status IN ('ANTRE', 'MENGIRIM');--> statement-breakpoint
ALTER TABLE "utility_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_outbox" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
