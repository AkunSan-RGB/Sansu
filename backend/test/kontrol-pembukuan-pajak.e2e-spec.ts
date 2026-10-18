/**
 * Kontrol pembukuan & pajak (e2e): halaman gabungan — jurnal mundur, pemeriksaan kesehatan bermasalah, akses peran.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Kontrol pembukuan & pajak (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string; let wh: string;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kontrol Buku', name: 'P', email: `kbp-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    await post(owner, '/api/users', { name: 'wh', email: `kbp-wh-${stamp}@uji.id`, password: 'rahasia12345', role: 'WAREHOUSE' }).expect(201);
    wh = (await http.post('/api/auth/login').send({ email: `kbp-wh-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
  });
  afterAll(async () => { await app.close(); });

  it('jurnal bertanggal > sebulan lalu yang baru dibuat muncul; peran Gudang ditolak', async () => {
    const accs = (await get(owner, '/api/accounting/accounts').expect(200)).body as { id: string; code: string }[];
    const cash = accs.find((a) => a.code === '1-1100')!.id;
    const equity = accs.find((a) => a.code === '3-1000')!.id;
    await post(owner, '/api/accounting/journals', { date: addDays(todayJakarta(), -100), description: 'Modal mundur uji', controlOverrideReason: 'Uji kontrol pembukuan', lines: [{ accountId: cash, debit: '1000000' }, { accountId: equity, credit: '1000000' }] }).expect(201);
    const r = (await get(owner, '/api/accounting-controls').expect(200)).body as { items: { key: string; refs: string[] }[] };
    const f = r.items.find((i) => i.key === 'JE_BACKDATED');
    expect(f?.refs.length).toBe(1);
    expect(r.items.every((i) => i.refs.length > 0)).toBe(true);
    await get(wh, '/api/accounting-controls').expect(403);
  });
});
