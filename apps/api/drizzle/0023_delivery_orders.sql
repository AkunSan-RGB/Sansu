-- Surat jalan (pengiriman barang) sebagai dokumen tersendiri dalam rantai penawaran → pesanan → surat jalan → faktur → pembayaran.
-- Faktur langsung dari pesanan tetap bisa (surat jalan dibuat otomatis); atau kirim dulu lalu faktur kemudian.
ALTER TYPE "public"."sales_order_status" ADD VALUE IF NOT EXISTS 'DELIVERED' BEFORE 'INVOICED';--> statement-breakpoint
CREATE TABLE "delivery_orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" text DEFAULT 'DELIVERED' NOT NULL,
	"cogs_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"journal_id" uuid,
	"invoice_id" uuid,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "delivery_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"uom" text NOT NULL,
	"uom_factor" numeric(18, 4) NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"unit_cost" numeric(18, 4) NOT NULL
);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "delivery_order_id" uuid;--> statement-breakpoint
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_sales_order_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_order_lines" ADD CONSTRAINT "delivery_order_lines_delivery_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."delivery_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_order_lines" ADD CONSTRAINT "delivery_order_lines_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_orders_number_uq" ON "delivery_orders" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_orders_order_uq" ON "delivery_orders" USING btree ("sales_order_id") WHERE "status" = 'DELIVERED';--> statement-breakpoint
CREATE INDEX "delivery_orders_date_idx" ON "delivery_orders" USING btree ("tenant_id","date");
