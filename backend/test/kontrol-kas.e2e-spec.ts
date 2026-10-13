/**
 * SOP kas & bank (e2e): persetujuan uang keluar, bukti wajib, blokir saldo negatif, pembatalan terkontrol, temuan kontrol.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

describe('Kontrol kas & bank (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let finance: string;
  let cashId: string;
  let expenseId: string;
  let equityId: string;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);
  const day = todayJakarta();
  const out = (t: string, amount: string, extra: object = {}) =>
    post(t, '/api/cash/transactions', { type: 'OUT', cashAccountId: cashId, date: day, description: `Bayar ${amount}`, lines: [{ accountId: expenseId, amount }], ...extra });
  const balance = async () => Number(((await get(owner, '/api/cash/accounts').expect(200)).body as { id: string; balance: string }[]).find((a) => a.id === cashId)!.balance);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kontrol Kas', name: 'Pemilik', email: `kk-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await post(owner, '/api/users', { name: 'Keuangan', email: `kk-fin-${stamp}@uji.id`, password: 'keuangan123', role: 'FINANCE' }).expect(201);
    finance = (await http.post('/api/auth/login').send({ email: `kk-fin-${stamp}@uji.id`, password: 'keuangan123' }).expect(200)).body.accessToken;
    cashId = ((await get(owner, '/api/cash/accounts').expect(200)).body as { id: string }[])[0].id;
    const counters = (await get(owner, '/api/cash/counter-accounts').expect(200)).body as { id: string; code: string; type: string }[];
    expenseId = counters.find((a) => a.type === 'EXPENSE')!.id;
    equityId = counters.find((a) => a.code === '3-1000')!.id;
    await post(owner, '/api/cash/transactions', { type: 'IN', cashAccountId: cashId, date: day, description: 'Modal awal', reference: 'M-1', lines: [{ accountId: equityId, amount: '10000000' }] }).expect(201);
  });
  afterAll(() => app.close());

  it('bawaan: tidak ada batas, semua berjalan; temuan "tanpa bukti" muncul untuk uang keluar tanpa referensi', async () => {
    await out(finance, '300000').expect(201);
    const items = ((await get(owner, '/api/cash/controls').expect(200)).body as { items: { key: string }[] }).items.map((i) => i.key);
    expect(items).toContain('NO_EVIDENCE');
  });

  it('bukti wajib: uang keluar di atas batas tanpa nomor bukti ditolak, dengan bukti diterima', async () => {
    await put(finance, '/api/cash/settings', { evidenceFrom: 500000 }).expect(403);
    await put(owner, '/api/cash/settings', { evidenceFrom: 500000 }).expect(200);
    await out(finance, '600000').expect(400);
    await out(finance, '600000', { reference: 'NOTA-77' }).expect(201);
    await out(finance, '100000').expect(201); // di bawah batas bukti
  });

  it('persetujuan: di atas batas menunggu pemilik; pemilik tidak terkena batas; setelah disetujui transaksi diposting', async () => {
    await http.put('/api/approvals/policy').set(as(owner)).send({ cashOut: 1000000 }).expect(200);
    const before = await balance();
    const blocked = await out(finance, '2000000', { reference: 'INV-1' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('APPROVAL_REQUIRED');
    expect(await balance()).toBe(before);
    await out(owner, '1500000', { reference: 'INV-2' }).expect(201);
    const pending = ((await get(owner, '/api/approvals?status=PENDING').expect(200)).body as { id: string; kind: string }[]).find((r) => r.kind === 'CASH_TX')!;
    expect(pending).toBeTruthy();
    await post(owner, `/api/approvals/${pending.id}/approve`, { note: 'OK' }).expect(201);
    expect(await balance()).toBe(before - 1500000 - 2000000);
  });

  it('blokir saldo negatif bila diaktifkan', async () => {
    await put(owner, '/api/cash/settings', { blockNegative: true }).expect(200);
    const r = await out(owner, '999999999', { reference: 'X' });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/tidak cukup/);
    await put(owner, '/api/cash/settings', { blockNegative: false }).expect(200);
  });

  it('pembatalan terkontrol: hanya pemilik/admin, alasan wajib, dibalik dengan jurnal pembalik, tidak ganda', async () => {
    const tx = (await out(owner, '250000', { reference: 'BTL-1' }).expect(201)).body as { id: string };
    const bal = await balance();
    await post(finance, `/api/cash/transactions/${tx.id}/void`, { reason: 'Salah input nominal' }).expect(403);
    await post(owner, `/api/cash/transactions/${tx.id}/void`, { reason: 'x' }).expect(400);
    const done = (await post(owner, `/api/cash/transactions/${tx.id}/void`, { reason: 'Salah input nominal' }).expect(201)).body;
    expect(done.status).toBe('VOID');
    expect(await balance()).toBe(bal + 250000);
    await post(owner, `/api/cash/transactions/${tx.id}/void`, { reason: 'Coba lagi' }).expect(400);
    const list = (await get(owner, '/api/cash/transactions').expect(200)).body as { id: string; status: string; voidReason: string }[];
    expect(list.find((t) => t.id === tx.id)).toMatchObject({ status: 'VOID', voidReason: 'Salah input nominal' });
    const items = ((await get(owner, '/api/cash/controls').expect(200)).body as { items: { key: string }[] }).items.map((i) => i.key);
    expect(items).toContain('VOIDED');
  });
});
