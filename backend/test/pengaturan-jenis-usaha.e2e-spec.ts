/**
 * Pengaturan per jenis usaha (e2e): tiap jenis usaha mendapat daftar pengaturan yang relevan baginya, statusnya dihitung dari data
 * perusahaan itu sendiri, dan tidak bocor ke perusahaan lain.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { BUSINESS_MODELS, MODEL_SETUP, type BusinessModel } from '@sansu/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Pengaturan per jenis usaha (e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const tokens = {} as Record<BusinessModel, string>;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const setup = async (m: BusinessModel) => (await http.get('/api/onboarding/setup').set(as(tokens[m])).expect(200)).body as { model: string; items: { key: string; done: boolean; link: string; group: string }[]; done: number; total: number };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    for (const m of BUSINESS_MODELS) {
      tokens[m.key] = (await http.post('/api/auth/register').send({ companyName: `PT Setup ${m.key}`, name: 'Pemilik', email: `setup-${m.key}-${stamp}@uji.id`, password: 'rahasia123', businessModel: m.key }).expect(201)).body.accessToken;
    }
  });
  afterAll(() => app.close());

  it.each(BUSINESS_MODELS.map((m) => m.key))('%s: daftar pengaturan sesuai definisi jenis usaha itu dan semua pemeriksaan data berjalan', async (m) => {
    const r = await setup(m);
    expect(r.model).toBe(m);
    expect(r.items.map((i) => i.key)).toEqual(MODEL_SETUP[m].map((i) => i.key));
    expect(r.total).toBe(MODEL_SETUP[m].length);
    expect(r.items.some((i) => i.group === 'BEFORE_START')).toBe(true);
    for (const i of r.items) expect(i.link).toMatch(/^\//);
  });

  it('daftar tiap jenis usaha berbeda (bukan satu daftar umum)', () => {
    const sets = BUSINESS_MODELS.map((m) => MODEL_SETUP[m.key].map((i) => i.key).sort().join(','));
    expect(new Set(sets).size).toBe(BUSINESS_MODELS.length);
  });

  it('status berubah setelah pengaturan dilakukan: batas kredit (Dagang) dan tarif (Utilitas)', async () => {
    expect((await setup('DAGANG')).items.find((i) => i.key === 'creditLimit')!.done).toBe(false);
    await http.post('/api/customers').set(as(tokens.DAGANG)).send({ code: 'C-1', name: 'Toko Maju', creditLimit: '5000000' }).expect(201);
    const after = await setup('DAGANG');
    expect(after.items.find((i) => i.key === 'creditLimit')!.done).toBe(true);
    expect(after.done).toBeGreaterThanOrEqual(1);

    expect((await setup('UTILITAS')).items.find((i) => i.key === 'tariffs')!.done).toBe(false);
    await http.post('/api/utility/tariffs').set(as(tokens.UTILITAS)).send({ name: 'Air RT', serviceType: 'AIR', fixedFee: 10000, adminFee: 2500, blocks: [{ upTo: 10, price: 3000 }, { upTo: null, price: 4500 }] }).expect(201);
    expect((await setup('UTILITAS')).items.find((i) => i.key === 'tariffs')!.done).toBe(true);
  });

  it('status satu perusahaan tidak terbawa ke perusahaan lain', async () => {
    // Ritel tidak punya tarif/pelanggan berbatas kredit dari perusahaan lain
    const ritel = await setup('RITEL');
    expect(ritel.items.every((i) => !i.done)).toBe(true);
  });

  it('hanya Pemilik/Admin yang boleh melihat daftar pengaturan', async () => {
    await http.post('/api/users').set(as(tokens.DAGANG)).send({ name: 'Kasir', email: `kasir-${stamp}@uji.id`, password: 'rahasia12345', role: 'CASHIER' }).expect(201);
    const t = (await http.post('/api/auth/login').send({ email: `kasir-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
    await http.get('/api/onboarding/setup').set(as(t)).expect(403);
  });
});
