ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "bins_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warehouse_bins" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id"),
	"code" text NOT NULL,
	"zone" text,
	"name" text,
	"kind" text DEFAULT 'STORAGE' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_bins_kind_ck" CHECK ("kind" IN ('STORAGE', 'STAGING', 'DAMAGED', 'QUARANTINE', 'UNASSIGNED'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_bins_code_uq" ON "warehouse_bins" ("tenant_id", "warehouse_id", "code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_bins_unassigned_uq" ON "warehouse_bins" ("warehouse_id") WHERE "kind" = 'UNASSIGNED';--> statement-breakpoint
ALTER TABLE "warehouse_bins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "warehouse_bins" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_bin_balances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id"),
	"bin_id" uuid NOT NULL REFERENCES "warehouse_bins"("id"),
	"product_id" uuid NOT NULL REFERENCES "products"("id"),
	"lot_id" uuid REFERENCES "stock_lots"("id"),
	"qty" numeric(18, 4) NOT NULL,
	CONSTRAINT "stock_bin_balances_qty_ck" CHECK ("qty" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_bin_balances_uq" ON "stock_bin_balances" ("bin_id", "product_id", (COALESCE("lot_id", '00000000-0000-0000-0000-000000000000'::uuid)));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_bin_balances_product_idx" ON "stock_bin_balances" ("warehouse_id", "product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_bin_balances_tenant_idx" ON "stock_bin_balances" ("tenant_id");--> statement-breakpoint
ALTER TABLE "stock_bin_balances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "stock_bin_balances" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bin_moves" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id"),
	"product_id" uuid NOT NULL REFERENCES "products"("id"),
	"lot_id" uuid REFERENCES "stock_lots"("id"),
	"from_bin_id" uuid REFERENCES "warehouse_bins"("id"),
	"to_bin_id" uuid REFERENCES "warehouse_bins"("id"),
	"qty" numeric(18, 4) NOT NULL,
	"kind" text NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bin_moves_qty_ck" CHECK ("qty" > 0),
	CONSTRAINT "bin_moves_kind_ck" CHECK ("kind" IN ('SEED', 'RECEIVE', 'ISSUE', 'MOVE'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bin_moves_card_idx" ON "bin_moves" ("tenant_id", "warehouse_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bin_moves_product_idx" ON "bin_moves" ("product_id", "created_at");--> statement-breakpoint
ALTER TABLE "bin_moves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "bin_moves" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE OR REPLACE FUNCTION forbid_bin_move_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('sansu.allow_journal_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Riwayat pindah rak tidak boleh diubah atau dihapus' USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint
CREATE TRIGGER bin_moves_immutable BEFORE UPDATE OR DELETE ON bin_moves FOR EACH ROW EXECUTE FUNCTION forbid_bin_move_change();--> statement-breakpoint
SELECT sansu_install_tenant_guards();
