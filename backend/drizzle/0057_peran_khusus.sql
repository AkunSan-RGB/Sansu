-- Peran khusus: peran dasar dikurangi hak tulis tertentu (hanya mempersempit, dikelola Pemilik)
CREATE TABLE "custom_roles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"base_role" "role" NOT NULL,
	"denied" text[] DEFAULT '{}' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_base_chk" CHECK ("base_role" <> 'OWNER');--> statement-breakpoint
CREATE UNIQUE INDEX "custom_roles_name_uq" ON "custom_roles" USING btree ("tenant_id", lower("name"));--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "custom_role_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_custom_role_id_custom_roles_id_fk" FOREIGN KEY ("custom_role_id") REFERENCES "public"."custom_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "custom_roles" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
