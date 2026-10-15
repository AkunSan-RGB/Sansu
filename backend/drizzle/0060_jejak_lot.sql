-- Jejak keluar lot untuk penelusuran penarikan produk (recall): lot -> dokumen -> pelanggan
CREATE TABLE "stock_lot_issues" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"move_type" text NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "stock_lot_issues" ADD CONSTRAINT "stock_lot_issues_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lot_issues" ADD CONSTRAINT "stock_lot_issues_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_lot_issues_lot_idx" ON "stock_lot_issues" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "stock_lot_issues_ref_idx" ON "stock_lot_issues" USING btree ("ref_type","ref_id");--> statement-breakpoint
ALTER TABLE "stock_lot_issues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "stock_lot_issues" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
