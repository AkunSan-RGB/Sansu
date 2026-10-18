-- Pengiriman parsial: satu pesanan boleh punya beberapa surat jalan aktif (indeks unik sebelumnya: satu per pesanan)
DROP INDEX IF EXISTS "delivery_orders_order_uq";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_orders_order_idx" ON "delivery_orders" USING btree ("sales_order_id");
