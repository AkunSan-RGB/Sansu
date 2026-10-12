ALTER TABLE "purchase_invoices" ADD COLUMN "withholding_base" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "withholding_rate" numeric(5, 2);--> statement-breakpoint
UPDATE "purchase_invoices" SET "withholding_rate" = CASE WHEN "withholding_type" = 'PPH4_2' THEN 10 ELSE 2 END, "withholding_base" = ROUND("withholding_amount" * 100 / CASE WHEN "withholding_type" = 'PPH4_2' THEN 10 ELSE 2 END, 2) WHERE "withholding_amount" > 0 AND "withholding_rate" IS NULL;
