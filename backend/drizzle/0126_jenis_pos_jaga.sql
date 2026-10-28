-- Jenis pos jaga kontrak lokasi (keamanan / kebersihan / lainnya): tagihan bulanan dibukukan ke akun pendapatan sesuai jenis layanannya
ALTER TABLE "site_posts" ADD COLUMN IF NOT EXISTS "service_kind" text DEFAULT 'OTHER' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_posts" ADD CONSTRAINT "site_posts_service_kind_chk" CHECK ("service_kind" IN ('SECURITY', 'CLEANING', 'OTHER'));--> statement-breakpoint
UPDATE "site_posts" SET "service_kind" = CASE
  WHEN "name" ~* '(satpam|keamanan|security|jaga|patroli)' THEN 'SECURITY'
  WHEN "name" ~* '(bersih|cleaning|cleaner|kebun|taman)' THEN 'CLEANING'
  ELSE 'OTHER' END;
