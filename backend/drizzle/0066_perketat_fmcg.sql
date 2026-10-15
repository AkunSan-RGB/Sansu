-- Pengetatan FMCG: pembuat setoran kanvas dicatat (pemisahan fungsi), snapshot penanggung promo pada baris pesanan, gudang konsinyasi/mobil unik
ALTER TABLE "canvass_collections" ADD COLUMN "created_by_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "promo_funded_supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "promo_funded_pct" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
UPDATE "sales_order_lines" l SET "promo_funded_supplier_id" = p."funded_supplier_id", "promo_funded_pct" = p."funded_pct" FROM "promos" p WHERE p."id" = l."promo_id" AND p."funded_pct" > 0;--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_consignee_uq" ON "warehouses" USING btree ("tenant_id","consignee_customer_id") WHERE kind = 'CONSIGNMENT';--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_van_user_uq" ON "warehouses" USING btree ("tenant_id","van_user_id") WHERE kind = 'VAN';
