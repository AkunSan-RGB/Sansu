-- Notifikasi Telegram per pengguna: chat ID setelah menghubungkan bot, dan kode tautan sekali pakai
ALTER TABLE "users" ADD COLUMN "telegram_chat_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_link_code" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_link_expires" timestamp with time zone;
