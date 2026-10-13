-- Retur / pembatalan penjualan kasir (dilakukan supervisor): stok kembali, jurnal penjualan & HPP dibalik, uang dikembalikan
ALTER TABLE "pos_order_lines" ADD COLUMN IF NOT EXISTS "returned_qty" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
CREATE TABLE "pos_returns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"order_id" uuid NOT NULL,
	"session_id" uuid,
	"warehouse_id" uuid NOT NULL,
	"refund_method" text NOT NULL,
	"reason" text NOT NULL,
	"subtotal" numeric(18, 2) NOT NULL,
	"tax_amount" numeric(18, 2) NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"cogs_amount" numeric(18, 2) NOT NULL,
	"journal_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "pos_return_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"return_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"unit_cost" numeric(18, 4) NOT NULL
);--> statement-breakpoint
ALTER TABLE "pos_returns" ADD CONSTRAINT "pos_returns_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."pos_orders"("id");--> statement-breakpoint
ALTER TABLE "pos_returns" ADD CONSTRAINT "pos_returns_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id");--> statement-breakpoint
ALTER TABLE "pos_return_lines" ADD CONSTRAINT "pos_return_lines_return_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."pos_returns"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pos_return_lines" ADD CONSTRAINT "pos_return_lines_order_line_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."pos_order_lines"("id");--> statement-breakpoint
ALTER TABLE "pos_return_lines" ADD CONSTRAINT "pos_return_lines_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_returns_number_uq" ON "pos_returns" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "pos_returns_order_idx" ON "pos_returns" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "pos_returns_session_idx" ON "pos_returns" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "pos_order_lines" ADD CONSTRAINT "pos_order_lines_returned_ck" CHECK ("returned_qty" >= 0 AND "returned_qty" <= "qty");--> statement-breakpoint
ALTER TABLE "pos_returns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pos_returns" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
