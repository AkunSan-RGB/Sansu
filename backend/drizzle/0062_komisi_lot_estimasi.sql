-- Jurnal komisi sales (akrual + bayar) dan penanda jejak lot hasil rekonstruksi
ALTER TABLE "stock_lot_issues" ADD COLUMN "is_estimate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE "sales_commissions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"user_id" uuid NOT NULL,
	"period" text NOT NULL,
	"net_sales" numeric(18, 2) NOT NULL,
	"target_amount" numeric(18, 2) NOT NULL,
	"commission_pct" numeric(5, 2) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'ACCRUED' NOT NULL,
	"accrual_journal_id" uuid,
	"payment_journal_id" uuid,
	"pph21_withheld" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cash_account_id" uuid,
	"accrued_by_id" uuid,
	"paid_by_id" uuid,
	"paid_at" date,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_chk" CHECK ("amount" > 0 AND "status" IN ('ACCRUED', 'PAID', 'VOID') AND "pph21_withheld" >= 0 AND "pph21_withheld" <= "amount");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_commissions_uq" ON "sales_commissions" USING btree ("tenant_id","user_id","period") WHERE status <> 'VOID';--> statement-breakpoint
CREATE UNIQUE INDEX "sales_commissions_number_uq" ON "sales_commissions" USING btree ("tenant_id","number");--> statement-breakpoint
ALTER TABLE "sales_commissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sales_commissions" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
