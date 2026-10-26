-- Indeks untuk puluhan ribu sambungan: pencarian loket, tunggakan, laporan, dan penagihan tidak lagi memindai seluruh tabel
CREATE INDEX IF NOT EXISTS "service_invoice_lines_invoice_idx" ON "service_invoice_lines" ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_tenant_status_due_idx" ON "invoices" ("tenant_id","status","due_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_tenant_date_idx" ON "invoices" ("tenant_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_invoice_idx" ON "payments" ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_tenant_date_idx" ON "payments" ("tenant_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_bills_tenant_period_idx" ON "utility_bills" ("tenant_id","period");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_connections_tenant_status_idx" ON "utility_connections" ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_connections_route_idx" ON "utility_connections" ("tenant_id","route_id","route_seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_collection_visits_conn_idx" ON "utility_collection_visits" ("connection_id","visited_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_notices_conn_idx" ON "utility_notices" ("connection_id","sent_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_complaints_status_idx" ON "utility_complaints" ("tenant_id","status","due_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "utility_complaints_conn_idx" ON "utility_complaints" ("connection_id");
