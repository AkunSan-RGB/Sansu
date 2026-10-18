/**
 * Kontrol penjualan lanjutan (e2e): persetujuan pesanan besar / diskon besar, syarat pelanggan (limit/termin) dan pelanggan ganda,
 * persetujuan retur penjualan, temuan pembayaran terlambat dicatat.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Kontrol penjualan lanjutan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string; let fin: string; let wh: string; let sls: string;
  let whId: string; let prod: string; let cust: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const patch = (t: string, u: string, b: object = {}) => http.patch(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);
  const login = async (role: string, n: string) => {
    await post(owner, '/api/users', { name: n, email: `ksl2-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    return (await http.post('/api/auth/login').send({ email: `ksl2-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
  };
  const draft = async (qty = '5', discountPct?: string) =>
    (await post(sls, '/api/sales-orders', { customerId: cust, warehouseId: whId, date: day, lines: [{ productId: prod, qty, ...(discountPct ? { discountPct } : {}) }] }).expect(201)).body as { id: string; number: string; lines: { id: string }[] };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kontrol Jual 2', name: 'P', email: `ksl2-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    fin = await login('FINANCE', 'fin');
    wh = await login('WAREHOUSE', 'wh');
    sls = await login('SALES', 'sls');
    whId = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    prod = (await post(owner, '/api/products', { sku: 'KSL2-1', name: 'Barang Jual', baseUom: 'PCS', sellPrice: '10000' }).expect(201)).body.id;
    cust = (await post(owner, '/api/customers', { code: 'C-KSL2', name: 'Toko Maju Jaya', npwp: '0123456789012345', creditLimit: '5000000', paymentTermDays: 14 }).expect(201)).body.id;
    await post(owner, '/api/inventory/adjustments', { warehouseId: whId, reason: 'OPENING', date: day, lines: [{ productId: prod, qty: '500', unitCost: '5000' }] }).expect(201);
  });
  afterAll(() => app.close());

  it('diskon di atas batas: konfirmasi oleh Sales menunggu persetujuan; setelah disetujui pesanan terkonfirmasi', async () => {
    await put(owner, '/api/approvals/policy', { salesDiscountMaxPct: 10 }).expect(200);
    const ok = await draft('2', '5');
    await post(sls, `/api/sales-orders/${ok.id}/confirm`).expect(201); // dalam batas
    const big = await draft('2', '20');
    const r = await post(sls, `/api/sales-orders/${big.id}/confirm`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('APPROVAL_REQUIRED');
    await post(owner, `/api/approvals/${r.body.requestId}/approve`, {}).expect(201);
    expect((await get(owner, `/api/sales-orders/${big.id}`).expect(200)).body.status).toBe('CONFIRMED');
    await put(owner, '/api/approvals/policy', { salesDiscountMaxPct: 0 }).expect(200);
  });

  it('nilai pesanan di atas batas butuh persetujuan; pemilik tidak dibatasi tetapi masuk temuan tinjauan', async () => {
    await put(owner, '/api/approvals/policy', { salesOrder: 100000 }).expect(200);
    const small = await draft('1');
    await post(sls, `/api/sales-orders/${small.id}/confirm`).expect(201);
    const big = await draft('50');
    expect((await post(sls, `/api/sales-orders/${big.id}/confirm`)).status).toBe(409);
    const ownerOrder = await draft('50');
    await post(owner, `/api/sales-orders/${ownerOrder.id}/confirm`).expect(201);
    const items = (await get(owner, '/api/sales-controls').expect(200)).body.items as { key: string; refs: string[] }[];
    expect(items.find((f) => f.key === 'SO_NO_APPROVAL')?.refs.join()).toContain(ownerOrder.number);
    await put(owner, '/api/approvals/policy', { salesOrder: 0 }).expect(200);
  });

  it('syarat pelanggan: Keuangan melonggarkan limit/termin menunggu persetujuan; memperketat langsung; pelanggan ganda ditahan', async () => {
    const up = await patch(fin, `/api/customers/${cust}`, { creditLimit: '50000000', paymentTermDays: 60 }).expect(200);
    expect(up.body.termsPending).toBe(true);
    expect(Number((await get(owner, `/api/customers/${cust}`).expect(200)).body.creditLimit)).toBe(5_000_000); // belum berubah
    await post(owner, `/api/approvals/${up.body.approvalId}/approve`, {}).expect(201);
    const after = (await get(owner, `/api/customers/${cust}`).expect(200)).body;
    expect(Number(after.creditLimit)).toBe(50_000_000);
    expect(after.paymentTermDays).toBe(60);
    // memperketat: langsung
    await patch(fin, `/api/customers/${cust}`, { creditLimit: '20000000' }).expect(200);
    expect(Number((await get(owner, `/api/customers/${cust}`).expect(200)).body.creditLimit)).toBe(20_000_000);
    // pelanggan ganda (nama mirip / NPWP sama)
    const dup = await post(fin, '/api/customers', { code: 'C-DUP', name: 'CV. Toko Maju-Jaya' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('POSSIBLE_DUPLICATE_CUSTOMER');
    await post(fin, '/api/customers', { code: 'C-DUP', name: 'CV. Toko Maju-Jaya', confirmDuplicate: true }).expect(201);
    const items = (await get(owner, '/api/sales-controls').expect(200)).body.items as { key: string }[];
    expect(items.some((f) => f.key === 'CUSTOMER_TERMS_CHANGED')).toBe(true);
  });

  it('retur penjualan bernilai besar oleh Keuangan menunggu persetujuan; pembayaran lama dicatat terlambat jadi temuan', async () => {
    const so = await draft('4');
    await post(sls, `/api/sales-orders/${so.id}/confirm`).expect(201);
    await post(wh, `/api/sales-orders/${so.id}/deliver`, { date: addDays(day, -6) }).expect(201);
    const inv = (await post(fin, '/api/invoices', { salesOrderId: so.id, date: addDays(day, -6) }).expect(201)).body;
    const full = (await get(owner, `/api/invoices/${inv.id}`).expect(200)).body as { lines: { id: string }[] };
    // pembayaran bertanggal 5 hari lalu, dicatat hari ini
    await post(fin, '/api/payments', { invoiceId: inv.id, amount: '10000', method: 'TRANSFER', date: addDays(day, -5) }).expect(201);
    const items = (await get(owner, '/api/sales-controls').expect(200)).body.items as { key: string }[];
    expect(items.some((f) => f.key === 'PAYMENT_LATE_RECORDED')).toBe(true);
    // retur
    await put(owner, '/api/approvals/policy', { salesReturn: 1 }).expect(200);
    const body = { invoiceId: inv.id, date: day, reason: 'Rusak', lines: [{ invoiceLineId: full.lines[0].id, qty: '1' }] };
    const r = await post(fin, '/api/sales-returns', body);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('APPROVAL_REQUIRED');
    await post(owner, `/api/approvals/${r.body.requestId}/approve`, {}).expect(201);
    const list = (await get(owner, '/api/sales-returns').expect(200)).body as unknown[];
    expect(list.length).toBe(1);
    await put(owner, '/api/approvals/policy', { salesReturn: 0 }).expect(200);
  });
});
