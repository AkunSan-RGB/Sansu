-- Retur atas faktur valas: nilai retur dalam mata uang faktur
ALTER TABLE "invoices" ADD COLUMN "returned_foreign" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "returned_foreign" numeric(18, 2) DEFAULT '0' NOT NULL;
