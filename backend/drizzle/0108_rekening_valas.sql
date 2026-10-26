-- Rekening kas/bank dalam mata uang asing: akun punya mata uang, baris jurnal membawa jumlah valasnya.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "currency" text NOT NULL DEFAULT 'IDR';
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "foreign_amount" numeric(18, 2);
-- Transaksi kas valas: mata uang dan jumlah valasnya (amount tetap nilai Rupiah)
ALTER TABLE "cash_transactions" ADD COLUMN IF NOT EXISTS "currency" text;
ALTER TABLE "cash_transactions" ADD COLUMN IF NOT EXISTS "amount_foreign" numeric(18, 2);
