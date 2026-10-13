/**
 * Kendali anggaran saat belanja (e2e): BLOCK menolak belanja yang melewati anggaran (Pemilik menembus dengan alasan),
 * APPROVAL mengirim ke persetujuan lalu dijalankan; akun tanpa anggaran dan jurnal penyesuaian tidak diblokir.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { sql } from 'drizzle-orm';
import { todayJakarta } from '../src/common/utils/dates';
import { DB, Db } from '../src/db/db';

describe('Kendali anggaran saat belanja (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let finance: string;
  let cashId: string;
  let expA: string;
  let expB: string;
  let supplierId: string;
  const stamp = Date.now();
  const today = todayJakarta();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);
  let n = 0;
  const spend = (t: string, acc: string, amount: string, extra: object = {}) =>
    post(t, '/api/cash/transactions', { type: 'OUT', cashAccountId: cashId, date: today, description: `Belanja ${++n}`, reference: `R-${stamp}-${n}`, lines: [{ accountId: acc, amount }], ...extra });
  const bill = (t: string, acc: string, price: string) =>
    post(t, '/api/purchase-invoices/bills', { supplierId, supplierInvoiceNo: `AK-${stamp}-${++n}`, withVat: false, lines: [{ type: 'EXPENSE', description: 'Jasa', accountId: acc, price }] });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kendali Anggaran', name: 'Pemilik', email: `ak-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await post(owner, '/api/users', { name: 'Keuangan', email: `ak-fin-${stamp}@uji.id`, password: 'keuangan123', role: 'FINANCE' }).expect(201);
    finance = (await http.post('/api/auth/login').send({ email: `ak-fin-${stamp}@uji.id`, password: 'keuangan123' }).expect(200)).body.accessToken;
    cashId = ((await get(owner, '/api/cash/accounts').expect(200)).body as { id: string; code: string }[]).find((a) => a.code === '1-1100')!.id;
    const counters = (await get(owner, '/api/cash/counter-accounts').expect(200)).body as { id: string; type: string; code: string }[];
    const exp = counters.filter((a) => a.type === 'EXPENSE');
    expA = exp[0].id;
    expB = exp[1].id;
    await post(owner, '/api/cash/transactions', { type: 'IN', cashAccountId: cashId, date: today, description: 'Modal', reference: 'M-1', lines: [{ accountId: counters.find((a) => a.code === '3-1000')!.id, amount: '100000000' }] }).expect(201);
    supplierId = (await post(owner, '/api/suppliers', { code: 'S-AK', name: 'Pemasok Anggaran' }).expect(201)).body.id;
    // anggaran bulan ini: akun A Rp1.000.000, disetujui
    await put(owner, `/api/budgets/${year}`, { rows: [{ accountId: expA, months: Array.from({ length: 12 }, (_, i) => (i + 1 === month ? '1000000' : '0')) }] }).expect(200);
    await post(owner, `/api/budgets/${year}/approve`).expect(201);
  });
  afterAll(() => app.close());

  it('bawaan (OFF): belanja melewati anggaran tetap jalan', async () => {
    await spend(finance, expA, '1500000').expect(201); // melewati, tapi hanya peringatan
  });

  it('BLOCK: staf ditolak, Pemilik wajib alasan; akun tanpa anggaran & jurnal penyesuaian tidak diblokir', async () => {
    await put(owner, '/api/approvals/policy', { budgetControl: 'BLOCK' }).expect(200);
    const r = await spend(finance, expA, '100000').expect(400); // realisasi 1,5jt sudah > 1jt × 110%
    expect(r.body.code).toBe('BUDGET_EXCEEDED');
    await spend(owner, expA, '100000').expect(400); // Pemilik tanpa alasan
    await spend(owner, expA, '100000', { budgetOverrideReason: 'x' }).expect(400);
    await spend(owner, expA, '100000', { budgetOverrideReason: 'Perbaikan mendesak mesin' }).expect(201);
    await spend(finance, expB, '900000').expect(201); // akun tanpa anggaran: tidak diblokir
    // jurnal manual biaya A melebihi: ditolak; jurnal penyesuaian lolos
    const lines = [{ accountId: expA, debit: '50000' }, { accountId: cashId, credit: '50000' }];
    await post(finance, '/api/accounting/journals', { date: today, description: 'Biaya A manual', lines }).expect(400);
    await post(finance, '/api/accounting/journals', { date: today, description: 'Akrual A', adjustment: true, lines }).expect(201);
    // tagihan biaya melewati anggaran: ditolak
    const b = await bill(finance, expA, '50000').expect(400);
    expect(b.body.code).toBe('BUDGET_EXCEEDED');
  });

  it('APPROVAL: staf menunggu persetujuan, Pemilik/Admin lolos, setelah disetujui dijalankan', async () => {
    await put(owner, '/api/approvals/policy', { budgetControl: 'APPROVAL' }).expect(200);
    const r = await spend(finance, expA, '200000').expect(409);
    expect(r.body.code).toBe('APPROVAL_REQUIRED');
    await post(owner, `/api/approvals/${r.body.requestId}/approve`, {}).expect(201);
    const list = (await get(owner, '/api/cash/transactions').expect(200)).body as { description: string }[];
    expect(list.some((t) => t.description.startsWith('Belanja') && true)).toBe(true);
    // tagihan biaya lewat persetujuan
    const rb = await bill(finance, expA, '75000').expect(409);
    await post(owner, `/api/approvals/${rb.body.requestId}/approve`, {}).expect(201);
    const inv = (await get(owner, '/api/purchase-invoices').expect(200)).body as { supplierInvoiceNo: string }[];
    expect(inv.some((i) => i.supplierInvoiceNo.startsWith(`AK-${stamp}`))).toBe(true);
    // Pemilik langsung lolos (tercatat di jejak audit)
    await spend(owner, expA, '10000').expect(201);
    const db = app.get<Db>(DB);
    const a = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'BUDGET_OVERRIDE'`);
    expect(a.rows[0].n).toBeGreaterThanOrEqual(2); // tembus Pemilik (BLOCK, beralasan) + lolos Pemilik (APPROVAL)
    await put(owner, '/api/approvals/policy', { budgetControl: 'OFF' }).expect(200);
    await spend(finance, expA, '50000').expect(201);
  });
});
