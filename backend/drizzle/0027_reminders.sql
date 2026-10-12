-- Pengingat otomatis: email pelanggan, tunda pengingat, catatan pengiriman
ALTER TABLE "customers" ADD COLUMN "email" text;--> statement-breakpoint
CREATE TABLE "reminder_snoozes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"until" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "reminder_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"stage" text NOT NULL,
	"sent_to" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "reminder_snoozes" ADD CONSTRAINT "reminder_snoozes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_snoozes" ADD CONSTRAINT "reminder_snoozes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_log" ADD CONSTRAINT "reminder_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_snoozes_user_key_uq" ON "reminder_snoozes" USING btree ("user_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_log_uq" ON "reminder_log" USING btree ("tenant_id","kind","ref","stage");
