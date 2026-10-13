-- Kontrol kas & bank: pembatalan terkontrol (transaksi tidak dihapus, dibalik dengan jurnal pembalik)
ALTER TABLE "cash_transactions" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'POSTED' NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD COLUMN IF NOT EXISTS "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD COLUMN IF NOT EXISTS "voided_by_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD COLUMN IF NOT EXISTS "void_reason" text;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD COLUMN IF NOT EXISTS "void_journal_id" uuid;
