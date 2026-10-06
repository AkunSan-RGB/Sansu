CREATE TABLE "cash_counts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"account_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"denominations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"book_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"counted_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"items_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"difference" numeric(18, 2) DEFAULT '0' NOT NULL,
	"custodian_name" text,
	"notes" text,
	"reason" text,
	"reject_reason" text,
	"journal_id" uuid,
	"created_by_id" uuid,
	"approved_by_id" uuid,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cash_counts" ADD CONSTRAINT "cash_counts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_counts" ADD CONSTRAINT "cash_counts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_counts" ADD CONSTRAINT "cash_counts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_counts" ADD CONSTRAINT "cash_counts_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_counts_number_uq" ON "cash_counts" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "cash_counts_account_idx" ON "cash_counts" USING btree ("account_id","date");