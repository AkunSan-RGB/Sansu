/**
 * Profil layanan Jasa: perusahaan baru mulai sederhana, perusahaan lama (belum memilih) melihat semua, hanya Jasa + Admin yang dapat mengubah.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Jasa: profil layanan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let jasa = ''; let ritel = ''; let sales = '';
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const reg = async (model: string, tag: string) => (await http.post('/api/auth/register').send({ companyName: `PT ${tag}`, name: 'Pemilik', email: `pl-${tag}-${stamp}@uji.id`, password: 'rahasia123', businessModel: model }).expect(201)).body.accessToken as string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    jasa = await reg('JASA', 'jasa');
    ritel = await reg('RITEL', 'ritel');
    await http.post('/api/users').set(as(jasa)).send({ name: 'Sales', email: `pl-s-${stamp}@uji.id`, password: 'rahasia12345', role: 'SALES' }).expect(201);
    sales = (await http.post('/api/auth/login').send({ email: `pl-s-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
  });
  afterAll(() => app.close());

  it('perusahaan Jasa baru mulai dengan profil konsultan; /auth/me ikut membawa profil', async () => {
    expect((await http.get('/api/settings/business/service-profiles').set(as(jasa)).expect(200)).body.profiles).toEqual(['KONSULTAN']);
    expect((await http.get('/api/auth/me').set(as(jasa)).expect(200)).body.serviceProfiles).toEqual(['KONSULTAN']);
  });

  it('Admin memilih lebih dari satu profil; masukan salah ditolak', async () => {
    const put = (t: string, profiles: unknown) => http.put('/api/settings/business/service-profiles').set(as(t)).send({ profiles });
    expect((await put(jasa, [])).status).toBe(400);
    expect((await put(jasa, ['TAMBANG'])).status).toBe(400);
    expect((await put(sales, ['BENGKEL'])).status).toBe(403);
    const r = (await put(jasa, ['KONSULTAN', 'ALIH_DAYA', 'ALIH_DAYA']).expect(200)).body;
    expect(r.profiles).toEqual(['KONSULTAN', 'ALIH_DAYA']);
    expect((await http.get('/api/auth/me').set(as(jasa)).expect(200)).body.serviceProfiles).toEqual(['KONSULTAN', 'ALIH_DAYA']);
  });

  it('profil hanya mengatur tampilan: fitur profil lain tetap dapat dipakai lewat API (data lama tidak terkunci)', async () => {
    expect((await http.get('/api/services/education/classes').set(as(jasa))).status).toBe(200);
  });

  it('bukan Jasa ditolak', async () => {
    expect((await http.put('/api/settings/business/service-profiles').set(as(ritel)).send({ profiles: ['BENGKEL'] })).status).toBe(400);
  });
});
