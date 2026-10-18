/** Uang keluar: Keuangan memilih jenis biaya, sistem menentukan akun beban; Keuangan tidak boleh mengeluarkan uang untuk prive/utang/modal */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Uang keluar otomatis (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string; let fin: string; let kasId: string; let equityId: string;
  const stamp = Date.now();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const out = (lines: object[], extra: object = {}, t = fin) => post('/api/cash/transactions', { type: 'OUT', cashAccountId: kasId, date: today, description: 'Bayar', lines, ...extra }, t);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Uang Keluar', name: 'P', email: `uk-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await post('/api/users', { name: 'fin', email: `uk-f-${stamp}@uji.id`, password: 'rahasia12345', role: 'FINANCE' }).expect(201);
    fin = (await http.post('/api/auth/login').send({ email: `uk-f-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
    kasId = ((await get('/api/cash/accounts').expect(200)).body as { id: string; code: string }[]).find((a) => a.code === '1-1100')!.id;
    equityId = ((await get('/api/cash/counter-accounts').expect(200)).body as { id: string; code: string }[]).find((a) => a.code === '3-1000')!.id;
    await post('/api/cash/transactions', { type: 'IN', cashAccountId: kasId, date: today, description: 'Modal awal', reference: 'M-1', lines: [{ source: 'OWNER_CAPITAL', amount: '5000000' }] }).expect(201);
  });
  afterAll(() => app.close());

  it('jenis biaya menentukan akun beban; sumber masuk tidak boleh dipakai untuk kas keluar', async () => {
    const r = await out([{ source: 'OUT_ELECTRICITY', amount: '250000' }]);
    expect(r.status).toBe(201);
    const list = (await get('/api/accounting/journals').expect(200)).body as { id: string; number: string }[];
    const detail = JSON.stringify((await get(`/api/accounting/journals/${list.find((x) => x.number === r.body.journalNumber)!.id}`).expect(200)).body);
    expect(detail).toContain('6-4000');
    expect((await out([{ source: 'OUT_RENT', amount: '1000000' }])).status).toBe(400); // sewa wajib bukti
    expect((await out([{ source: 'OUT_RENT', amount: '1000000' }], { reference: 'Kuitansi 9' })).status).toBe(201);
    expect((await out([{ source: 'INTEREST', amount: '1000' }])).status).toBe(400);
    expect((await out([{ source: 'OUT_FUEL', accountId: equityId, amount: '1000' }])).status).toBe(400); // keduanya
  });

  it('Keuangan tidak boleh mengeluarkan uang untuk modal/prive; Pemilik boleh', async () => {
    const r = await out([{ accountId: equityId, amount: '100000' }]);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('Pemilik/Admin');
    expect((await out([{ accountId: equityId, amount: '100000' }], {}, owner)).status).toBe(201);
  });
});
