-- Kontrol penjualan: alasan pembatalan pesanan dan surat jalan
ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "cancelled_by_id" uuid;
ALTER TABLE "delivery_orders" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
ALTER TABLE "delivery_orders" ADD COLUMN IF NOT EXISTS "cancelled_by_id" uuid;
