-- Layanan air lanjutan: pengaduan, perintah kerja, aset jaringan, permohonan sambungan, mutasi, koreksi, jaminan, angsuran, rute, meter, kunjungan, pemberitahuan, portal, produksi dan kualitas air.
CREATE TABLE IF NOT EXISTS "utility_complaints" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"number" text NOT NULL,
	"connection_id" uuid REFERENCES "utility_connections"("id"),
	"customer_id" uuid REFERENCES "customers"("id"),
	"reporter_name" text,
	"reporter_phone" text,
	"category" text NOT NULL,
	"priority" text DEFAULT 'NORMAL' NOT NULL,
	"channel" text DEFAULT 'TELEPON' NOT NULL,
	"description" text NOT NULL,
	"location" text,
	"status" text DEFAULT 'BARU' NOT NULL,
	"assigned_to_id" uuid,
	"assigned_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"work_order_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_complaints_number_uq" ON "utility_complaints" ("tenant_id","number");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_complaint_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"complaint_id" uuid NOT NULL REFERENCES "utility_complaints"("id"),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_network_assets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"zone" text,
	"location" text,
	"installed_on" date,
	"condition" text DEFAULT 'BAIK' NOT NULL,
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_network_assets_code_uq" ON "utility_network_assets" ("tenant_id","code");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_work_orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"number" text NOT NULL,
	"asset_id" uuid REFERENCES "utility_network_assets"("id"),
	"complaint_id" uuid REFERENCES "utility_complaints"("id"),
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"priority" text DEFAULT 'NORMAL' NOT NULL,
	"status" text DEFAULT 'DIBUAT' NOT NULL,
	"assigned_to_id" uuid,
	"planned_on" date,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"labor_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"material_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"result" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_work_orders_number_uq" ON "utility_work_orders" ("tenant_id","number");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_applications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"number" text NOT NULL,
	"applicant_name" text NOT NULL,
	"phone" text,
	"id_number" text,
	"address" text NOT NULL,
	"geo_lat" numeric(9, 6),
	"geo_lng" numeric(9, 6),
	"tariff_id" uuid REFERENCES "utility_tariffs"("id"),
	"customer_id" uuid REFERENCES "customers"("id"),
	"requested_on" date NOT NULL,
	"status" text DEFAULT 'PERMOHONAN' NOT NULL,
	"survey_note" text,
	"survey_by_id" uuid,
	"surveyed_at" timestamp with time zone,
	"pipe_length" numeric(18, 2),
	"feasible" boolean,
	"cost_invoice_id" uuid REFERENCES "invoices"("id"),
	"install_note" text,
	"installer_id" uuid,
	"meter_serial" text,
	"connection_id" uuid REFERENCES "utility_connections"("id"),
	"activated_at" timestamp with time zone,
	"closed_reason" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_applications_number_uq" ON "utility_applications" ("tenant_id","number");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_connection_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"connection_id" uuid NOT NULL REFERENCES "utility_connections"("id"),
	"kind" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text NOT NULL,
	"status" text DEFAULT 'DIAJUKAN' NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"number" text NOT NULL,
	"invoice_id" uuid NOT NULL REFERENCES "invoices"("id"),
	"connection_id" uuid REFERENCES "utility_connections"("id"),
	"kind" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'DIAJUKAN' NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"return_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_adjustments_number_uq" ON "utility_adjustments" ("tenant_id","number");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_deposits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL REFERENCES "customers"("id"),
	"connection_id" uuid REFERENCES "utility_connections"("id"),
	"amount" numeric(18, 2) NOT NULL,
	"received_on" date NOT NULL,
	"method" text DEFAULT 'TRANSFER' NOT NULL,
	"cash_account_id" uuid,
	"journal_id" uuid,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_deposits_number_uq" ON "utility_deposits" ("tenant_id","number");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_deposit_movements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"deposit_id" uuid NOT NULL REFERENCES "utility_deposits"("id"),
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"invoice_id" uuid REFERENCES "invoices"("id"),
	"payment_id" uuid,
	"journal_id" uuid,
	"user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_installment_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL REFERENCES "customers"("id"),
	"connection_id" uuid REFERENCES "utility_connections"("id"),
	"total" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'DIAJUKAN' NOT NULL,
	"note" text,
	"requested_by_id" uuid NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"start_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_installment_plans_number_uq" ON "utility_installment_plans" ("tenant_id","number");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_installment_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"plan_id" uuid NOT NULL REFERENCES "utility_installment_plans"("id"),
	"seq" integer NOT NULL,
	"due_date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_installment_items_seq_uq" ON "utility_installment_items" ("plan_id","seq");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_installment_invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"plan_id" uuid NOT NULL REFERENCES "utility_installment_plans"("id"),
	"invoice_id" uuid NOT NULL REFERENCES "invoices"("id"),
	"paid_at_start" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_installment_invoices_invoice_uq" ON "utility_installment_invoices" ("plan_id","invoice_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_routes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"reader_id" uuid,
	"collector_id" uuid,
	"zone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_routes_code_uq" ON "utility_routes" ("tenant_id","code");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_meters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"serial" text NOT NULL,
	"brand" text,
	"size" text,
	"status" text DEFAULT 'STOK' NOT NULL,
	"connection_id" uuid REFERENCES "utility_connections"("id"),
	"installed_on" date,
	"last_calibrated_on" date,
	"next_calibration_on" date,
	"initial_reading" numeric(18, 4) DEFAULT '0' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_meters_serial_uq" ON "utility_meters" ("tenant_id","serial");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_meter_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"meter_id" uuid NOT NULL REFERENCES "utility_meters"("id"),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"connection_id" uuid,
	"user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_collection_visits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"connection_id" uuid NOT NULL REFERENCES "utility_connections"("id"),
	"invoice_id" uuid REFERENCES "invoices"("id"),
	"collector_id" uuid NOT NULL,
	"visited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text NOT NULL,
	"promised_on" date,
	"promised_amount" numeric(18, 2),
	"note" text,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_notices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"kind" text NOT NULL,
	"connection_id" uuid REFERENCES "utility_connections"("id"),
	"invoice_id" uuid REFERENCES "invoices"("id"),
	"channel" text NOT NULL,
	"sent_by_id" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_portal_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"connection_id" uuid NOT NULL REFERENCES "utility_connections"("id"),
	"token" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_portal_tokens_conn_uq" ON "utility_portal_tokens" ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_portal_tokens_token_uq" ON "utility_portal_tokens" ("token");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_production" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"date" date NOT NULL,
	"source" text NOT NULL,
	"produced" numeric(18, 2) NOT NULL,
	"distributed" numeric(18, 2) NOT NULL,
	"own_use" numeric(18, 2) DEFAULT '0' NOT NULL,
	"energy_kwh" numeric(18, 2),
	"chemical_note" text,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "utility_production_day_uq" ON "utility_production" ("tenant_id","date","source");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "utility_water_quality" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"sampled_on" date NOT NULL,
	"point" text NOT NULL,
	"ph" numeric(5, 2),
	"turbidity" numeric(8, 2),
	"chlorine" numeric(8, 2),
	"coliform" numeric(10, 2),
	"tds" numeric(10, 2),
	"ok" boolean NOT NULL,
	"failed" text[] DEFAULT '{}' NOT NULL,
	"sampler_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "utility_connections" ADD COLUMN IF NOT EXISTS "route_id" uuid REFERENCES "utility_routes"("id");--> statement-breakpoint
ALTER TABLE "utility_connections" ADD COLUMN IF NOT EXISTS "route_seq" integer;--> statement-breakpoint
ALTER TABLE "utility_readings" ADD COLUMN IF NOT EXISTS "estimated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_complaints_tenant_idx" ON "utility_complaints" ("tenant_id");--> statement-breakpoint
ALTER TABLE "utility_complaints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_complaints" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_complaint_events_tenant_idx" ON "utility_complaint_events" ("tenant_id");--> statement-breakpoint
ALTER TABLE "utility_complaint_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_complaint_events" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_network_assets_tenant_idx" ON "utility_network_assets" ("tenant_id");--> statement-breakpoint
ALTER TABLE "utility_network_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_network_assets" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_work_orders_tenant_idx" ON "utility_work_orders" ("tenant_id");--> statement-breakpoint
ALTER TABLE "utility_work_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_work_orders" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_applications_tenant_idx" ON "utility_applications" ("tenant_id");--> statement-breakpoint
ALTER TABLE "utility_applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_applications" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_connection_changes_tenant_idx" ON "utility_connection_changes" ("tenant_id");--> statement-breakpoint
ALTER TABLE "utility_connection_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_connection_changes" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_adjustments_tenant_idx" ON "utility_adjustments" ("tenant_id");--> statement-breakpoint
ALTER TABLE "utility_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_adjustments" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_deposits_tenant_idx" ON "utility_deposits" ("tenant_id");--> statement-breakpoint
ALTER TABLE "utility_deposits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_deposits" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_deposit_movements_tenant_idx" ON "utility_deposit_movements" ("tenant_id");--> statement-breakpoint
ALTER TABLE "utility_deposit_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_deposit_movements" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_installment_plans_tenant_idx" ON "utility_installment_plans" ("tenant_id");--> statement-breakpoint
ALTER TABLE "utility_installment_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_installment_plans" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_installment_items_tenant_idx" ON "utility_installment_items" ("tenant_id");--> statement-breakpoint
ALTER TABLE "utility_installment_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_installment_items" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_installment_invoices_tenant_idx" ON "utility_installment_invoices" ("tenant_id");--> statement-breakpoint
ALTER TABLE "utility_installment_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_installment_invoices" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_routes_tenant_idx" ON "utility_routes" ("tenant_id");--> statement-breakpoint
ALTER TABLE "utility_routes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_routes" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_meters_tenant_idx" ON "utility_meters" ("tenant_id");--> statement-breakpoint
ALTER TABLE "utility_meters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_meters" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_meter_events_tenant_idx" ON "utility_meter_events" ("tenant_id");--> statement-breakpoint
ALTER TABLE "utility_meter_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_meter_events" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_collection_visits_tenant_idx" ON "utility_collection_visits" ("tenant_id");--> statement-breakpoint
ALTER TABLE "utility_collection_visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_collection_visits" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_notices_tenant_idx" ON "utility_notices" ("tenant_id");--> statement-breakpoint
ALTER TABLE "utility_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_notices" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_portal_tokens_tenant_idx" ON "utility_portal_tokens" ("tenant_id");--> statement-breakpoint
ALTER TABLE "utility_portal_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_portal_tokens" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_production_tenant_idx" ON "utility_production" ("tenant_id");--> statement-breakpoint
ALTER TABLE "utility_production" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_production" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_water_quality_tenant_idx" ON "utility_water_quality" ("tenant_id");--> statement-breakpoint
ALTER TABLE "utility_water_quality" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "utility_water_quality" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
