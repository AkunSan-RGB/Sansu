-- Penerimaan barang (GRN) atas pesanan pembelian + faktur bertahap
ALTER TABLE "purchase_order_lines" ADD COLUMN "received_qty" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "billed_qty" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "billed_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD COLUMN "order_line_id" uuid;--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" text DEFAULT 'RECEIVED' NOT NULL,
	"supplier_delivery_no" text,
	"value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_capitalized" boolean DEFAULT false NOT NULL,
	"journal_id" uuid,
	"auto_invoice_id" uuid,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "goods_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"uom" text NOT NULL,
	"uom_factor" numeric(18, 4) NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"unit_cost" numeric(18, 4) NOT NULL,
	"value" numeric(18, 2) NOT NULL,
	"billed_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"billed_value" numeric(18, 2) DEFAULT '0' NOT NULL
);--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "goods_receipts_number_uq" ON "goods_receipts" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "goods_receipts_order_idx" ON "goods_receipts" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "goods_receipts_date_idx" ON "goods_receipts" USING btree ("tenant_id","date");--> statement-breakpoint
DROP INDEX "purchase_invoices_po_uq";--> statement-breakpoint
CREATE INDEX "purchase_invoices_po_idx" ON "purchase_invoices" USING btree ("purchase_order_id");--> statement-breakpoint
-- Pesanan lama yang sudah difakturkan: seluruh barang dianggap sudah diterima dan ditagih
UPDATE "purchase_order_lines" l SET "received_qty" = l."qty", "billed_qty" = l."qty", "billed_amount" = l."line_total"
  FROM "purchase_orders" o WHERE o."id" = l."order_id" AND o."status" = 'BILLED';
