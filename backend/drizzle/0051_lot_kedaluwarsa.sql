-- Lot dan tanggal kedaluwarsa bahan (pencatatan informatif, tidak mengubah nilai persediaan) + label meja dan jenis pesanan di kasir
CREATE TABLE "stock_lots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"lot_no" text,
	"expiry_date" date,
	"received_date" date NOT NULL,
	"qty_received" numeric(18, 4) NOT NULL,
	"qty_remaining" numeric(18, 4) NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "stock_lot_transit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ref_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_no" text,
	"expiry_date" date,
	"received_date" date NOT NULL,
	"qty_left" numeric(18, 4) NOT NULL
);--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lot_transit" ADD CONSTRAINT "stock_lot_transit_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lot_transit" ADD CONSTRAINT "stock_lot_transit_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_remaining_chk" CHECK ("qty_remaining" >= 0);--> statement-breakpoint
CREATE INDEX "stock_lots_fefo_idx" ON "stock_lots" USING btree ("product_id","warehouse_id","expiry_date","id") WHERE "qty_remaining" > 0;--> statement-breakpoint
CREATE INDEX "stock_lots_tenant_expiry_idx" ON "stock_lots" USING btree ("tenant_id","expiry_date") WHERE "qty_remaining" > 0;--> statement-breakpoint
CREATE INDEX "stock_lots_source_idx" ON "stock_lots" USING btree ("source_ref");--> statement-breakpoint
CREATE INDEX "stock_lot_transit_ref_idx" ON "stock_lot_transit" USING btree ("ref_id","product_id");--> statement-breakpoint
ALTER TABLE "stock_lots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_lot_transit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "stock_lots" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY tenant_isolation ON "stock_lot_transit" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "pos_orders" ADD COLUMN IF NOT EXISTS "order_type" text;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD COLUMN IF NOT EXISTS "table_label" text;
