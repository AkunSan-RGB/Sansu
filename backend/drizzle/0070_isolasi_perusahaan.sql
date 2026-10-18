-- Isolasi data antar perusahaan di tingkat database (lapis tambahan di atas RLS):
-- 1) Setiap baris yang menunjuk ke baris lain lewat foreign key WAJIB menunjuk ke baris milik perusahaan yang sama.
--    (Pemeriksaan foreign key bawaan PostgreSQL melewati RLS, sehingga UUID milik perusahaan lain bisa lolos bila kode lupa memeriksa.)
-- 2) Tabel baris anak (baris faktur, baris jurnal, slip gaji, dst.) yang tidak punya tenant_id ikut tunduk pada RLS induknya.
-- Fungsi ini dapat dijalankan ulang; migrasi yang menambah tabel baru harus memanggil SELECT sansu_install_tenant_guards();
CREATE OR REPLACE FUNCTION sansu_install_tenant_guards() RETURNS integer LANGUAGE plpgsql AS $fn$
DECLARE
  t record; f record; hc text; hp text;
  body text; cols text; tenant_expr text; n integer := 0; has_tenant boolean;
BEGIN
  FOR t IN
    SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relname NOT IN ('tenants', 'plans', 'platform_settings', 'auth_tokens')
  LOOP
    SELECT EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = t.relname AND k.column_name = 'tenant_id') INTO has_tenant;
    hc := NULL; hp := NULL;
    IF has_tenant THEN
      tenant_expr := 'NEW.tenant_id';
    ELSE
      -- tabel anak: perusahaan ditentukan induknya (utamakan foreign key CASCADE ke tabel ber-tenant_id)
      SELECT a.attname, pl.relname INTO hc, hp
      FROM pg_constraint c JOIN pg_class pl ON pl.oid = c.confrelid JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.conrelid = t.oid AND c.contype = 'f' AND array_length(c.conkey, 1) = 1
        AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = pl.relname AND k.column_name = 'tenant_id')
      ORDER BY (c.confdeltype = 'c') DESC, c.conname LIMIT 1;
      IF hc IS NULL THEN CONTINUE; END IF;
      tenant_expr := format('(SELECT h.tenant_id FROM public.%I h WHERE h.id = NEW.%I)', hp, hc);
    END IF;

    body := ''; cols := '';
    FOR f IN
      SELECT a.attname AS col, pl.relname AS parent, pa.attname AS pcol
      FROM pg_constraint c JOIN pg_class pl ON pl.oid = c.confrelid
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
      WHERE c.conrelid = t.oid AND c.contype = 'f' AND array_length(c.conkey, 1) = 1
        AND pl.relname <> 'tenants'
        AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = pl.relname AND k.column_name = 'tenant_id')
        AND (hc IS NULL OR a.attname <> hc)
      ORDER BY a.attname
    LOOP
      body := body || format(
        'IF NEW.%1$I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.%2$I p WHERE p.%3$I = NEW.%1$I AND p.tenant_id = tv) THEN RAISE EXCEPTION %4$L USING ERRCODE = ''23503''; END IF; ',
        f.col, f.parent, f.pcol, format('Data lintas perusahaan ditolak: %s.%s menunjuk ke %s milik perusahaan lain', t.relname, f.col, f.parent));
      cols := cols || CASE WHEN cols = '' THEN '' ELSE ', ' END || quote_ident(f.col);
    END LOOP;

    EXECUTE format('DROP TRIGGER IF EXISTS sansu_tenant_guard ON public.%I', t.relname);
    IF body = '' THEN CONTINUE; END IF;
    IF has_tenant THEN cols := cols || ', tenant_id'; END IF;
    EXECUTE format('CREATE OR REPLACE FUNCTION public.%I() RETURNS trigger LANGUAGE plpgsql AS $b$ DECLARE tv uuid; BEGIN tv := %s; IF tv IS NULL THEN RETURN NEW; END IF; %s RETURN NEW; END $b$',
      'sansu_tg_' || t.relname, tenant_expr, body);
    EXECUTE format('CREATE TRIGGER sansu_tenant_guard BEFORE INSERT OR UPDATE OF %s ON public.%I FOR EACH ROW EXECUTE FUNCTION public.%I()', cols, t.relname, 'sansu_tg_' || t.relname);
    n := n + 1;
  END LOOP;

  -- RLS untuk tabel anak: baris hanya terlihat bila baris induknya terlihat (induk sendiri sudah dibatasi per perusahaan)
  FOR t IN
    SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relname NOT IN ('tenants', 'plans', 'platform_settings', 'auth_tokens')
      AND NOT EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'tenant_id')
  LOOP
    hc := NULL; hp := NULL;
    SELECT a.attname, pl.relname INTO hc, hp
    FROM pg_constraint c JOIN pg_class pl ON pl.oid = c.confrelid JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.conrelid = t.oid AND c.contype = 'f' AND array_length(c.conkey, 1) = 1
      AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = pl.relname AND k.column_name = 'tenant_id')
    ORDER BY (c.confdeltype = 'c') DESC, c.conname LIMIT 1;
    IF hc IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t.relname);
    EXECUTE format('CREATE POLICY tenant_isolation ON public.%1$I USING (EXISTS (SELECT 1 FROM public.%2$I h WHERE h.id = %3$I)) WITH CHECK (EXISTS (SELECT 1 FROM public.%2$I h WHERE h.id = %3$I))', t.relname, hp, hc);
  END LOOP;
  RETURN n;
END
$fn$;--> statement-breakpoint
SELECT sansu_install_tenant_guards();
