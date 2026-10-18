/**
 * Serah terima dokumen antar bagian: antrean kerja tiap bagian mengikuti status dokumen (pesanan → pengiriman → faktur,
 * PO → penerimaan → tagihan, permintaan beli disetujui → PO), dan hilang begitu bagian berikutnya selesai.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Serah terima dokumen antar bagian (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  let owner: string; let sales: string; let wh: string; let fin: string; let buyer: string; let acct: string;
  let whId: string; let prod: string; let cust: string; let sup: string;
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const q = async (t: string) => (await get('/api/tasks/mine', t).expect(200)).body as { key: string; count: number }[];
  const count = async (t: string, key: string) => (await q(t)).find((x) => x.key === key)?.count ?? 0;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Serah Terima', name: 'P', email: `st-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    const mk = async (role: string, n: string) => {
      await post('/api/users', { name: n, email: `st-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      return (await http.post('/api/auth/login').send({ email: `st-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    };
    sales = await mk('SALES', 'sales'); wh = await mk('WAREHOUSE', 'gudang'); fin = await mk('FINANCE', 'fin'); buyer = await mk('PURCHASING', 'beli'); acct = await mk('ACCOUNTANT', 'akuntan');
    whId = (await get('/api/warehouses').expect(200)).body[0].id;
    prod = (await post('/api/products', { sku: 'ST1', name: 'Barang', baseUom: 'PCS', sellPrice: '10000' }).expect(201)).body.id;
    cust = (await post('/api/customers', { code: 'C1', name: 'Pelanggan' }).expect(201)).body.id;
    sup = (await post('/api/suppliers', { code: 'S1', name: 'Pemasok' }).expect(201)).body.id;
    await post('/api/inventory/adjustments', { warehouseId: whId, reason: 'OPENING', date: today, lines: [{ productId: prod, qty: '100', unitCost: '5000' }] }).expect(201);
  });
  afterAll(() => app.close());

  it('penjualan: pesanan dikonfirmasi → antrean Gudang; terkirim → antrean Keuangan; difakturkan → hilang', async () => {
    const so = (await post('/api/sales-orders', { customerId: cust, warehouseId: whId, date: today, lines: [{ productId: prod, qty: '2' }] }, sales).expect(201)).body;
    expect(await count(wh, 'handoff-ship')).toBe(0); // masih draf
    await post(`/api/sales-orders/${so.id}/confirm`, {}, sales).expect(201);
    expect(await count(wh, 'handoff-ship')).toBe(1);
    expect(await count(fin, 'handoff-ship')).toBe(0); // bukan bagian Keuangan
    expect(await count(sales, 'handoff-ship')).toBe(0);
    const dlv = (await post(`/api/sales-orders/${so.id}/deliver`, {}, wh).expect(201)).body;
    expect(await count(wh, 'handoff-ship')).toBe(0);
    expect(await count(fin, 'handoff-invoice')).toBe(1);
    expect(await count(wh, 'handoff-invoice')).toBe(0);
    await post('/api/invoices', { salesOrderId: so.id, date: today }, fin).expect(201);
    expect(await count(fin, 'handoff-invoice')).toBe(0);
    void dlv;
  });

  it('pembelian: PO dikonfirmasi → antrean Gudang; diterima → antrean Keuangan; ditagih → hilang', async () => {
    const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: whId, lines: [{ productId: prod, qty: '10', price: '4000' }] }, buyer).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`, {}, buyer).expect(201);
    expect(await count(wh, 'handoff-receive')).toBe(1);
    expect(await count(fin, 'handoff-bill')).toBe(0);
    await post(`/api/purchase-orders/${po.id}/receipts`, {}, wh).expect(201);
    expect(await count(wh, 'handoff-receive')).toBe(0);
    expect(await count(fin, 'handoff-bill')).toBe(1);
    await post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'ST-1' }, owner).expect(201);
    expect(await count(fin, 'handoff-bill')).toBe(0);
  });

  it('permintaan beli disetujui → antrean Pembelian; dijadikan PO → hilang', async () => {
    const pr = (await post('/api/purchase-requests', { warehouseId: whId, lines: [{ productId: prod, qty: '5' }] }, wh).expect(201)).body;
    await post(`/api/purchase-requests/${pr.id}/submit`, {}, wh).expect(201);
    await post(`/api/purchase-requests/${pr.id}/approve`, {}, owner).expect(201);
    expect(await count(buyer, 'handoff-pr')).toBe(1);
    expect(await count(acct, 'handoff-pr')).toBe(0);
    const full = (await get(`/api/purchase-requests/${pr.id}`).expect(200)).body;
    await post(`/api/purchase-requests/${pr.id}/convert`, { lines: full.lines.map((l: { id: string }) => ({ lineId: l.id, supplierId: sup, price: '500' })) }, buyer).expect(201);
    expect(await count(buyer, 'handoff-pr')).toBe(0);
  });
});
