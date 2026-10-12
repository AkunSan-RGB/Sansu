CREATE TABLE "error_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" integer NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"message" text NOT NULL,
	"stack" text,
	"tenant_id" uuid,
	"user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD COLUMN "subtotal" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD COLUMN "vat_rate" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD COLUMN "vat_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD COLUMN "offline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD COLUMN "received_qty" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "status" text DEFAULT 'RECEIVED' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "received_date" date;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "received_by_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "receive_notes" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_backup_codes" jsonb;--> statement-breakpoint
CREATE INDEX "error_logs_at_idx" ON "error_logs" USING btree ("at");--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_received_by_id_users_id_fk" FOREIGN KEY ("received_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_orders_client_uq" ON "pos_orders" USING btree ("tenant_id","client_id") WHERE client_id IS NOT NULL;--> statement-breakpoint
-- Tagihan lama: harga paket = total (tanpa PPN)
UPDATE "billing_invoices" SET "subtotal" = "amount" WHERE "subtotal" = 0;
--> statement-breakpoint
UPDATE "stock_transfer_lines" SET "received_qty" = "qty" WHERE "received_qty" IS NULL;
--> statement-breakpoint
UPDATE "stock_transfers" SET "received_date" = "date", "received_at" = "created_at" WHERE "received_date" IS NULL;
