-- Maklon: satu tagihan jasa pemasok dapat dialokasikan ke beberapa perintah produksi (jumlah per perintah)
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "subcontract_bill_amount" numeric(18, 2);--> statement-breakpoint
DROP INDEX IF EXISTS "production_orders_subcontract_bill_uq";--> statement-breakpoint
UPDATE "production_orders" o SET "subcontract_bill_amount" = COALESCE((SELECT SUM(l.line_total) FROM purchase_invoice_lines l JOIN accounts a ON a.id = l.account_id WHERE l.invoice_id = o.subcontract_bill_id AND a.system_key = 'DIRECT_LABOR'), 0) WHERE o.subcontract_bill_id IS NOT NULL AND o.subcontract_bill_amount IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_orders_subcontract_bill_idx" ON "production_orders" ("subcontract_bill_id") WHERE "subcontract_bill_id" IS NOT NULL;
