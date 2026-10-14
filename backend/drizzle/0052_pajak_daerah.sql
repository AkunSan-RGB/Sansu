-- Pajak restoran daerah (PB1/PBJT) di kasir: jenis pajak pada transaksi kasir (PPN atau pajak daerah)
ALTER TABLE "pos_orders" ADD COLUMN IF NOT EXISTS "tax_kind" text DEFAULT 'VAT' NOT NULL;
