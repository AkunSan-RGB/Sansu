-- Supplier favorit dengan batas persetujuan otomatis
ALTER TABLE "suppliers" ADD COLUMN "is_preferred" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "auto_approve_limit" numeric(18, 2) DEFAULT '0' NOT NULL;
