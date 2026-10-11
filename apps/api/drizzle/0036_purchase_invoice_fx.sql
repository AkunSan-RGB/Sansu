-- Faktur beli valas: harga per satuan dalam mata uang faktur
ALTER TABLE "purchase_invoice_lines" ADD COLUMN "price_foreign" numeric(18, 4);
