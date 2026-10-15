-- Tukar-guling (butuh persetujuan), konsinyasi, dan jenis gudang (konsinyasi / mobil kanvas)
ALTER TABLE "warehouses" ADD COLUMN "kind" text DEFAULT 'MAIN' NOT NULL;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "consignee_customer_id" uuid;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "van_user_id" uuid;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_kind_chk" CHECK ("kind" IN ('MAIN', 'CONSIGNMENT', 'VAN'));--> statement-breakpoint
CREATE TABLE "goods_swaps" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"customer_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_by_id" uuid,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"reject_reason" text,
	"journal_id" uuid,
	"cost_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "goods_swap_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"swap_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"uom" text NOT NULL,
	"uom_factor" numeric(18, 4) NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"lot_no" text
);--> statement-breakpoint
CREATE TABLE "consignment_docs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"kind" text NOT NULL,
	"date" date NOT NULL,
	"customer_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"reference" text,
	"status" text DEFAULT 'DONE' NOT NULL,
	"lines" jsonb NOT NULL,
	"transfer_id" uuid,
	"sales_order_id" uuid,
	"invoice_id" uuid,
	"notes" text,
	"reject_reason" text,
	"created_by_id" uuid,
	"decided_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "goods_swaps" ADD CONSTRAINT "goods_swaps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_swaps" ADD CONSTRAINT "goods_swaps_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_swaps" ADD CONSTRAINT "goods_swaps_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_swaps" ADD CONSTRAINT "goods_swaps_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_swaps" ADD CONSTRAINT "goods_swaps_chk" CHECK ("reason" IN ('EXPIRED', 'DAMAGED', 'RECALL') AND "status" IN ('PENDING', 'APPROVED', 'REJECTED'));--> statement-breakpoint
ALTER TABLE "goods_swap_lines" ADD CONSTRAINT "goods_swap_lines_swap_id_goods_swaps_id_fk" FOREIGN KEY ("swap_id") REFERENCES "public"."goods_swaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_swap_lines" ADD CONSTRAINT "goods_swap_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_swap_lines" ADD CONSTRAINT "goods_swap_lines_qty_chk" CHECK ("qty" > 0);--> statement-breakpoint
ALTER TABLE "consignment_docs" ADD CONSTRAINT "consignment_docs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consignment_docs" ADD CONSTRAINT "consignment_docs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consignment_docs" ADD CONSTRAINT "consignment_docs_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consignment_docs" ADD CONSTRAINT "consignment_docs_chk" CHECK ("kind" IN ('SHIP', 'REPORT', 'RETURN') AND "status" IN ('DONE', 'REPORTED', 'INVOICED', 'REJECTED'));--> statement-breakpoint
CREATE UNIQUE INDEX "goods_swaps_number_uq" ON "goods_swaps" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "goods_swaps_invoice_idx" ON "goods_swaps" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consignment_docs_number_uq" ON "consignment_docs" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "consignment_docs_ref_uq" ON "consignment_docs" USING btree ("tenant_id","customer_id","reference") WHERE kind = 'REPORT' AND status <> 'REJECTED';--> statement-breakpoint
ALTER TABLE "goods_swaps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "goods_swaps" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "goods_swap_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "goods_swap_lines" USING (EXISTS (SELECT 1 FROM goods_swaps s WHERE s.id = swap_id AND (s.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on')));--> statement-breakpoint
ALTER TABLE "consignment_docs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "consignment_docs" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
