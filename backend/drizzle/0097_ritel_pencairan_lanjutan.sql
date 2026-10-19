ALTER TABLE "pos_card_settlements" ADD COLUMN IF NOT EXISTS "returns_total" numeric(18, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pos_card_settlement_returns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"settlement_id" uuid NOT NULL REFERENCES "pos_card_settlements"("id"),
	"return_id" uuid NOT NULL REFERENCES "pos_returns"("id"),
	"amount" numeric(18, 2) NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pos_card_settlement_returns_uq" ON "pos_card_settlement_returns" ("return_id");--> statement-breakpoint
ALTER TABLE "pos_card_settlement_returns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pos_card_settlement_returns" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pos_card_settlement_banks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"settlement_id" uuid NOT NULL REFERENCES "pos_card_settlements"("id"),
	"bank_account_id" uuid NOT NULL REFERENCES "accounts"("id"),
	"gross" numeric(18, 2) NOT NULL,
	"returns_total" numeric(18, 2) NOT NULL,
	"received" numeric(18, 2) NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pos_card_settlement_banks_idx" ON "pos_card_settlement_banks" ("settlement_id");--> statement-breakpoint
ALTER TABLE "pos_card_settlement_banks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pos_card_settlement_banks" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
