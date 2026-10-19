-- Riwayat penagihan penerimaan barang dan pelunasan rebate outlet, supaya saldo GRNI dan utang rebate dapat dihitung per tanggal
CREATE TABLE IF NOT EXISTS "goods_receipt_billings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"receipt_id" uuid NOT NULL REFERENCES "goods_receipts"("id") ON DELETE CASCADE,
	"receipt_line_id" uuid NOT NULL REFERENCES "goods_receipt_lines"("id") ON DELETE CASCADE,
	"invoice_id" uuid,
	"date" date NOT NULL,
	"qty" numeric(18,4) NOT NULL,
	"value" numeric(18,2) NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goods_receipt_billings_receipt_idx" ON "goods_receipt_billings" ("receipt_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goods_receipt_billings_tenant_date_idx" ON "goods_receipt_billings" ("tenant_id","date");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trade_accrual_settlements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"accrual_id" uuid NOT NULL REFERENCES "trade_accruals"("id") ON DELETE CASCADE,
	"date" date NOT NULL,
	"amount" numeric(18,2) NOT NULL,
	"mode" text NOT NULL,
	"journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_accrual_settlements_accrual_idx" ON "trade_accrual_settlements" ("accrual_id","date");--> statement-breakpoint
ALTER TABLE "goods_receipt_billings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "goods_receipt_billings" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "trade_accrual_settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "trade_accrual_settlements" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
-- Data lama: pelunasan rebate dapat direkonstruksi persis dari jurnal/pembayaran yang sudah ada
INSERT INTO "trade_accrual_settlements" ("tenant_id","accrual_id","date","amount","mode","journal_id")
SELECT a.tenant_id, a.id, j.date, l.debit, 'PAY', j.id
FROM trade_accruals a
JOIN journal_entries j ON j.tenant_id = a.tenant_id AND j.source_type = 'TRADE_SETTLEMENT' AND j.source_id = a.id::text
JOIN journal_lines l ON l.journal_id = j.id AND l.debit > 0 AND l.account_id IN (SELECT id FROM accounts WHERE tenant_id = a.tenant_id AND system_key = 'TRADE_ACCRUAL_PAYABLE');--> statement-breakpoint
INSERT INTO "trade_accrual_settlements" ("tenant_id","accrual_id","date","amount","mode","journal_id")
SELECT a.tenant_id, a.id, p.date, p.amount, 'DEDUCT', p.journal_id
FROM trade_accruals a
JOIN payments p ON p.tenant_id = a.tenant_id AND p.method = 'POTONGAN' AND p.notes LIKE 'Potongan rebate/trade promo ' || a.number || '%';--> statement-breakpoint
-- Data lama: penagihan penerimaan barang hanya tersimpan kumulatif; tanggalnya diperkirakan dari faktur terakhir yang menagih baris pesanannya
INSERT INTO "goods_receipt_billings" ("tenant_id","receipt_id","receipt_line_id","invoice_id","date","qty","value","estimated")
SELECT g.tenant_id, g.id, l.id, NULL,
  COALESCE((SELECT MAX(pi.date) FROM purchase_invoice_lines pl JOIN purchase_invoices pi ON pi.id = pl.invoice_id WHERE pl.order_line_id = l.order_line_id), g.date),
  l.billed_qty, l.billed_value, true
FROM goods_receipt_lines l JOIN goods_receipts g ON g.id = l.receipt_id
WHERE g.auto_invoice_id IS NULL AND l.billed_qty > 0;

SELECT sansu_install_tenant_guards();
