/**
 * Kontrol pembayaran penjualan (e2e): pembayaran transfer yang tidak ada di mutasi bank, pemisahan fungsi pembuat faktur ≠ pencatat pembayaran/retur,
 * dan blokir order bagi pelanggan berfaktur jatuh tempo (sudah ada).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Kontrol pembayaran penjualan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string; let fin: string; let fin2: string; let wh: string; let sls: string;
  let whId: string; let prod: string; let cust: string; let bankId: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);
  const login = async (role: string, n: string) => {
    await post(owner, '/api/users', { name: n, email: `ksl4-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    return (await http.post('/api/auth/login').send({ email: `ksl4-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
  };
  /** Faktur atas nama `maker` (pesanan → surat jalan → faktur) */
  const invoice = async (maker: string, qty = '4', when = day) => {
    const so = (await post(sls, '/api/sales-orders', { customerId: cust, warehouseId: whId, date: when, lines: [{ productId: prod, qty, price: '10000' }] }).expect(201)).body;
    await post(sls, `/api/sales-orders/${so.id}/confirm`).expect(201);
    await post(wh, `/api/sales-orders/${so.id}/deliver`, { date: when }).expect(201);
    return (await post(maker, '/api/invoices', { salesOrderId: so.id, date: when }).expect(201)).body as { id: string };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kontrol Jual 4', name: 'P', email: `ksl4-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    fin = await login('FINANCE', 'fin');
    fin2 = await login('FINANCE', 'fin2');
    wh = await login('WAREHOUSE', 'wh');
    sls = await login('SALES', 'sls');
    whId = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    prod = (await post(owner, '/api/products', { sku: 'KSL4-1', name: 'Barang', baseUom: 'PCS', sellPrice: '10000' }).expect(201)).body.id;
    cust = (await post(owner, '/api/customers', { code: 'C-KSL4', name: 'Pelanggan Empat' }).expect(201)).body.id;
    bankId = ((await get(owner, '/api/cash/accounts').expect(200)).body as { id: string; code: string }[]).find((a) => a.code === '1-1200')!.id;
    await post(owner, '/api/inventory/adjustments', { warehouseId: whId, reason: 'OPENING', date: day, lines: [{ productId: prod, qty: '900', unitCost: '5000' }] }).expect(201);
  });
  afterAll(() => app.close());

  it('pembayaran transfer tanpa baris mutasi bank yang cocok (padahal mutasi periodenya diimpor) menjadi temuan', async () => {
    const inv = await invoice(fin, '3', addDays(day, -8));
    await post(fin, '/api/payments', { invoiceId: inv.id, amount: '30000', method: 'TRANSFER', cashAccountId: bankId, date: addDays(day, -6) }).expect(201);
    // belum ada mutasi diimpor → belum bisa dinilai
    let items = (await get(owner, '/api/sales-controls').expect(200)).body.items as { key: string }[];
    expect(items.some((f) => f.key === 'PAYMENT_NOT_IN_BANK')).toBe(false);
    // mutasi periode itu diimpor, tetapi isinya tidak memuat pembayaran ini
    await post(owner, '/api/bank/statements', { cashAccountId: bankId, fileName: 'x.csv', lines: [{ date: addDays(day, -6), description: 'SETORAN LAIN', amount: '12345' }, { date: addDays(day, -5), description: 'BIAYA', amount: '-100' }] }).expect(201);
    items = (await get(owner, '/api/sales-controls').expect(200)).body.items as { key: string }[];
    expect(items.some((f) => f.key === 'PAYMENT_NOT_IN_BANK')).toBe(true);
  });

  it('pembuat faktur mencatat pembayarannya sendiri: temuan; bila pemisahan fungsi dinyalakan menunggu persetujuan, orang lain boleh', async () => {
    const inv = await invoice(fin);
    await post(fin, '/api/payments', { invoiceId: inv.id, amount: '1000', method: 'CASH', date: day }).expect(201);
    const items = (await get(owner, '/api/sales-controls').expect(200)).body.items as { key: string; refs: string[] }[];
    expect(items.find((f) => f.key === 'PAYMENT_BY_INVOICE_CREATOR')?.refs.join()).toContain('fin:');

    await put(owner, '/api/approvals/policy', { salesSeparateDuties: true }).expect(200);
    const inv2 = await invoice(fin);
    const r = await post(fin, '/api/payments', { invoiceId: inv2.id, amount: '1000', method: 'CASH', date: day });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('APPROVAL_REQUIRED');
    // orang lain (Keuangan kedua) langsung boleh
    await post(fin2, '/api/payments', { invoiceId: inv2.id, amount: '1000', method: 'CASH', date: day }).expect(201);
    // setelah disetujui Pemilik, pembayaran tercatat atas nama pemohon
    const inv3 = await invoice(fin);
    const r3 = await post(fin, '/api/payments', { invoiceId: inv3.id, amount: '2000', method: 'CASH', date: day });
    expect(r3.status).toBe(409);
    await post(owner, `/api/approvals/${r3.body.requestId}/approve`, {}).expect(201);
    expect(Number((await get(owner, `/api/invoices/${inv3.id}`).expect(200)).body.paidAmount)).toBe(2000);
    // retur atas faktur sendiri juga ditahan
    const full = (await get(owner, `/api/invoices/${inv2.id}`).expect(200)).body as { lines: { id: string }[] };
    const ret = await post(fin, '/api/sales-returns', { invoiceId: inv2.id, date: day, reason: 'Rusak', lines: [{ invoiceLineId: full.lines[0].id, qty: '1' }] });
    expect(ret.status).toBe(409);
    expect(ret.body.code).toBe('APPROVAL_REQUIRED');
    await put(owner, '/api/approvals/policy', { salesSeparateDuties: false }).expect(200);
  });

  it('pelanggan dengan faktur lewat jatuh tempo tidak bisa mengonfirmasi pesanan baru (kontrol kredit yang sudah ada)', async () => {
    const old = await invoice(fin, '1', addDays(day, -90)); // termin 30 hari → lewat jatuh tempo
    expect(old.id).toBeTruthy();
    const so = (await post(sls, '/api/sales-orders', { customerId: cust, warehouseId: whId, date: day, lines: [{ productId: prod, qty: '1', price: '10000' }] }).expect(201)).body;
    const r = await post(sls, `/api/sales-orders/${so.id}/confirm`);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('jatuh tempo');
  });
});
