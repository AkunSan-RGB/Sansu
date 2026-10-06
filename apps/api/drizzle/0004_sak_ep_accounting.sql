CREATE TABLE "asset_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"asset_account_id" uuid NOT NULL,
	"accumulated_account_id" uuid,
	"expense_account_id" uuid,
	"method" text DEFAULT 'STRAIGHT_LINE' NOT NULL,
	"useful_life_months" integer DEFAULT 48 NOT NULL,
	"fiscal_group" text DEFAULT 'GROUP_1' NOT NULL,
	"fiscal_method" text DEFAULT 'STRAIGHT_LINE' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_depreciations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"period" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"journal_id" uuid
);
--> statement-breakpoint
CREATE TABLE "fiscal_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"description" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_years" (
	"tenant_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"loss_carryforward" numeric(18, 2) DEFAULT '0' NOT NULL,
	"gross_revenue_override" numeric(18, 2),
	"tax_journal_id" uuid,
	CONSTRAINT "fiscal_years_tenant_id_year_pk" PRIMARY KEY("tenant_id","year")
);
--> statement-breakpoint
CREATE TABLE "fixed_assets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"acquisition_date" date NOT NULL,
	"depreciation_start" date NOT NULL,
	"cost" numeric(18, 2) NOT NULL,
	"residual_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"useful_life_months" integer NOT NULL,
	"method" text NOT NULL,
	"opening_accumulated" numeric(18, 2) DEFAULT '0' NOT NULL,
	"opening_fiscal_accumulated" numeric(18, 2) DEFAULT '0' NOT NULL,
	"location" text,
	"notes" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"acquisition_journal_id" uuid,
	"disposal_date" date,
	"disposal_price" numeric(18, 2),
	"disposal_journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_journals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"frequency" text DEFAULT 'MONTHLY' NOT NULL,
	"next_date" date NOT NULL,
	"end_date" date,
	"remaining" integer,
	"is_adjustment" boolean DEFAULT true NOT NULL,
	"lines" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_notes" (
	"tenant_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"key" text NOT NULL,
	"content" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_notes_tenant_id_year_key_pk" PRIMARY KEY("tenant_id","year","key")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "report_group" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "fiscal_treatment" text DEFAULT 'NORMAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_asset_account_id_accounts_id_fk" FOREIGN KEY ("asset_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_accumulated_account_id_accounts_id_fk" FOREIGN KEY ("accumulated_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_expense_account_id_accounts_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciations" ADD CONSTRAINT "asset_depreciations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciations" ADD CONSTRAINT "asset_depreciations_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_adjustments" ADD CONSTRAINT "fiscal_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_category_id_asset_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."asset_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_journals" ADD CONSTRAINT "recurring_journals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_notes" ADD CONSTRAINT "report_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_categories_name_uq" ON "asset_categories" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_depreciations_uq" ON "asset_depreciations" USING btree ("asset_id","period");--> statement-breakpoint
CREATE INDEX "asset_depreciations_tenant_idx" ON "asset_depreciations" USING btree ("tenant_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_assets_code_uq" ON "fixed_assets" USING btree ("tenant_id","code");