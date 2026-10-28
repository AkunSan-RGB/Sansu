-- Pendidikan/kursus: kelas (SPP bulanan), peserta terdaftar (dengan wali penanggung tagihan), dan catatan SPP yang sudah ditagih per periode
CREATE TABLE IF NOT EXISTS "edu_classes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"monthly_fee" numeric(18, 2) NOT NULL,
	"capacity" integer,
	"start_date" date NOT NULL,
	"end_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "edu_classes_code_uq" ON "edu_classes" ("tenant_id","code");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "edu_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"class_id" uuid NOT NULL REFERENCES "edu_classes"("id"),
	"customer_id" uuid NOT NULL REFERENCES "customers"("id"),
	"student_name" text NOT NULL,
	"enrolled_on" date NOT NULL,
	"left_on" date,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "edu_enrollments_class_idx" ON "edu_enrollments" ("class_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "edu_enrollments_customer_idx" ON "edu_enrollments" ("customer_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "edu_fee_invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"enrollment_id" uuid NOT NULL REFERENCES "edu_enrollments"("id"),
	"period" text NOT NULL,
	"invoice_id" uuid NOT NULL REFERENCES "invoices"("id"),
	"amount" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "edu_fee_invoices_uq" ON "edu_fee_invoices" ("enrollment_id","period");--> statement-breakpoint
ALTER TABLE "edu_classes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "edu_enrollments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "edu_fee_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "edu_classes" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY tenant_isolation ON "edu_enrollments" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY tenant_isolation ON "edu_fee_invoices" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
