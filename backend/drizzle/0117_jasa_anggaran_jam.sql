-- Jasa: anggaran biaya per proyek (pengendalian overrun) dan jam termasuk pada retainer (kelebihan jam ditagih terpisah)
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "cost_budget" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "service_retainers" ADD COLUMN IF NOT EXISTS "included_hours" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "service_retainers" ADD COLUMN IF NOT EXISTS "overage_rate" numeric(18, 2);
