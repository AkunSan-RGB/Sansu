-- Barang setengah jadi (akun persediaan tersendiri) dan perintah produksi berjenjang
ALTER TABLE "products" ADD COLUMN "inventory_kind" text DEFAULT 'GOODS' NOT NULL;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "parent_order_id" uuid;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "plan_no" text;--> statement-breakpoint
CREATE INDEX "production_orders_parent_idx" ON "production_orders" USING btree ("parent_order_id");
