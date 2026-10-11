-- Pengendalian selisih harga faktur (anti-fraud): alasan, penanda, pembuat, persetujuan
ALTER TABLE "purchase_invoices" ADD COLUMN "variance_reason" text;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "variance_note" text;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "price_flags" text;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "created_by_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "approval_id" uuid;
