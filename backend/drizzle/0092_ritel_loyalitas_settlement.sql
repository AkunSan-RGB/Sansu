ALTER TABLE "pos_orders" ADD COLUMN IF NOT EXISTS "loyalty_earned_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD COLUMN IF NOT EXISTS "loyalty_redeemed_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD COLUMN IF NOT EXISTS "loyalty_redeemed_value" numeric(18, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_returns" ADD COLUMN IF NOT EXISTS "points_refund" numeric(18, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_ledger" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"customer_id" uuid NOT NULL REFERENCES "customers"("id"),
	"kind" text NOT NULL,
	"points" integer NOT NULL,
	"value" numeric(18, 2) NOT NULL,
	"order_id" uuid REFERENCES "pos_orders"("id"),
	"expires_on" date,
	"remaining" integer,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_ledger_customer_idx" ON "loyalty_ledger" ("tenant_id", "customer_id", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_earn_once_uq" ON "loyalty_ledger" ("order_id") WHERE kind = 'EARN';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_redeem_once_uq" ON "loyalty_ledger" ("order_id") WHERE kind = 'REDEEM';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_ledger_lots_idx" ON "loyalty_ledger" ("tenant_id", "expires_on") WHERE remaining > 0;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "loyalty_ledger" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pos_card_settlements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"number" text NOT NULL,
	"date" date NOT NULL,
	"method" text NOT NULL,
	"bank_account_id" uuid NOT NULL REFERENCES "accounts"("id"),
	"gross" numeric(18, 2) NOT NULL,
	"mdr_pct" numeric(6, 3) NOT NULL,
	"mdr_expected" numeric(18, 2) NOT NULL,
	"received" numeric(18, 2) NOT NULL,
	"difference" numeric(18, 2) NOT NULL,
	"item_count" integer NOT NULL,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"note" text,
	"journal_id" uuid REFERENCES "journal_entries"("id"),
	"reverse_journal_id" uuid REFERENCES "journal_entries"("id"),
	"cancel_reason" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pos_card_settlements_number_uq" ON "pos_card_settlements" ("tenant_id", "number");--> statement-breakpoint
ALTER TABLE "pos_card_settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pos_card_settlements" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pos_card_settlement_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"settlement_id" uuid NOT NULL REFERENCES "pos_card_settlements"("id") ON DELETE CASCADE,
	"payment_id" uuid NOT NULL REFERENCES "pos_payments"("id") ON DELETE CASCADE,
	"amount" numeric(18, 2) NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pos_card_settlement_items_payment_uq" ON "pos_card_settlement_items" ("payment_id");--> statement-breakpoint
ALTER TABLE "pos_card_settlement_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pos_card_settlement_items" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
