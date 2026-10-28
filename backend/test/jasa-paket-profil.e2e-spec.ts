/**
 * Paket profil layanan Jasa: tiap profil punya akun, jenis tagihan, biaya, KPI, laporan, alur kerja, CRM, pengaturan, dan fokus pajak sendiri.
 * Setiap profil dibuat sebagai demo terpisah (mode ketat), lalu dibandingkan satu sama lain.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { REVENUE_KIND_ACCOUNT, PROFILE_REVENUE_ACCOUNTS, SERVICE_PROFILE_KEYS, SERVICE_PROFILE_PACKS, type ServiceProfile } from '@sansu/shared';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';

describe('Paket profil layanan Jasa (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const t = new Map<ServiceProfile, { token: string; tenantId: string }>();
  const get = (p: ServiceProfile, u: string) => http.get(u).set({ Authorization: `Bearer ${t.get(p)!.token}` });
  const codes = async (tenantId: string) => new Set((await db.execute<{ code: string }>(sql`SELECT code FROM accounts WHERE tenant_id = ${tenantId}`)).rows.map((r) => r.code));
  /** Saldo kredit − debit sebuah akun dari buku besar */
  const credit = async (tenantId: string, code: string) =>
    Number((await db.execute<{ v: string }>(sql`SELECT COALESCE(SUM(l.credit - l.debit), 0)::text AS v FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.tenant_id = ${tenantId} AND a.code = ${code}`)).rows[0].v);
  const debit = async (tenantId: string, code: string) => -(await credit(tenantId, code));

  beforeAll(async () => {
    process.env.DEMO_STRICT = 'true';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    db = app.get<Db>(DB);
    http = request(app.getHttpServer());
    for (const p of SERVICE_PROFILE_KEYS) {
      const r = await http.post('/api/demo/start').send({ businessModel: 'JASA', serviceProfile: p }).expect(200);
      const me = (await http.get('/api/auth/me').set({ Authorization: `Bearer ${r.body.accessToken}` }).expect(200)).body;
      t.set(p, { token: r.body.accessToken, tenantId: me.tenantId });
    }
  }, 240_000);
  afterAll(async () => {
    delete process.env.DEMO_STRICT;
    await app.close();
  });

  it('bagan akun: tiap profil hanya memiliki akun pendapatan khas profilnya sendiri', async () => {
    for (const p of SERVICE_PROFILE_KEYS) {
      const mine = await codes(t.get(p)!.tenantId);
      for (const q of SERVICE_PROFILE_KEYS) {
        for (const kind of PROFILE_REVENUE_ACCOUNTS[q]) {
          if (q === p) expect(mine.has(REVENUE_KIND_ACCOUNT[kind])).toBe(true);
          else if (!PROFILE_REVENUE_ACCOUNTS[p].includes(kind)) expect(mine.has(REVENUE_KIND_ACCOUNT[kind])).toBe(false);
        }
      }
      // akun biaya khas profil tersedia untuk pilihan "jenis biaya"
      for (const c of SERVICE_PROFILE_PACKS[p].costTypes) expect(mine.has(c.account)).toBe(true);
    }
  });

  it('laba rugi berbeda per profil: pendapatan dibukukan ke akun jenis layanannya', async () => {
    const id = (p: ServiceProfile) => t.get(p)!.tenantId;
    expect(await credit(id('KONSULTAN'), '4-2510')).toBeGreaterThan(0);
    expect(await credit(id('KONSULTAN'), '4-2520')).toBeGreaterThan(0); // retainer terpisah dari jasa per jam
    expect(await credit(id('KONTRAKTOR'), '4-2100')).toBeGreaterThan(0);
    expect(await credit(id('KONTRAKTOR'), '4-2530')).toBe(48_000_000); // pekerjaan tambah
    expect(await credit(id('PENDIDIKAN'), '4-2610')).toBeGreaterThan(0); // SPP otomatis + les privat
    expect(await credit(id('PENDIDIKAN'), '4-2620')).toBeGreaterThan(0); // uang pendaftaran
    expect(await credit(id('PENDIDIKAN'), '4-2640')).toBeGreaterThan(0); // pelatihan sekolah
    expect(await credit(id('ALIH_DAYA'), '4-2710')).toBeGreaterThan(0); // pos keamanan
    expect(await credit(id('ALIH_DAYA'), '4-2720')).toBeGreaterThan(0); // pos kebersihan
    expect(await credit(id('ALIH_DAYA'), '4-2730')).toBeGreaterThan(0); // layanan tambahan
    expect(await credit(id('BENGKEL'), '4-2810')).toBeGreaterThan(0); // layanan di kasir
    expect(await credit(id('BENGKEL'), '4-1000')).toBeGreaterThan(0); // suku cadang di kasir
    expect(await credit(id('BENGKEL'), '4-2820')).toBeGreaterThan(0); // servis armada
    // biaya khas profil terpakai
    expect(await debit(id('KONTRAKTOR'), '5-1920')).toBeGreaterThan(0);
    expect(await debit(id('PENDIDIKAN'), '5-1810')).toBeGreaterThan(0);
    expect(await debit(id('ALIH_DAYA'), '5-1840')).toBeGreaterThan(0);
    expect(await debit(id('BENGKEL'), '5-1880')).toBeGreaterThan(0);
    expect(await debit(id('KONSULTAN'), '5-1970')).toBeGreaterThan(0);
    // laporan laba rugi tetap seimbang dan baris pendapatannya tidak sama antarprofil
    const lines = new Set<string>();
    for (const p of SERVICE_PROFILE_KEYS) {
      const r = await db.execute<{ codes: string }>(sql`
        SELECT string_agg(DISTINCT a.code, ',' ORDER BY a.code) AS codes FROM journal_lines l JOIN accounts a ON a.id = l.account_id
        WHERE a.tenant_id = ${id(p)} AND a.type = 'REVENUE' AND a.report_group = 'SALES_REVENUE'`);
      lines.add(r.rows[0].codes);
      expect((await get(p, '/api/accounting/reports/trial-balance').expect(200)).body.balanced).toBe(true);
    }
    expect(lines.size).toBe(SERVICE_PROFILE_KEYS.length);
  });

  it('kontrak lokasi: jenis pos tersimpan dan tiap jenis dibukukan ke akun pendapatannya', async () => {
    const kinds = (await db.execute<{ k: string }>(sql`SELECT DISTINCT service_kind AS k FROM site_posts WHERE tenant_id = ${t.get('ALIH_DAYA')!.tenantId} ORDER BY 1`)).rows.map((r) => r.k);
    expect(kinds).toEqual(['CLEANING', 'SECURITY']);
  });

  it('ubin KPI beranda khas profil, hanya untuk profil perusahaan itu', async () => {
    for (const p of SERVICE_PROFILE_KEYS) {
      const tiles = (await get(p, '/api/dashboard/profile-kpis').expect(200)).body.tiles as { key: string; profile: string; value: unknown }[];
      expect(tiles.map((x) => x.key)).toEqual(SERVICE_PROFILE_PACKS[p].kpis.map((k) => k.key));
      expect(tiles.every((x) => x.profile === p)).toBe(true);
    }
    const v = async (p: ServiceProfile, key: string) => ((await get(p, '/api/dashboard/profile-kpis').expect(200)).body.tiles as { key: string; value: number }[]).find((x) => x.key === key)!.value;
    expect(Number(await v('KONTRAKTOR', 'k_contract_active'))).toBeGreaterThan(0);
    expect(Number(await v('KONTRAKTOR', 'k_retention_held'))).toBeGreaterThan(0);
    expect(Number(await v('PENDIDIKAN', 'e_students_active'))).toBeGreaterThan(0);
    expect(Number(await v('PENDIDIKAN', 'e_arrears'))).toBeGreaterThan(0);
    expect(Number(await v('ALIH_DAYA', 'a_sites_active'))).toBe(3);
    expect(Number(await v('KONSULTAN', 's_retainer_mrr'))).toBeGreaterThan(0);
  });

  it('saran beranda memuat temuan khas profil', async () => {
    const ids = async (p: ServiceProfile) => ((await get(p, '/api/dashboard/insights').expect(200)).body.insights as { id: string }[]).map((x) => x.id);
    expect(await ids('KONTRAKTOR')).toContain('kontraktor-tertagih');
    expect(await ids('PENDIDIKAN')).toContain('pendidikan-tunggakan');
    expect((await ids('PENDIDIKAN')).some((x) => x.startsWith('kontraktor-'))).toBe(false);
  });

  it('laporan khas tiap profil terisi; non-Jasa tidak punya ubin profil', async () => {
    const dept: Record<ServiceProfile, [string, string]> = {
      KONSULTAN: ['jasa-konsultan', 'klien'],
      KONTRAKTOR: ['jasa-kontraktor', 'laba-proyek'],
      PENDIDIKAN: ['jasa-pendidikan', 'kelas'],
      ALIH_DAYA: ['jasa-alihdaya', 'margin-lokasi'],
      BENGKEL: ['jasa-bengkel', 'suku-cadang'],
    };
    for (const p of SERVICE_PROFILE_KEYS) {
      const [d, key] = dept[p];
      const from = new Date(Date.now() - 150 * 86_400_000).toISOString().slice(0, 10);
      const r = (await get(p, `/api/dept-reports/${d}?from=${from}`).expect(200)).body;
      const sec = r.sections.find((s: { key: string }) => s.key === key);
      expect(sec?.rows.length).toBeGreaterThan(0);
      expect(r.sections.find((s: { key: string }) => s.key === 'pendapatan-jenis').rows.length).toBeGreaterThan(0);
    }
    const dagang = await http.post('/api/demo/start').send({ businessModel: 'DAGANG' }).expect(200);
    expect((await http.get('/api/dashboard/profile-kpis').set({ Authorization: `Bearer ${dagang.body.accessToken}` }).expect(200)).body.tiles).toEqual([]);
  });

  it('CRM, daftar pengaturan, form produk, alur kerja, dan fokus pajak mengikuti profil', async () => {
    for (const p of SERVICE_PROFILE_KEYS) {
      const pack = SERVICE_PROFILE_PACKS[p];
      const crm = (await get(p, '/api/crm/profile').expect(200)).body;
      expect(crm.noun).toBe(pack.crm.noun);
      expect(crm.sources).toEqual(pack.crm.sources);
      const setup = (await get(p, '/api/onboarding/setup').expect(200)).body;
      expect(setup.items.map((i: { key: string }) => i.key)).toEqual(pack.setup.map((s) => s.key));
      const opts = (await get(p, '/api/products/options').expect(200)).body;
      expect(opts.categories.map((c: { value: string }) => c.value)).toEqual(expect.arrayContaining(pack.product.categories!));
      expect(opts.form.skuLabel).toBe(pack.product.skuLabel);
      const tax = (await get(p, '/api/tax/focus').expect(200)).body;
      expect(tax.focus.title).toBe(pack.taxFocus.title);
    }
    const flows = async (p: ServiceProfile) => ((await get(p, '/api/workflow/settings').expect(200)).body.defaults as { key: string }[]).map((x) => x.key);
    expect(await flows('PENDIDIKAN')).toContain('JASA_PESERTA');
    expect(await flows('PENDIDIKAN')).not.toContain('JASA_PROYEK');
    expect(await flows('ALIH_DAYA')).toContain('JASA_LOKASI');
    expect(await flows('BENGKEL')).toContain('JASA_SERVIS');
    expect(await flows('KONTRAKTOR')).toContain('JASA_PROYEK');
    // pemeriksaan pajak khas: tagihan SPP tidak memuat PPN (demo memakai pengaturan PPN perusahaan)
    const spp = ((await get('PENDIDIKAN', '/api/tax/focus').expect(200)).body.checks as { key: string }[]).map((c) => c.key);
    expect(spp).toContain('SPP_KENA_PPN');
  });

  it('menambah profil menambah akun khasnya tanpa menghapus yang lama', async () => {
    const p: ServiceProfile = 'KONSULTAN';
    const before = await codes(t.get(p)!.tenantId);
    expect(before.has('4-2610')).toBe(false);
    await http.put('/api/settings/business/service-profiles').set({ Authorization: `Bearer ${t.get(p)!.token}` }).send({ profiles: ['KONSULTAN', 'PENDIDIKAN'] }).expect(200);
    const after = await codes(t.get(p)!.tenantId);
    expect(after.has('4-2610')).toBe(true);
    expect(after.has('4-2510')).toBe(true);
    await http.put('/api/settings/business/service-profiles').set({ Authorization: `Bearer ${t.get(p)!.token}` }).send({ profiles: ['PENDIDIKAN'] }).expect(200);
    expect((await codes(t.get(p)!.tenantId)).has('4-2510')).toBe(true); // akun profil lama tidak dihapus
    // gabungan profil: KPI dua profil, istilah tetap umum
    await http.put('/api/settings/business/service-profiles').set({ Authorization: `Bearer ${t.get(p)!.token}` }).send({ profiles: ['KONSULTAN', 'PENDIDIKAN'] }).expect(200);
    const tiles = (await get(p, '/api/dashboard/profile-kpis').expect(200)).body.tiles as { profile: string }[];
    expect(new Set(tiles.map((x) => x.profile))).toEqual(new Set(['KONSULTAN', 'PENDIDIKAN']));
  });

  it('tagihan jasa memakai akun pendapatan jenis tagihan yang dipilih', async () => {
    const p: ServiceProfile = 'BENGKEL';
    const tenantId = t.get(p)!.tenantId;
    const [acc] = (await db.execute<{ id: string }>(sql`SELECT id FROM accounts WHERE tenant_id = ${tenantId} AND code = '4-2820'`)).rows;
    const [cust] = (await db.execute<{ id: string }>(sql`SELECT id FROM customers WHERE tenant_id = ${tenantId} AND code = 'FL-ARMADA'`)).rows;
    const before = await credit(tenantId, '4-2820');
    await http.post('/api/services/invoices').set({ Authorization: `Bearer ${t.get(p)!.token}` })
      .send({ customerId: cust.id, withholdingType: 'PPH23', withholdingRate: '2', lines: [{ description: 'Servis berkala armada — 4 unit', qty: '4', unit: 'Unit', price: '350000', accountId: acc.id }] })
      .expect(201);
    expect(await credit(tenantId, '4-2820')).toBe(before + 1_400_000);
  });
});
