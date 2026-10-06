CREATE TABLE "project_progress" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"project_id" uuid NOT NULL,
	"date" date NOT NULL,
	"percent" numeric(5, 2) NOT NULL,
	"earned" numeric(18, 2) NOT NULL,
	"billed" numeric(18, 2) NOT NULL,
	"accrual_before" numeric(18, 2) NOT NULL,
	"accrual_after" numeric(18, 2) NOT NULL,
	"adjustment" numeric(18, 2) NOT NULL,
	"revenue_account_id" uuid,
	"notes" text,
	"journal_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fiscal_years" ADD COLUMN "final_cost_override" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "project_progress" ADD CONSTRAINT "project_progress_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_progress" ADD CONSTRAINT "project_progress_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_progress" ADD CONSTRAINT "project_progress_revenue_account_id_accounts_id_fk" FOREIGN KEY ("revenue_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_progress_project_idx" ON "project_progress" USING btree ("project_id","date");