-- Kanvas / van sales: rute, kunjungan (check-in berkoordinat), setoran tagihan yang diverifikasi Keuangan
ALTER TABLE "customers" ADD COLUMN "geo_lat" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "geo_lng" numeric(9, 6);--> statement-breakpoint
CREATE TABLE "sales_routes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"salesperson_id" uuid NOT NULL,
	"weekday" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "sales_route_stops" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"seq" integer NOT NULL
);--> statement-breakpoint
CREATE TABLE "sales_visits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"route_id" uuid,
	"date" date NOT NULL,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"distance_m" integer,
	"result" text NOT NULL,
	"note" text,
	"sales_order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "canvass_collections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"user_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"date" date NOT NULL,
	"method" text DEFAULT 'CASH' NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"received_amount" numeric(18, 2),
	"shortage" numeric(18, 2) DEFAULT '0' NOT NULL,
	"payment_id" uuid,
	"verified_by_id" uuid,
	"verified_at" timestamp with time zone,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "sales_routes" ADD CONSTRAINT "sales_routes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_routes" ADD CONSTRAINT "sales_routes_salesperson_id_users_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_routes" ADD CONSTRAINT "sales_routes_weekday_chk" CHECK ("weekday" IS NULL OR ("weekday" BETWEEN 1 AND 7));--> statement-breakpoint
ALTER TABLE "sales_route_stops" ADD CONSTRAINT "sales_route_stops_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_route_stops" ADD CONSTRAINT "sales_route_stops_route_id_sales_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."sales_routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_route_stops" ADD CONSTRAINT "sales_route_stops_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_visits" ADD CONSTRAINT "sales_visits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_visits" ADD CONSTRAINT "sales_visits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_visits" ADD CONSTRAINT "sales_visits_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_visits" ADD CONSTRAINT "sales_visits_result_chk" CHECK ("result" IN ('ORDER', 'NO_ORDER', 'CLOSED'));--> statement-breakpoint
ALTER TABLE "canvass_collections" ADD CONSTRAINT "canvass_collections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvass_collections" ADD CONSTRAINT "canvass_collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvass_collections" ADD CONSTRAINT "canvass_collections_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvass_collections" ADD CONSTRAINT "canvass_collections_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvass_collections" ADD CONSTRAINT "canvass_collections_chk" CHECK ("amount" > 0 AND "status" IN ('PENDING', 'VERIFIED', 'REJECTED') AND "shortage" >= 0);--> statement-breakpoint
CREATE UNIQUE INDEX "sales_routes_name_uq" ON "sales_routes" USING btree ("tenant_id", lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "sales_route_stops_uq" ON "sales_route_stops" USING btree ("route_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_visits_uq" ON "sales_visits" USING btree ("user_id","customer_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "canvass_collections_number_uq" ON "canvass_collections" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "canvass_collections_invoice_idx" ON "canvass_collections" USING btree ("invoice_id");--> statement-breakpoint
ALTER TABLE "sales_routes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sales_routes" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "sales_route_stops" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sales_route_stops" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "sales_visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sales_visits" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
ALTER TABLE "canvass_collections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "canvass_collections" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
