CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"cycle" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'UNPAID' NOT NULL,
	"method" text DEFAULT 'MANUAL' NOT NULL,
	"due_date" date NOT NULL,
	"proof" text,
	"proof_note" text,
	"reject_reason" text,
	"gateway_ref" text,
	"gateway_url" text,
	"paid_at" timestamp with time zone,
	"confirmed_by" text,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "marketplace_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"channel" text NOT NULL,
	"shop_id" text NOT NULL,
	"shop_name" text DEFAULT '' NOT NULL,
	"credentials" text,
	"token_expires_at" timestamp with time zone,
	"warehouse_id" uuid NOT NULL,
	"prices_include_vat" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"synced_until" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_result" jsonb,
	"last_error" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_monthly" numeric(18, 2) NOT NULL,
	"price_yearly" numeric(18, 2) NOT NULL,
	"max_users" integer,
	"max_warehouses" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" text NOT NULL,
	"cycle" text DEFAULT 'MONTHLY' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"reminders" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_connections" ADD CONSTRAINT "marketplace_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_connections" ADD CONSTRAINT "marketplace_connections_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_connections" ADD CONSTRAINT "marketplace_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_hash_uq" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_idx" ON "auth_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "billing_invoices_tenant_idx" ON "billing_invoices" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_invoices_status_idx" ON "billing_invoices" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_conn_uq" ON "marketplace_connections" USING btree ("tenant_id","provider","shop_id");--> statement-breakpoint
-- Paket awal (harga & batas bisa diubah di panel admin)
INSERT INTO "plans" ("code","name","description","price_monthly","price_yearly","max_users","max_warehouses","sort_order") VALUES
 ('STARTER','Starter','Untuk usaha yang baru mulai tertata: 3 pengguna, 1 gudang.',199000,1990000,3,1,1),
 ('BISNIS','Bisnis','Distributor berkembang: 10 pengguna, 3 gudang.',449000,4490000,10,3,2),
 ('PRO','Pro','Distributor besar: 30 pengguna, gudang tanpa batas.',899000,8990000,30,NULL,3)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
-- Pengguna lama dianggap sudah terverifikasi
UPDATE "users" SET "email_verified_at" = "created_at" WHERE "email_verified_at" IS NULL;
--> statement-breakpoint
-- Perusahaan yang sudah ada sebelum fitur langganan: aktif tanpa batas waktu di paket Pro
INSERT INTO "subscriptions" ("tenant_id","plan_id","status","notes")
SELECT t."id", (SELECT "id" FROM "plans" WHERE "code"='PRO'), 'ACTIVE', 'Akun lama sebelum fitur langganan'
FROM "tenants" t ON CONFLICT DO NOTHING;
