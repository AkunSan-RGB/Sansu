/**
 * Tugas saya untuk Kas & Bank: opname selisih besar menunggu Pemilik, mutasi bank belum dicocokkan, bukti kas kecil lama belum diganti.
 * Tugas hanya tampil untuk peran yang memang bisa memutuskan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Tugas saya: Kas & Bank (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  let owner: string; let fin: string; let acct: string;
  let accounts: { id: string; code: string }[];
  const acc = (code: string) => accounts.find((a) => a.code === code)!.id;
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const keys = async (t: string) => ((await http.get('/api/tasks/mine').set(as(t)).expect(200)).body as { key: string; count: number }[]).map((x) => x.key);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Tugas Kas', name: 'P', email: `tk-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    const mk = async (role: string, n: string) => {
      await post('/api/users', { name: n, email: `tk-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      return (await http.post('/api/auth/login').send({ email: `tk-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    };
    fin = await mk('FINANCE', 'fin');
    acct = await mk('ACCOUNTANT', 'akuntan');
    accounts = (await http.get('/api/accounting/accounts').set(as(owner))).body;
    await post('/api/cash/transactions', { type: 'IN', cashAccountId: acc('1-1110'), date: today, description: 'Isi kas', lines: [{ accountId: acc('3-1000'), amount: '1000000' }] }).expect(201);
  });
  afterAll(() => app.close());

  it('belum ada pekerjaan: tidak ada tugas kas', async () => {
    for (const t of [owner, fin]) expect(await keys(t)).not.toEqual(expect.arrayContaining(['cash-count-approval', 'bank-unmatched']));
  });

  it('opname selisih besar: tugas hanya untuk Pemilik, bukan pengaju', async () => {
    const c = (await post('/api/cash/counts', { accountId: acc('1-1110'), date: today }, fin).expect(201)).body;
    await http.put(`/api/cash/counts/${c.id}`).set(as(fin)).send({ denominations: { K100000: 8 }, reason: 'Uang tidak ketemu' }).expect(200);
    expect((await post(`/api/cash/counts/${c.id}/finish`, {}, fin).expect(200)).body.status).toBe('WAITING_APPROVAL');
    expect(await keys(owner)).toContain('cash-count-approval');
    expect(await keys(fin)).not.toContain('cash-count-approval');
    expect(await keys(acct)).not.toContain('cash-count-approval');
    await post(`/api/cash/counts/${c.id}/approve`, {}, owner).expect(200);
    expect(await keys(owner)).not.toContain('cash-count-approval');
  });

  it('mutasi bank belum dicocokkan: tugas untuk Keuangan, hilang setelah diproses', async () => {
    const st = (await post('/api/bank/statements', { cashAccountId: acc('1-1200'), lines: [{ date: today, description: 'SETOR TUNAI', amount: '250000' }] }, fin).expect(201)).body;
    expect(await keys(fin)).toContain('bank-unmatched');
    expect(await keys(owner)).toContain('bank-unmatched');
    expect(await keys(acct)).not.toContain('bank-unmatched'); // Akuntan hanya melihat/menandatangani, tidak mencocokkan
    const lines = (await http.get(`/api/bank/statements/${st.id}`).set(as(fin)).expect(200)).body.lines as { id: string }[];
    await post(`/api/bank/lines/${lines[0].id}/ignore`, { reason: 'Setoran dicatat nanti oleh pemilik' }, fin).expect(201);
    expect(await keys(fin)).not.toContain('bank-unmatched');
  });
});
