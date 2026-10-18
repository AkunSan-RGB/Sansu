-- Pencocokan bank satu-ke-banyak: satu mutasi bank (mis. setoran gabungan) cocok dengan beberapa baris buku.
-- Baris buku pertama tetap di bank_statement_lines.journal_line_id; sisanya di tabel ini.
CREATE TABLE IF NOT EXISTS "bank_line_extra_matches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
	"line_id" uuid NOT NULL REFERENCES "bank_statement_lines"("id") ON DELETE CASCADE,
	"journal_line_id" uuid NOT NULL REFERENCES "journal_lines"("id") ON DELETE CASCADE
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_extra_matches_jl_uq" ON "bank_line_extra_matches" ("journal_line_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_extra_matches_line_idx" ON "bank_line_extra_matches" ("line_id");--> statement-breakpoint
ALTER TABLE "bank_line_extra_matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "bank_line_extra_matches" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
SELECT sansu_install_tenant_guards();
