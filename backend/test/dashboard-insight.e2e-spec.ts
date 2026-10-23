/**
 * Insight & rekomendasi beranda (e2e): tiap jenis usaha menghasilkan tren 6 bulan dan saran yang utuh (tanpa NaN/undefined),
 * hanya untuk peran keuangan, dan angka kunci cocok dengan pembukuan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const MODELS = ['DAGANG', 'RITEL', 'JASA', 'FMCG', 'MANUFAKTUR', 'FNB', 'UTILITAS'];

describe('Insight beranda (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  it.each(MODELS)('%s: saran utuh dan tren 6 bulan', async (model) => {
    const token = (await http.post('/api/demo/start').send({ businessModel: model }).expect(200)).body.accessToken as string;
    const r = (await http.get('/api/dashboard/insights').set({ Authorization: `Bearer ${token}` }).expect(200)).body;
    expect(r.trend).toHaveLength(6);
    expect(r.summary.headline).toBeTruthy();
    expect(r.insights.length).toBeGreaterThan(0);
    expect(r.insights.length).toBeLessThanOrEqual(10);
    const ids = new Set<string>();
    for (const i of r.insights) {
      expect(ids.has(i.id)).toBe(false);
      ids.add(i.id);
      for (const f of [i.title, i.evidence, i.recommendation]) {
        expect(f.length).toBeGreaterThan(10);
        expect(f).not.toMatch(/NaN|undefined|Infinity|null/);
      }
      expect(['warning', 'opportunity', 'good', 'info']).toContain(i.tone);
      expect(Number.isFinite(i.score)).toBe(true);
    }
    // urut menurut prioritas
    const scores = r.insights.map((i: { score: number }) => i.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    // bulan berjalan pada tren sama dengan penjualan di beranda
    const dash = (await http.get('/api/dashboard').set({ Authorization: `Bearer ${token}` }).expect(200)).body;
    expect(Number(r.trend[5].sales).toFixed(2)).toBe(Number(dash.salesMonth).toFixed(2));
  }, 120_000); // pembuatan demo F&B ±25 detik

  it('hanya peran keuangan; peran lain ditolak', async () => {
    const owner = (await http.post('/api/demo/start').send({ businessModel: 'DAGANG' }).expect(200)).body.accessToken as string;
    const as = (t: string) => ({ Authorization: `Bearer ${t}` });
    for (const [role, status] of [['SALES', 403], ['WAREHOUSE', 403], ['CASHIER', 403], ['HR', 403], ['FINANCE', 200], ['ACCOUNTANT', 200], ['ADMIN', 200]] as const) {
      const email = `ins-${role.toLowerCase()}-${Date.now()}@uji.id`;
      await http.post('/api/users').set(as(owner)).send({ name: role, email, password: 'rahasia12345', role }).expect(201);
      const t = (await http.post('/api/auth/login').send({ email, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
      await http.get('/api/dashboard/insights').set(as(t)).expect(status);
    }
  });

  it('perusahaan baru tanpa data: tidak galat dan tidak berhalusinasi', async () => {
    const t = (await http.post('/api/auth/register').send({ companyName: 'PT Kosong Ins', name: 'Pemilik', email: `ins-kosong-${Date.now()}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken as string;
    const r = (await http.get('/api/dashboard/insights').set({ Authorization: `Bearer ${t}` }).expect(200)).body;
    expect(r.trend).toHaveLength(6);
    expect(r.insights).toEqual([]);
    expect(r.summary.headline).toContain('Belum cukup data');
  });
});
