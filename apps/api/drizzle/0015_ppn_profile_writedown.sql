ALTER TYPE "public"."stock_move_type" ADD VALUE 'REVALUATION';--> statement-breakpoint
CREATE TABLE "inventory_writedowns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"journal_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos_orders" ADD COLUMN "prices_include_vat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "vat_capitalized" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_writedowns" ADD CONSTRAINT "inventory_writedowns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_writedowns" ADD CONSTRAINT "inventory_writedowns_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_writedowns" ADD CONSTRAINT "inventory_writedowns_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_writedowns_number_uq" ON "inventory_writedowns" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "inventory_writedowns_date_idx" ON "inventory_writedowns" USING btree ("tenant_id","date");