-- PO dari penawaran supplier: harga estimasi sampai faktur tiba
ALTER TABLE "purchase_orders" ADD COLUMN "price_estimate" boolean DEFAULT false NOT NULL;
