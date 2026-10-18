-- Kontrak harga pemasok / prinsipal: harga yang disepakati per barang untuk periode tertentu; PO di atas harga kontrak ditahan
CREATE TABLE IF NOT EXISTS "supplier_price_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"supplier_id" uuid NOT NULL REFERENCES "suppliers"("id"),
	"product_id" uuid NOT NULL REFERENCES "products"("id"),
	"price" numeric(18,2) NOT NULL CHECK ("price" > 0),
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL CHECK ("status" IN ('PENDING','ACTIVE','REJECTED','ENDED')),
	"note" text,
	"created_by_id" uuid NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CHECK ("valid_to" >= "valid_from")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spa_lookup_idx" ON "supplier_price_agreements" ("tenant_id","supplier_id","product_id","status");--> statement-breakpoint
ALTER TABLE "supplier_price_agreements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "supplier_price_agreements" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
