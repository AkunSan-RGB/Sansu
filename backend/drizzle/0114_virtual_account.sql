-- Nomor virtual account per sambungan + catatan pembayaran masuk dari bank/penyedia pembayaran (idempoten per referensi)
ALTER TABLE "utility_connections" ADD COLUMN IF NOT EXISTS "va_suffix" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_va_counters" (
	"tenant_id" uuid PRIMARY KEY NOT NULL REFERENCES "tenants"("id"),
	"last" bigint DEFAULT 0 NOT NULL
);--> statement-breakpoint
WITH numbered AS (SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn FROM utility_connections WHERE va_suffix IS NULL)
UPDATE utility_connections c SET va_suffix = lpad(n.rn::text, 8, '0') FROM numbered n WHERE c.id = n.id;--> statement-breakpoint
INSERT INTO utility_va_counters (tenant_id, last) SELECT tenant_id, COUNT(*) FROM utility_connections WHERE va_suffix IS NOT NULL GROUP BY tenant_id ON CONFLICT (tenant_id) DO UPDATE SET last = EXCLUDED.last;--> statement-breakpoint
CREATE OR REPLACE FUNCTION utility_assign_va() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n bigint;
BEGIN
  IF NEW.va_suffix IS NULL THEN
    INSERT INTO utility_va_counters (tenant_id, last) VALUES (NEW.tenant_id, 1) ON CONFLICT (tenant_id) DO UPDATE SET last = utility_va_counters.last + 1 RETURNING last INTO n;
    NEW.va_suffix := lpad(n::text, 8, '0');
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS utility_connections_assign_va ON "utility_connections";--> statement-breakpoint
CREATE TRIGGER utility_connections_assign_va BEFORE INSERT ON "utility_connections" FOR EACH ROW EXECUTE FUNCTION utility_assign_va();--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_connections_va_uq" ON "utility_connections" ("tenant_id","va_suffix");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_va_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"reference" text NOT NULL,
	"va_number" text NOT NULL,
	"connection_id" uuid REFERENCES "utility_connections"("id"),
	"amount" numeric(18, 2) NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" text,
	"status" text NOT NULL,
	"applied" numeric(18, 2) DEFAULT '0' NOT NULL,
	"unapplied" numeric(18, 2) DEFAULT '0' NOT NULL,
	"payment_numbers" text[] DEFAULT '{}' NOT NULL,
	"message" text,
	"handled_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_va_payments_ref_uq" ON "utility_va_payments" ("tenant_id","reference");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_va_payments_status_idx" ON "utility_va_payments" ("tenant_id","status","created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_va_counters_tenant_idx" ON "utility_va_counters" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_va_payments_tenant_idx" ON "utility_va_payments" ("tenant_id");--> statement-breakpoint
ALTER TABLE "utility_va_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_va_counters" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "utility_va_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_va_payments" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
