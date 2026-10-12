-- Persetujuan transaksi bernilai besar: permintaan dari peran yang tidak berwenang menunggu keputusan pemilik / admin.
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text,
	"title" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"payload" jsonb,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"result_ref" text
);--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_requests_status_idx" ON "approval_requests" USING btree ("tenant_id","status","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_pending_uq" ON "approval_requests" USING btree ("tenant_id","kind","ref_id") WHERE "status" IN ('PENDING', 'APPROVED') AND "ref_id" IS NOT NULL;
