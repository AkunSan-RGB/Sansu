CREATE TABLE IF NOT EXISTS "supplier_advances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"number" text NOT NULL,
	"date" date NOT NULL,
	"supplier_id" uuid NOT NULL REFERENCES "suppliers"("id"),
	"purchase_order_id" uuid REFERENCES "purchase_orders"("id"),
	"method" text DEFAULT 'TRANSFER' NOT NULL,
	"cash_account_id" uuid NOT NULL REFERENCES "accounts"("id"),
	"amount" numeric(18, 2) NOT NULL,
	"applied_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"refunded_amount" numeric(18, 2) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"description" text,
	"journal_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_id" uuid,
	"void_reason" text,
	"void_journal_id" uuid,
	CONSTRAINT "supplier_advances_amount_ck" CHECK ("amount" > 0),
	CONSTRAINT "supplier_advances_balance_ck" CHECK ("applied_amount" >= 0 AND "refunded_amount" >= 0 AND "applied_amount" + "refunded_amount" <= "amount"),
	CONSTRAINT "supplier_advances_status_ck" CHECK ("status" IN ('OPEN', 'CLOSED', 'VOID'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_advances_number_uq" ON "supplier_advances" ("tenant_id", "number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_advances_supplier_idx" ON "supplier_advances" ("tenant_id", "supplier_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_advances_po_idx" ON "supplier_advances" ("purchase_order_id");--> statement-breakpoint
ALTER TABLE "supplier_advances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "supplier_advances" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_advance_movements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"advance_id" uuid NOT NULL REFERENCES "supplier_advances"("id"),
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"purchase_invoice_id" uuid REFERENCES "purchase_invoices"("id"),
	"cash_account_id" uuid REFERENCES "accounts"("id"),
	"note" text,
	"journal_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_advance_movements_amount_ck" CHECK ("amount" > 0),
	CONSTRAINT "supplier_advance_movements_kind_ck" CHECK ("kind" IN ('APPLY', 'REFUND'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_advance_movements_number_uq" ON "supplier_advance_movements" ("tenant_id", "number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_advance_movements_adv_idx" ON "supplier_advance_movements" ("advance_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_advance_movements_inv_idx" ON "supplier_advance_movements" ("purchase_invoice_id");--> statement-breakpoint
ALTER TABLE "supplier_advance_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "supplier_advance_movements" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
