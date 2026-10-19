-- Rute pengiriman lanjutan: berat barang, kendaraan dengan kapasitas, jarak jalan, lokasi GPS, bukti foto dan tanda tangan
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "weight_kg" numeric(18, 3);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"plate" text NOT NULL,
	"name" text,
	"capacity_kg" numeric(18, 2),
	"default_driver" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_vehicles_plate_uq" ON "delivery_vehicles" ("tenant_id", lower("plate"));--> statement-breakpoint
ALTER TABLE "delivery_vehicles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "delivery_vehicles" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "delivery_trips" ADD COLUMN IF NOT EXISTS "vehicle_id" uuid REFERENCES "delivery_vehicles"("id");--> statement-breakpoint
ALTER TABLE "delivery_trips" ADD COLUMN IF NOT EXISTS "distance_m" integer;--> statement-breakpoint
ALTER TABLE "delivery_trips" ADD COLUMN IF NOT EXISTS "distance_source" text;--> statement-breakpoint
ALTER TABLE "delivery_trips" ADD COLUMN IF NOT EXISTS "last_lat" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "delivery_trips" ADD COLUMN IF NOT EXISTS "last_lng" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "delivery_trips" ADD COLUMN IF NOT EXISTS "last_position_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_trips" ADD COLUMN IF NOT EXISTS "over_capacity_reason" text;--> statement-breakpoint
ALTER TABLE "delivery_trip_stops" ADD COLUMN IF NOT EXISTS "result_lat" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "delivery_trip_stops" ADD COLUMN IF NOT EXISTS "result_lng" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "delivery_trip_stops" ADD COLUMN IF NOT EXISTS "result_distance_m" integer;--> statement-breakpoint
ALTER TABLE "delivery_trip_stops" ADD COLUMN IF NOT EXISTS "proof_photo" text;--> statement-breakpoint
ALTER TABLE "delivery_trip_stops" ADD COLUMN IF NOT EXISTS "proof_signature" text;--> statement-breakpoint
SELECT sansu_install_tenant_guards();
