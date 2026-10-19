-- Rute pengiriman (Dagang/FMCG/Manufaktur): rencana pengiriman per tanggal, urutan stop dari surat jalan, status terkirim dan bukti terima
CREATE TABLE IF NOT EXISTS "delivery_trips" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"number" text NOT NULL,
	"date" date NOT NULL,
	"vehicle" text,
	"driver_name" text,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"notes" text,
	"departed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_trips_number_uq" ON "delivery_trips" ("tenant_id", "number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_trips_date_idx" ON "delivery_trips" ("tenant_id", "date");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_trip_stops" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"trip_id" uuid NOT NULL REFERENCES "delivery_trips"("id") ON DELETE CASCADE,
	"delivery_id" uuid NOT NULL REFERENCES "delivery_orders"("id"),
	"sequence" integer NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"received_by" text,
	"received_at" timestamp with time zone,
	"fail_reason" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- satu surat jalan hanya boleh berada di satu rute yang masih berlaku (stop gagal boleh dijadwalkan ulang)
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_trip_stops_active_uq" ON "delivery_trip_stops" ("delivery_id") WHERE "status" IN ('PENDING', 'DELIVERED');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_trip_stops_trip_idx" ON "delivery_trip_stops" ("trip_id", "sequence");--> statement-breakpoint
ALTER TABLE "delivery_trips" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "delivery_trips" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "delivery_trip_stops" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "delivery_trip_stops" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
