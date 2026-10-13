/**
 * Impor aset tetap lama (e2e): tanpa jurnal, penyusutan lanjut bulan setelah tanggal saldo awal, validasi baris.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Impor aset tetap lama (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let kategori: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const get = (url: string) => http.get(url).set(auth());
  const imp = (rows: object[], extra: object = {}) => http.post('/api/imports').set(auth()).send({ kind: 'assets', rows, date: '2025-12-31', ...extra });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (
      await http.post('/api/auth/register').send({ companyName: 'PT Aset', name: 'Pemilik', email: `aset-${Date.now()}@uji.id`, password: 'rahasia123' }).expect(201)
    ).body.accessToken;
    kategori = ((await get('/api/assets/categories').expect(200)).body as { name: string }[])[0].name;
  });
  afterAll(() => app.close());

  it('menyimpan aset lama tanpa jurnal baru, kode otomatis bila kosong', async () => {
    const before = (await get('/api/accounting/journals').expect(200)).body;
    const count = (b: unknown) => (Array.isArray(b) ? b.length : ((b as { total?: number }).total ?? 0));
    const rows = [
      { kode: 'KDR-001', nama: 'Truk Lama', kategori, tanggal_perolehan: '15/03/2022', harga_perolehan: 240000000, akumulasi_penyusutan: 90000000 },
      { nama: 'Laptop Lama', kategori: kategori.toUpperCase(), tanggal_perolehan: '2023-07-01', harga_perolehan: 12000000 },
    ];
    const pre = (await imp(rows).expect(200)).body;
    expect(pre.summary).toMatchObject({ total: 2, create: 2, errors: 0 });
    await imp(rows, { dryRun: false }).expect(200);
    const list = (await get('/api/assets').expect(200)).body as { code: string; name: string }[] | { rows: { code: string; name: string }[] };
    const arr = Array.isArray(list) ? list : list.rows;
    expect(arr.map((a) => a.code).sort()).toEqual(['AT-0001', 'KDR-001']);
    expect(count((await get('/api/accounting/journals').expect(200)).body)).toBe(count(before));
  });

  it('menolak: kode ganda, kategori tak dikenal, akumulasi berlebih, tanggal sesudah saldo awal', async () => {
    const bad = (await imp([
      { kode: 'KDR-001', nama: 'Ganda', kategori, tanggal_perolehan: '2022-01-01', harga_perolehan: 1000000 },
      { nama: 'Tanpa kategori', kategori: 'Tidak Ada', tanggal_perolehan: '2022-01-01', harga_perolehan: 1000000 },
      { nama: 'Akumulasi lebih', kategori, tanggal_perolehan: '2022-01-01', harga_perolehan: 1000000, akumulasi_penyusutan: 2000000 },
      { nama: 'Masa depan', kategori, tanggal_perolehan: '2026-02-01', harga_perolehan: 1000000 },
    ]).expect(200)).body;
    expect(bad.summary.errors).toBe(4);
    const msg = bad.results.map((r: { errors: string[] }) => r.errors.join(' ')).join(' | ');
    expect(msg).toMatch(/sudah dipakai/);
    expect(msg).toMatch(/tidak ada/i);
    expect(msg).toMatch(/melebihi/);
    expect(msg).toMatch(/setelah tanggal saldo awal/);
    await imp([{ nama: 'X', kategori: 'Tidak Ada', tanggal_perolehan: '2022-01-01', harga_perolehan: 1 }], { dryRun: false }).expect(400);
  });
});
