-- Pesanan online (pesan-antar): kanal & nomor pesanan platform, komisi, pencairan, dan kunci API penerima pesanan
ALTER TYPE "pos_payment_method" ADD VALUE IF NOT EXISTS 'PLATFORM';--> statement-breakpoint
CREATE TABLE "pos_platform_settlements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"channel" text NOT NULL,
	"date" date NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"order_count" integer NOT NULL,
	"expected" numeric(18, 2) NOT NULL,
	"received" numeric(18, 2) NOT NULL,
	"difference" numeric(18, 2) NOT NULL,
	"notes" text,
	"journal_id" uuid,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "online_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "pos_orders" ADD COLUMN IF NOT EXISTS "channel" text;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD COLUMN IF NOT EXISTS "external_ref" text;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD COLUMN IF NOT EXISTS "platform_fee" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD COLUMN IF NOT EXISTS "settlement_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD COLUMN IF NOT EXISTS "channel" text;--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD COLUMN IF NOT EXISTS "external_ref" text;--> statement-breakpoint
ALTER TABLE "pos_platform_settlements" ADD CONSTRAINT "pos_platform_settlements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_platform_settlements" ADD CONSTRAINT "pos_platform_settlements_bank_account_id_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_platform_settlements" ADD CONSTRAINT "pos_platform_settlements_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_api_keys" ADD CONSTRAINT "online_api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_api_keys" ADD CONSTRAINT "online_api_keys_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_api_keys" ADD CONSTRAINT "online_api_keys_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_platform_settlements_number_uq" ON "pos_platform_settlements" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "online_api_keys_hash_uq" ON "online_api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_tabs_external_uq" ON "pos_tabs" USING btree ("tenant_id","channel","external_ref") WHERE "external_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pos_orders_settlement_idx" ON "pos_orders" USING btree ("tenant_id","channel") WHERE "channel" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_platform_settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "online_api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pos_platform_settlements" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY tenant_isolation ON "online_api_keys" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
