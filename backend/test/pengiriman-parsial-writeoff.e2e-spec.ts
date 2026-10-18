/**
 * Pengiriman parsial (beberapa surat jalan per pesanan) dan hapus piutang (write-off) dengan persetujuan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Pengiriman parsial & write-off piutang (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string; let fin: string;
  let W: string; let P: string; let C: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const bal = async (code: string) => {
    const tb = (await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body;
    expect(tb.balanced).toBe(true);
    return Number(tb.rows.find((x: { code: string }) => x.code === code)?.balance ?? 0);
  };
  const stockQty = async () => Number((await get(owner, `/api/inventory/balances?productId=${P}`).expect(200)).body[0].qty);
  const newOrder = async (qty: string) => {
    const o = (await post(owner, '/api/sales-orders', { customerId: C, warehouseId: W, lines: [{ productId: P, qty, price: '20000' }] }).expect(201)).body;
    await post(owner, `/api/sales-orders/${o.id}/confirm`).expect(201);
    return (await get(owner, `/api/sales-orders/${o.id}`).expect(200)).body as { id: string; lines: { id: string }[]; status: string };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Parsial', name: 'P', email: `pp-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    await post(owner, '/api/users', { name: 'fin', email: `pp-fin-${stamp}@uji.id`, password: 'rahasia12345', role: 'FINANCE' }).expect(201);
    fin = (await http.post('/api/auth/login').send({ email: `pp-fin-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
    W = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    P = (await post(owner, '/api/products', { sku: 'PP-1', name: 'Barang', baseUom: 'PCS', sellPrice: '20000' }).expect(201)).body.id;
    C = (await post(owner, '/api/customers', { code: 'C-PP', name: 'Pelanggan', paymentTermDays: 30 }).expect(201)).body.id;
    await post(owner, '/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: addDays(day, -200), lines: [{ productId: P, qty: '100', unitCost: '10000' }] }).expect(201);
  });
  afterAll(async () => { await app.close(); });

  it('kirim bertahap: pesanan tetap CONFIRMED sampai semua terkirim; faktur menunggu', async () => {
    const o = await newOrder('10');
    const d1 = (await post(owner, `/api/sales-orders/${o.id}/deliver`, { lines: [{ orderLineId: o.lines[0].id, qty: '4' }] }).expect(201)).body;
    expect(d1.cogsAmount).toBe('40000.00');
    expect((await get(owner, `/api/sales-orders/${o.id}`).expect(200)).body.status).toBe('CONFIRMED');
    expect(await stockQty()).toBe(96);
    await post(owner, '/api/invoices', { salesOrderId: o.id }).expect(400); // belum lengkap
    await post(owner, `/api/sales-orders/${o.id}/cancel`, { reason: 'batal saja' }).expect(400); // sebagian sudah dikirim
    await post(owner, `/api/sales-orders/${o.id}/deliver`, { lines: [{ orderLineId: o.lines[0].id, qty: '7' }] }).expect(400); // melebihi sisa
    const d2 = (await post(owner, `/api/sales-orders/${o.id}/deliver`, {}).expect(201)).body; // sisa 6
    expect(d2.cogsAmount).toBe('60000.00');
    expect((await get(owner, `/api/sales-orders/${o.id}`).expect(200)).body.status).toBe('DELIVERED');
    expect(await stockQty()).toBe(90);
    await post(owner, `/api/sales-orders/${o.id}/deliver`, {}).expect(400); // sudah lengkap
    const inv = (await post(owner, '/api/invoices', { salesOrderId: o.id }).expect(201)).body;
    expect(Number(inv.cogsAmount)).toBe(100000);
    expect((await get(owner, `/api/deliveries/${d1.id}`).expect(200)).body.invoice?.number).toBe(inv.number);
    expect((await get(owner, `/api/deliveries/${d2.id}`).expect(200)).body.invoice?.number).toBe(inv.number);
    await bal('5-1000');
  });

  it('membatalkan satu surat jalan membuat pesanan belum lengkap lagi', async () => {
    const o = await newOrder('5');
    await post(owner, `/api/sales-orders/${o.id}/deliver`, { lines: [{ orderLineId: o.lines[0].id, qty: '2' }] }).expect(201);
    const d2 = (await post(owner, `/api/sales-orders/${o.id}/deliver`, {}).expect(201)).body;
    expect((await get(owner, `/api/sales-orders/${o.id}`).expect(200)).body.status).toBe('DELIVERED');
    await post(owner, `/api/deliveries/${d2.id}/cancel`, { reason: 'salah kirim' }).expect(201);
    expect((await get(owner, `/api/sales-orders/${o.id}`).expect(200)).body.status).toBe('CONFIRMED');
    await post(owner, `/api/sales-orders/${o.id}/deliver`, {}).expect(201);
    expect((await get(owner, `/api/sales-orders/${o.id}`).expect(200)).body.status).toBe('DELIVERED');
  });

  it('write-off: faktur belum 90 hari lewat jatuh tempo ditolak; yang macet butuh persetujuan lalu piutang hilang', async () => {
    const recent = await newOrder('1');
    await post(owner, `/api/sales-orders/${recent.id}/deliver`, {}).expect(201);
    const invRecent = (await post(owner, '/api/invoices', { salesOrderId: recent.id }).expect(201)).body;
    await post(fin, '/api/payments/write-off', { invoiceId: invRecent.id, reason: 'pelanggan bangkrut' }).expect(400);

    const o = await newOrder('2');
    await post(owner, `/api/sales-orders/${o.id}/deliver`, {}).expect(201);
    const inv = (await post(owner, '/api/invoices', { salesOrderId: o.id, date: addDays(day, -150) }).expect(201)).body; // jatuh tempo ±120 hari lalu
    const ar0 = await bal('1-1300');
    await post(fin, '/api/payments/write-off', { invoiceId: inv.id, reason: 'x' }).expect(400); // alasan terlalu pendek
    const r = await post(fin, '/api/payments/write-off', { invoiceId: inv.id, reason: 'Pelanggan bangkrut, sudah 3x ditagih' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('APPROVAL_REQUIRED');
    expect(Number(await bal('1-1300'))).toBe(ar0); // belum berubah
    await post(owner, `/api/approvals/${r.body.requestId}/approve`, {}).expect(201);
    expect(await bal('1-1300')).toBe(ar0 - 44400);
    expect(await bal('6-7300')).toBe(44400); // termasuk PPN
    const after = (await get(owner, `/api/invoices/${inv.id}`).expect(200)).body;
    expect(after.status).toBe('PAID');
    await post(fin, '/api/payments', { invoiceId: inv.id, amount: '1000', method: 'CASH' }).expect(400); // sudah tak ada sisa
    const items = (await get(owner, '/api/sales-controls').expect(200)).body.items as { key: string }[];
    expect(items.some((f) => f.key === 'AR_WRITE_OFF')).toBe(true);
  });
});
