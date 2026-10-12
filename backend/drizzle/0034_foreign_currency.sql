-- Mata uang asing: kurs harian, dokumen jual/beli dalam valas, selisih kurs terealisasi dan belum terealisasi
CREATE TABLE "exchange_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"date" date NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rates_uq" ON "exchange_rates" USING btree ("tenant_id","currency","date");--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "currency" text DEFAULT 'IDR' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "fx_rate" numeric(18, 6) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "total_foreign" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "price_foreign" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "price_foreign" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "currency" text DEFAULT 'IDR' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "fx_rate" numeric(18, 6) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "total_foreign" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paid_foreign" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "currency" text DEFAULT 'IDR' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "amount_foreign" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "fx_rate" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "cash_amount" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "fx_gain_loss" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "currency" text DEFAULT 'IDR' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "fx_rate" numeric(18, 6) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "total_foreign" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "price_foreign" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "currency" text DEFAULT 'IDR' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "fx_rate" numeric(18, 6) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "total_foreign" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "paid_foreign" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "currency" text DEFAULT 'IDR' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "amount_foreign" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "fx_rate" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "cash_amount" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "fx_gain_loss" numeric(18, 2) DEFAULT '0' NOT NULL;
