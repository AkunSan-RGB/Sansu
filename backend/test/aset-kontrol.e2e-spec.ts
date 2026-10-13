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
