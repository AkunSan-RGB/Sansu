-- Sumber uang masuk non-penjualan (kategori bisnis) pada baris kas; akun tetap ditentukan sistem
ALTER TABLE "cash_transaction_lines" ADD COLUMN IF NOT EXISTS "source_key" text;
