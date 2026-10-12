-- Harga faktur supplier boleh berbeda dari PO: simpan selisihnya
ALTER TABLE "purchase_invoices" ADD COLUMN "price_variance" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD COLUMN "price_variance" numeric(18, 2) DEFAULT '0' NOT NULL;
