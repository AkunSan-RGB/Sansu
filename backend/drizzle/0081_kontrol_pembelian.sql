-- Kontrol pembelian: data rekening pemasok (perubahan wajib disetujui orang lain) dan alasan pembatalan PO
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "bank_name" text;
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "bank_account_no" text;
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "bank_account_name" text;
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "bank_changed_at" timestamp with time zone;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "cancelled_by_id" uuid;
