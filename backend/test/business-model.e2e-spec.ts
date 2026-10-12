/** Model bisnis (e2e): aplikasi bawaan saat mendaftar, langkah panduan, dan ganti model. */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Model bisnis (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const reg = async (model?: string) =>
    (
      await http
        .post('/api/auth/register')
        .send({
          companyName: `PT ${model ?? 'Default'}`,
          name: 'Pemilik',
          email: `bm-${model ?? 'def'}-${stamp}@uji.id`,
          password: 'rahasia123',
          businessModel: model,
        })
        .expect(201)
    ).body.accessToken as string;
  const me = async (t: string) =>
    (
      await http
        .get('/api/auth/me')
        .set({ Authorization: `Bearer ${t}` })
        .expect(200)
    ).body;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  it('tanpa pilihan = Dagang (perilaku lama)', async () => {
    const m = await me(await reg());
    expect(m.businessModel).toBe('DAGANG');
    expect(m.apps).toEqual(expect.arrayContaining(['sales', 'purchase', 'inventory', 'accounting', 'cash']));
    expect(m.apps).not.toContain('pos');
  });

  it('Ritel: kasir menyala, langkah panduan mengarah ke kasir, gudang bernama toko', async () => {
    const t = await reg('RITEL');
    const m = await me(t);
    expect(m.businessModel).toBe('RITEL');
    expect(m.apps).toEqual(expect.arrayContaining(['pos', 'inventory', 'purchase', 'accounting', 'cash']));
    const o = (
      await http
        .get('/api/onboarding')
        .set({ Authorization: `Bearer ${t}` })
        .expect(200)
    ).body;
    expect(o.model).toBe('RITEL');
    expect(o.steps.find((s: { key: string }) => s.key === 'sale')).toMatchObject({
      link: '/pos',
      title: 'Buka kasir & jual pertama',
    });
    const wh = (
      await http
        .get('/api/warehouses')
        .set({ Authorization: `Bearer ${t}` })
        .expect(200)
    ).body;
    expect(wh[0].name).toBe('Toko Utama');
  });

  it('Jasa: CRM & penjualan menyala; ganti model + nyalakan aplikasi yang disarankan', async () => {
    const t = await reg('JASA');
    const auth = { Authorization: `Bearer ${t}` };
    expect((await me(t)).apps).toEqual(expect.arrayContaining(['crm', 'sales']));
    await http
      .post('/api/auth/register')
      .send({
        companyName: 'X',
        name: 'Y',
        email: `bm-bad-${stamp}@uji.id`,
        password: 'rahasia123',
        businessModel: 'TAMBANG',
      })
      .expect(400);
    const r = (await http.put('/api/settings/business').set(auth).send({ model: 'RITEL', applyApps: true }).expect(200))
      .body;
    expect(r.model).toBe('RITEL');
    expect(r.installed).toContain('pos');
    const m = await me(t);
    expect(m.businessModel).toBe('RITEL');
    expect(m.apps).toEqual(expect.arrayContaining(['pos', 'crm']));
  });
});
