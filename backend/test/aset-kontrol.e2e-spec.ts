/**
 * Kontrol & otomatisasi aset tetap (e2e): penyusutan otomatis, temuan kontrol, pemeriksaan fisik,
 * penanggung jawab, persetujuan pelepasan aset.
 */
import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { AssetsService } from '../src/modules/assets/assets.module';

describe('Aset tetap — otomatisasi & kontrol (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let finance: string;
  let assetId: string;
  let categoryId: string;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const controls = async () => ((await get(owner, '/api/assets/controls').expect(200)).body as { items: { key: string; assetIds: string[] }[] }).items;
  const keys = async () => (await controls()).map((c) => c.key);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kontrol Aset', name: 'Pemilik', email: `ka-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await post(owner, '/api/users', { name: 'Keuangan', email: `ka-fin-${stamp}@uji.id`, password: 'keuangan123', role: 'FINANCE' }).expect(201);
    finance = (await http.post('/api/auth/login').send({ email: `ka-fin-${stamp}@uji.id`, password: 'keuangan123' }).expect(200)).body.accessToken;
    const cats = (await get(owner, '/api/assets/categories').expect(200)).body as { id: string; method: string; accumulatedAccountId: string | null }[];
    categoryId = cats.find((c) => c.method !== 'NONE' && c.accumulatedAccountId)!.id;
    assetId = (
      await post(owner, '/api/assets', {
        name: 'Mesin Uji',
        categoryId,
        acquisitionDate: '2025-01-15',
        cost: '4800000',
        usefulLifeMonths: 48,
        method: 'STRAIGHT_LINE',
        funding: 'EXISTING',
      }).expect(201)
    ).body.id;
  });
  afterAll(() => app.close());

  it('kontrol: penyusutan tertinggal, tanpa penanggung jawab, tanpa lokasi, belum diperiksa', async () => {
    const k = await keys();
    expect(k).toEqual(expect.arrayContaining(['DEP_BEHIND', 'NO_CUSTODIAN', 'NO_LOCATION', 'NOT_VERIFIED']));
  });

  it('penyusutan otomatis dimatikan: tidak ada yang diposting', async () => {
    await http.put('/api/assets/settings').set(as(finance)).send({ autoDepreciation: false }).expect(200);
    await app.get(AssetsService).autoDepreciateAll(new Logger('uji'));
    expect(await keys()).toContain('DEP_BEHIND');
  });

  it('penyusutan otomatis dinyalakan: bulan tertinggal diposting sekali, tidak ganda', async () => {
    await http.put('/api/assets/settings').set(as(finance)).send({ autoDepreciation: true }).expect(200);
    const svc = app.get(AssetsService);
    await svc.autoDepreciateAll(new Logger('uji'));
    expect(await keys()).not.toContain('DEP_BEHIND');
    const runs1 = (await get(owner, '/api/assets/depreciation/runs').expect(200)).body as unknown[];
    expect(runs1.length).toBeGreaterThan(0);
    await svc.autoDepreciateAll(new Logger('uji'));
    const runs2 = (await get(owner, '/api/assets/depreciation/runs').expect(200)).body as unknown[];
    expect(runs2.length).toBe(runs1.length);
  });

  it('penanggung jawab dan pemeriksaan fisik tercatat; hilang/rusak muncul sebagai temuan', async () => {
    await http.patch(`/api/assets/${assetId}`).set(as(finance)).send({ custodian: 'Budi (Produksi)' }).expect(200);
    await post(finance, `/api/assets/${assetId}/verify`, { status: 'MISSING', note: 'Tidak ada di gudang', location: 'Gudang B' }).expect(201);
    const a = (await get(owner, `/api/assets/${assetId}`).expect(200)).body;
    expect(a).toMatchObject({ custodian: 'Budi (Produksi)', verificationStatus: 'MISSING', location: 'Gudang B' });
    const k = await keys();
    expect(k).toContain('MISSING');
    expect(k).not.toContain('NO_CUSTODIAN');
    expect(k).not.toContain('NOT_VERIFIED');
    await post(owner, `/api/assets/${assetId}/verify`, { status: 'BOGUS' }).expect(400);
  });

  it('pelepasan aset: tanpa batas langsung jalan untuk keuangan; dengan batas menunggu persetujuan lalu dilepas', async () => {
    const second = (
      await post(owner, '/api/assets', { name: 'Mesin Dua', categoryId, acquisitionDate: '2025-01-15', cost: '6000000', usefulLifeMonths: 48, method: 'STRAIGHT_LINE', funding: 'EXISTING' }).expect(201)
    ).body.id;
    await http.put('/api/approvals/policy').set(as(owner)).send({ assetDisposal: 1000000 }).expect(200);
    const blocked = await post(finance, `/api/assets/${second}/dispose`, { date: '2026-10-05', price: '0' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('APPROVAL_REQUIRED');
    expect((await get(owner, `/api/assets/${second}`).expect(200)).body.status).toBe('ACTIVE');
    const pending = ((await get(owner, '/api/approvals?status=PENDING').expect(200)).body as { id: string; kind: string }[]).find((r) => r.kind === 'ASSET_DISPOSAL')!;
    expect(pending).toBeTruthy();
    await post(owner, `/api/approvals/${pending.id}/approve`, { note: 'Setuju' }).expect(201);
    expect((await get(owner, `/api/assets/${second}`).expect(200)).body.status).toBe('DISPOSED');
    // pemilik tidak terkena batas
    await post(owner, `/api/assets/${assetId}/dispose`, { date: '2026-10-06', price: '0' }).expect(201);
  });
});

describe('Aset tetap dari Kas Keluar (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let assetAccountId: string;
  let expenseAccountId: string;
  let categoryId: string;
  let cashAccountId: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const get = (u: string) => http.get(u).set(auth());
  const out = (lines: object[]) => http.post('/api/cash/transactions').set(auth()).send({ type: 'OUT', cashAccountId, date: '2026-10-05', description: 'Beli peralatan', lines });
  const assets = async () => ((await get('/api/assets').expect(200)).body as { name: string; cost: string; acquisitionJournalId: string | null; category: { id: string } }[]);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (await http.post('/api/auth/register').send({ companyName: 'PT Kas Aset', name: 'Pemilik', email: `kas-${Date.now()}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    const cats = (await get('/api/assets/categories').expect(200)).body as { id: string; assetAccountId: string; method: string }[];
    const cat = cats.find((c) => c.method !== 'NONE')!;
    categoryId = cat.id;
    assetAccountId = cat.assetAccountId;
    cashAccountId = ((await get('/api/cash/accounts').expect(200)).body as { id: string }[])[0].id;
    const counters = (await get('/api/cash/counter-accounts').expect(200)).body as { id: string; type: string }[];
    expenseAccountId = counters.find((a) => a.type === 'EXPENSE')!.id;
  });
  afterAll(() => app.close());

  it('kas keluar ke akun aset tetap otomatis membuat kartu aset (satu jurnal, daftar = buku besar)', async () => {
    const r0 = await out([{ accountId: assetAccountId, amount: '3500000', memo: 'Kompresor', assetLocation: 'Bengkel', assetUsefulLifeMonths: 60 }]);
    if (r0.status !== 201) throw new Error(JSON.stringify(r0.body));
    const list = await assets();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Kompresor', cost: '3500000.00' });
    expect(list[0].acquisitionJournalId).toBeTruthy();
    const rec = (await get('/api/assets/reconciliation?asOf=2026-10-31').expect(200)).body as { mismatched: number };
    expect(rec.mismatched).toBe(0);
  });

  it('kas keluar ke akun biasa tidak membuat aset; kas masuk ke akun aset ditolak', async () => {
    await out([{ accountId: expenseAccountId, amount: '100000', memo: 'ATK' }]).expect(201);
    expect(await assets()).toHaveLength(1);
    const r = await http.post('/api/cash/transactions').set(auth()).send({ type: 'IN', cashAccountId, date: '2026-10-06', description: 'Jual', lines: [{ accountId: assetAccountId, amount: '1000' }] });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/Jual \/ hapus aset/);
  });

  it('kategori yang tak cocok ditolak dan transaksi dibatalkan seluruhnya', async () => {
    const before = await assets();
    const bad = await out([{ accountId: assetAccountId, amount: '900000', assetCategoryId: '00000000-0000-4000-8000-000000000000' }]);
    expect(bad.status).toBe(400);
    expect(await assets()).toHaveLength(before.length);
    expect(categoryId).toBeTruthy();
  });
});
