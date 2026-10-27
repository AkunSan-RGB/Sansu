-- Manufaktur: subkontrak (maklon). Perintah produksi dapat dikerjakan pemasok jasa; upah langsungnya = DPP tagihan jasa pemasok yang ditautkan.
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "subcontractor_id" uuid REFERENCES "suppliers"("id");--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "subcontract_bill_id" uuid REFERENCES "purchase_invoices"("id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "production_orders_subcontract_bill_uq" ON "production_orders" ("subcontract_bill_id") WHERE "subcontract_bill_id" IS NOT NULL;
