-- Tabel tanpa kolom tenant_id (mis. auth_tokens) tidak boleh tunduk pada RLS: kebijakan tenant tidak berlaku di sana
-- dan menolak INSERT (galat "new row violates row-level security policy"). Aman dijalankan berulang.
DO $$
DECLARE
  r record;
  p record;
BEGIN
  FOR r IN
    SELECT c.relname AS t
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind = 'r' AND c.relrowsecurity
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns k
        WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'tenant_id'
      )
  LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = r.t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, r.t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.t);
  END LOOP;
END $$;
