-- Meja, pesanan terbuka (tab) per meja, antrean dapur, dan pembayaran sebagian (pisah bill) untuk kafe/restoran
CREATE TABLE "pos_tables" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"seats" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "pos_tabs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"table_id" uuid,
	"table_label" text,
	"order_type" text DEFAULT 'DINE_IN' NOT NULL,
	"guest_name" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"notes" text,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_by_id" uuid
);--> statement-breakpoint
CREATE TABLE "pos_tab_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tab_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"notes" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"prepared_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"served_at" timestamp with time zone,
	"void_reason" text,
	"voided_by_id" uuid,
	"voided_at" timestamp with time zone,
	"void_from_status" text,
	"paid_order_id" uuid
);--> statement-breakpoint
ALTER TABLE "pos_orders" ADD COLUMN IF NOT EXISTS "tab_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_tables" ADD CONSTRAINT "pos_tables_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_tables" ADD CONSTRAINT "pos_tables_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD CONSTRAINT "pos_tabs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD CONSTRAINT "pos_tabs_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD CONSTRAINT "pos_tabs_table_id_pos_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."pos_tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD CONSTRAINT "pos_tabs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_tab_lines" ADD CONSTRAINT "pos_tab_lines_tab_id_pos_tabs_id_fk" FOREIGN KEY ("tab_id") REFERENCES "public"."pos_tabs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_tab_lines" ADD CONSTRAINT "pos_tab_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_tab_lines" ADD CONSTRAINT "pos_tab_lines_paid_order_id_pos_orders_id_fk" FOREIGN KEY ("paid_order_id") REFERENCES "public"."pos_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_tab_lines" ADD CONSTRAINT "pos_tab_lines_qty_chk" CHECK ("qty" > 0);--> statement-breakpoint
CREATE UNIQUE INDEX "pos_tables_code_uq" ON "pos_tables" USING btree ("tenant_id","warehouse_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_tabs_number_uq" ON "pos_tabs" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_tabs_open_table_uq" ON "pos_tabs" USING btree ("table_id") WHERE "status" = 'OPEN' AND "table_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pos_tabs_status_idx" ON "pos_tabs" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "pos_tab_lines_tab_idx" ON "pos_tab_lines" USING btree ("tab_id");--> statement-breakpoint
CREATE INDEX "pos_tab_lines_kitchen_idx" ON "pos_tab_lines" USING btree ("status") WHERE "status" IN ('NEW', 'PREPARING', 'READY');--> statement-breakpoint
CREATE INDEX "pos_orders_tab_idx" ON "pos_orders" USING btree ("tab_id") WHERE "tab_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_tables" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos_tabs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pos_tables" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pos_tabs" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
