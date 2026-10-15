-- Target & komisi sales lapangan: pesanan dikaitkan ke sales, target bulanan per sales
ALTER TABLE "sales_orders" ADD COLUMN "salesperson_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_salesperson_id_users_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_orders_salesperson_idx" ON "sales_orders" USING btree ("salesperson_id");--> statement-breakpoint
CREATE TABLE "sales_targets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"period" text NOT NULL,
	"target_amount" numeric(18, 2) NOT NULL,
	"commission_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"min_achievement_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_chk" CHECK ("target_amount" >= 0 AND "commission_pct" >= 0 AND "commission_pct" <= 100 AND "min_achievement_pct" >= 0 AND "min_achievement_pct" <= 100 AND "period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');--> statement-breakpoint
CREATE UNIQUE INDEX "sales_targets_uq" ON "sales_targets" USING btree ("tenant_id","user_id","period");--> statement-breakpoint
ALTER TABLE "sales_targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sales_targets" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
