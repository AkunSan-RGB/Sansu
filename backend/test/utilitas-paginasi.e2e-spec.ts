/**
 * Paginasi sejati daftar Utilitas (e2e): daftar besar dimuat per halaman dengan jumlah total yang benar, tanpa parameter respons lama tetap
 * berlaku, dan sambungan di luar 500 teratas tetap bisa dibuka (dulu 404 karena detail dicari di daftar yang dipotong 500).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Utilitas: paginasi sejati (e2e)', () => {
  jest.setTimeout(240_000);
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  const N = 620;
  const as = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (await http.post('/api/auth/register').send({ companyName: 'PAM Halaman', name: 'Pemilik', email: `halaman-${Date.now()}@uji.id`, password: 'rahasia123', businessModel: 'UTILITAS' }).expect(201)).body.accessToken;
    await http.post('/api/utility/tariffs').set(as()).send({ name: 'Air RT', serviceType: 'AIR', fixedFee: 10000, adminFee: 2500, blocks: [{ upTo: 10, price: 3000 }, { upTo: null, price: 4500 }] }).expect(201);
    const rows = Array.from({ length: N }, (_, i) => ({ code: `PG-${String(i).padStart(4, '0')}`, name: `Pelanggan Halaman ${i}`, address: `Jl. Halaman ${i}`, tariff: 'Air RT', meterNo: `MH-${i}` }));
    for (let i = 0; i < N; i += 200) {
      const r = await http.post('/api/utility/import/connections').set(as()).send({ rows: rows.slice(i, i + 200) }).expect(201);
      expect(r.body.errors).toBe(0);
    }
  });
  afterAll(() => app.close());

  it('tanpa parameter: larik lama dibatasi 500 (perilaku lama tidak berubah)', async () => {
    const r = await http.get('/api/utility/connections').set(as()).expect(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body).toHaveLength(500);
  });

  it('dengan page: jumlah total benar dan halaman tidak tumpang tindih', async () => {
    const p1 = (await http.get('/api/utility/connections?page=1&pageSize=200').set(as()).expect(200)).body;
    const p4 = (await http.get('/api/utility/connections?page=4&pageSize=200').set(as()).expect(200)).body;
    expect(p1).toMatchObject({ total: N, page: 1, pageSize: 200 });
    expect(p1.rows).toHaveLength(200);
    expect(p4.rows).toHaveLength(N - 600);
    const ids = new Set<string>();
    for (let pg = 1; pg <= 4; pg++) for (const x of (await http.get(`/api/utility/connections?page=${pg}&pageSize=200`).set(as()).expect(200)).body.rows) ids.add(x.id);
    expect(ids.size).toBe(N);
  });

  it('pencarian ikut dihitung di total; ukuran halaman dibatasi 200', async () => {
    const r = (await http.get('/api/utility/connections?page=1&pageSize=99999&search=Halaman 61').set(as()).expect(200)).body;
    expect(r.pageSize).toBe(200);
    expect(r.total).toBe(r.rows.length);
    expect(r.total).toBeGreaterThanOrEqual(10);
  });

  it('sambungan di luar 500 teratas tetap bisa dibuka', async () => {
    const all = (await http.get('/api/utility/connections?page=4&pageSize=200').set(as()).expect(200)).body.rows as { id: string }[];
    expect(all.length).toBeGreaterThan(0);
    const oldest = all[all.length - 1];
    const d = await http.get(`/api/utility/connections/${oldest.id}`).set(as()).expect(200);
    expect(d.body.id).toBe(oldest.id);
  });

  it('daftar belum dicatat meternya: paged total benar; tagihan tertunggak dan daftar tagih mengembalikan bentuk halaman', async () => {
    const period = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7);
    const due = (await http.get(`/api/utility/readings/due?period=${period}&page=2&pageSize=100`).set(as()).expect(200)).body;
    expect(due.total).toBe(N);
    expect(due.rows).toHaveLength(100);
    const od = (await http.get('/api/utility/overdue?page=1&pageSize=50').set(as()).expect(200)).body;
    expect(od).toMatchObject({ rows: [], total: 0, page: 1, pageSize: 50 });
    const wl = (await http.get('/api/utility/collection/worklist?page=1&pageSize=50').set(as()).expect(200)).body;
    expect(wl).toMatchObject({ rows: [], total: 0 });
  });
});
