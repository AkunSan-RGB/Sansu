-- Tabel global (tanpa tenant_id) tidak boleh tunduk pada RLS: tanpa kebijakan yang cocok, RLS menolak semua baca/tulis sehingga
-- pendaftaran, demo, dan login gagal (galat 42501 "new row violates row-level security policy for table tenants").
-- Migrasi 0039 sudah melakukannya sekali; ini memulihkan bila RLS aktif kembali di database yang sudah berjalan. Aman dijalankan berulang.
DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants', 'plans', 'platform_settings', 'auth_tokens']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
