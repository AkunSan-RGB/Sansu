ALTER TYPE "public"."stock_move_type" ADD VALUE 'PRODUCTION_ISSUE';--> statement-breakpoint
ALTER TYPE "public"."stock_move_type" ADD VALUE 'PRODUCTION_OUTPUT';--> statement-breakpoint
ALTER TYPE "public"."stock_move_type" ADD VALUE 'PRODUCTION_RETURN';--> statement-breakpoint
CREATE TABLE "bom_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"bom_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"product_id" uuid NOT NULL,
	"output_qty" numeric(18, 4) NOT NULL,
	"labor_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"overhead_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"planned_qty" numeric(18, 4) NOT NULL,
	"issued_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"value" numeric(18, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"bom_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"batches" numeric(18, 4) NOT NULL,
	"planned_qty" numeric(18, 4) NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"started_date" date,
	"completed_date" date,
	"cancelled_date" date,
	"output_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"material_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"labor_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"overhead_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"notes" text,
	"start_journal_id" uuid,
	"complete_journal_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "is_production" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boms" ADD CONSTRAINT "boms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boms" ADD CONSTRAINT "boms_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order_lines" ADD CONSTRAINT "production_order_lines_order_id_production_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."production_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order_lines" ADD CONSTRAINT "production_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "boms_code_uq" ON "boms" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "production_orders_number_uq" ON "production_orders" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "production_orders_status_idx" ON "production_orders" USING btree ("tenant_id","status");