-- Row-level security: lapisan pengaman terakhir di dasar database untuk isolasi antar perusahaan.
-- Aplikasi (API) berganti ke peran `sansu_app` yang TIDAK melewati RLS; kebijakan hanya meloloskan baris
-- dengan tenant_id = perusahaan aktif sesi (app.tenant_id), atau semua baris bila sesi bypass (login, panel pemilik, tugas latar).
-- Pemilik tabel (migrasi, seed, cadangan) tidak terkena RLS karena tidak memakai FORCE.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sansu_app') THEN
    CREATE ROLE sansu_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
GRANT sansu_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO sansu_app;
--> statement-breakpoint
GRANT ALL ON ALL TABLES IN SCHEMA public TO sansu_app;
--> statement-breakpoint
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO sansu_app;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO sansu_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO sansu_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO sansu_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO sansu_app;
--> statement-breakpoint
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', r.table_name);
    EXECUTE format(
      $p$CREATE POLICY tenant_isolation ON public.%I
         USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on')
         WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on')$p$,
      r.table_name);
  END LOOP;
END $$;
