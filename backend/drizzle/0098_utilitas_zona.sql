ALTER TABLE "utility_connections" ADD COLUMN IF NOT EXISTS "zone" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_connections_zone_idx" ON "utility_connections" ("tenant_id", "zone") WHERE zone IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_zone_supply" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"zone" text NOT NULL,
	"period" text NOT NULL,
	"supplied" numeric(18, 3) NOT NULL,
	"note" text,
	"entered_by_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "utility_zone_supply_chk" CHECK ("supplied" >= 0 AND "period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_zone_supply_uq" ON "utility_zone_supply" ("tenant_id", "zone", "period");--> statement-breakpoint
ALTER TABLE "utility_zone_supply" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_zone_supply" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
