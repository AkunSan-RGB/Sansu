/**
 * Pembatalan pembayaran supplier (e2e): jurnal dibalik, hutang terbuka lagi, tidak bisa dibatalkan dua kali.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

describe('Batal pembayaran supplier (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let finance: string;
  let supplierId: string;
  let expenseId: string;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const day = todayJakarta();
  const apBalance = async () => {
    const tb = (await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body;
    expect(tb.balanced).toBe(true);
    return Number(tb.rows.find((x: { code: string }) => x.code === '2-1100')?.balance ?? 0);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Batal Bayar', name: 'Pemilik', email: `bb-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await post(owner, '/api/users', { name: 'Keuangan', email: `bb-fin-${stamp}@uji.id`, password: 'keuangan123', role: 'FINANCE' }).expect(201);
    finance = (await http.post('/api/auth/login').send({ email: `bb-fin-${stamp}@uji.id`, password: 'keuangan123' }).expect(200)).body.accessToken;
    supplierId = (await post(owner, '/api/suppliers', { code: 'SUP-BB', name: 'CV Batal' }).expect(201)).body.id;
    const counters = (await get(owner, '/api/cash/counter-accounts').expect(200)).body as { id: string; type: string }[];
    expenseId = counters.find((a) => a.type === 'EXPENSE')!.id;
  });
  afterAll(() => app.close());

  it('pembayaran yang salah dibatalkan: hutang kembali, jurnal dibalik, tidak bisa dua kali', async () => {
    const bill = (await post(owner, '/api/purchase-invoices/bills', { supplierId, supplierInvoiceNo: `BB-${stamp}`, withVat: false, lines: [{ type: 'EXPENSE', description: 'Jasa', accountId: expenseId, price: '1000000' }] }).expect(201)).body;
    const before = await apBalance();
    const pay = (await post(finance, '/api/purchase-invoices/payments', { purchaseInvoiceId: bill.id, amount: '400000', date: day }).expect(201)).body;
    expect(await apBalance()).toBe(before - 400000);

    // keuangan tidak boleh membatalkan; alasan wajib
    await post(finance, `/api/purchase-invoices/payments/${pay.id}/void`, { reason: 'salah input' }).expect(403);
    await post(owner, `/api/purchase-invoices/payments/${pay.id}/void`, { reason: 'x' }).expect(400);
    await post(owner, `/api/purchase-invoices/payments/${pay.id}/void`, { reason: 'salah nominal' }).expect(201);

    expect(await apBalance()).toBe(before);
    const inv = (await get(owner, `/api/purchase-invoices/${bill.id}`).expect(200)).body;
    expect(Number(inv.paidAmount)).toBe(0);
    expect(inv.status).toBe('UNPAID');
    await post(owner, `/api/purchase-invoices/payments/${pay.id}/void`, { reason: 'salah nominal' }).expect(400);

    // pembayaran ulang dengan nominal benar tetap bisa, dan total tidak melebihi sisa
    await post(finance, '/api/purchase-invoices/payments', { purchaseInvoiceId: bill.id, amount: '1000000', date: day }).expect(201);
    const paid = (await get(owner, `/api/purchase-invoices/${bill.id}`).expect(200)).body;
    expect(paid.status).toBe('PAID');
    const list = (await get(owner, '/api/purchase-invoices/payments').expect(200)).body as { id: string; status: string }[];
    expect(list.find((p) => p.id === pay.id)?.status).toBe('VOID');
  });
});
