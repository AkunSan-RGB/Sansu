ALTER TABLE "inventory_writedowns" ADD COLUMN "kind" text DEFAULT 'WRITEDOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD COLUMN "price_incl_vat" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "prices_include_vat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "price_incl_vat" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "prices_include_vat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD COLUMN "writedown_unit" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD COLUMN "writedown_value" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD COLUMN "writedown_unit" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
-- Penurunan nilai yang dibuat di r29: isi nilai yang melekat di kartu stok & saldo stok
UPDATE "stock_moves" m SET "writedown_value" = (l->>'amount')::numeric
FROM "inventory_writedowns" w, jsonb_array_elements(w."lines") l
WHERE m."type" = 'REVALUATION' AND m."ref_type" = 'INVENTORY_WRITEDOWN' AND m."ref_id" = w."id"::text AND m."product_id" = (l->>'productId')::uuid;
--> statement-breakpoint
UPDATE "stock_balances" b SET "writedown_unit" = x.wu
FROM (
  SELECT w."warehouse_id", (l->>'productId')::uuid AS product_id, SUM((l->>'oldCost')::numeric - (l->>'newCost')::numeric) AS wu
  FROM "inventory_writedowns" w, jsonb_array_elements(w."lines") l GROUP BY 1, 2
) x
WHERE b."warehouse_id" = x."warehouse_id" AND b."product_id" = x.product_id AND b."qty" > 0;
