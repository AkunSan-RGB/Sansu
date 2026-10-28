/**
 * Jasa: anggaran biaya proyek ikut mode kendali anggaran (OFF / BLOCK / APPROVAL) pada tagihan biaya dan kas keluar bertanda proyek.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

describe('Jasa: kendali anggaran biaya proyek (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner = ''; let fin = '';
  let cashId = ''; let expense = ''; let supplier = ''; let project = '';
  const stamp = Date.now();
  const today = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);
  let n = 0;
  const bill = (t: string, price: string, extra: object = {}) =>
    post(t, '/api/purchase-invoices/bills', { supplierId: supplier, supplierInvoiceNo: `PB-${stamp}-${++n}`, withVat: false, projectId: project, lines: [{ type: 'EXPENSE', description: 'Biaya proyek', accountId: expense, price }], ...extra });
  const spend = (t: string, amount: string, extra: object = {}) =>
    post(t, '/api/cash/transactions', { type: 'OUT', cashAccountId: cashId, date: today, description: `Biaya ${++n}`, reference: `PR-${stamp}-${n}`, lines: [{ accountId: expense, amount, projectId: project }], ...extra });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'Konsultan Anggaran Proyek', name: 'Pemilik', email: `jap-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'JASA' }).expect(201)).body.accessToken;
    await post(owner, '/api/users', { name: 'Keuangan', email: `jap-f-${stamp}@uji.id`, password: 'keuangan123', role: 'FINANCE' }).expect(201);
    fin = (await http.post('/api/auth/login').send({ email: `jap-f-${stamp}@uji.id`, password: 'keuangan123' }).expect(200)).body.accessToken;
    cashId = ((await get(owner, '/api/cash/accounts').expect(200)).body as { id: string; code: string }[]).find((a) => a.code === '1-1100')!.id;
    const counters = (await get(owner, '/api/cash/counter-accounts').expect(200)).body as { id: string; type: string; code: string }[];
    expense = counters.find((a) => a.type === 'EXPENSE')!.id;
    await post(owner, '/api/cash/transactions', { type: 'IN', cashAccountId: cashId, date: today, description: 'Modal', reference: 'M-1', lines: [{ accountId: counters.find((a) => a.code === '3-1000')!.id, amount: '100000000' }] }).expect(201);
    supplier = (await post(owner, '/api/suppliers', { code: 'S-PB', name: 'Pemasok Proyek' }).expect(201)).body.id;
    const cust = (await post(owner, '/api/customers', { code: 'C-PB', name: 'Klien' }).expect(201)).body.id;
    project = (await post(owner, '/api/services/projects', { name: 'Proyek terbatas', customerId: cust, contractValue: '50000000', costBudget: '1000000' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('mode OFF: biaya melewati anggaran tetap tercatat (hanya terlihat sebagai OVER)', async () => {
    await bill(fin, '900000').then((r) => expect(r.status).toBe(201));
    const p = (await get(owner, `/api/services/projects/${project}`).expect(200)).body;
    expect(p.budget.status).toBe('WARN');
  });

  it('mode BLOCK: tagihan dan kas keluar yang melewati anggaran ditolak; Pemilik menembus dengan alasan; biaya dalam anggaran lolos', async () => {
    await put(owner, '/api/approvals/policy', { budgetControl: 'BLOCK' }).expect(200);
    const r1 = await bill(fin, '500000');
    expect(r1.status).toBe(400);
    expect(JSON.stringify(r1.body)).toMatch(/anggaran proyek/);
    expect((await spend(fin, '500000')).status).toBe(400);
    expect((await bill(fin, '50000')).status).toBe(201); // 900.000 + 50.000 ≤ 1.000.000
    expect((await bill(owner, '500000', { budgetOverrideReason: 'Disetujui klien untuk tambahan pekerjaan' })).status).toBe(201);
    expect((await get(owner, `/api/services/projects/${project}`).expect(200)).body.budget.status).toBe('OVER');
  });

  it('mode APPROVAL: staf Keuangan menunggu persetujuan; proyek tanpa anggaran tidak terkena', async () => {
    await put(owner, '/api/approvals/policy', { budgetControl: 'APPROVAL' }).expect(200);
    const r = await spend(fin, '100000');
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toMatch(/persetujuan|anggaran proyek/);
    const cust = (await get(owner, '/api/customers').expect(200)).body[0].id;
    const free = (await post(owner, '/api/services/projects', { name: 'Tanpa anggaran', customerId: cust, contractValue: '1000' }).expect(201)).body.id;
    expect((await bill(fin, '10000000', { projectId: free })).status).toBe(201);
    await put(owner, '/api/approvals/policy', { budgetControl: 'OFF' }).expect(200);
  });
});
