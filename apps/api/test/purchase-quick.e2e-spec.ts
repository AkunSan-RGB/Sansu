/** Pembelian cepat atas penawaran supplier dan riwayat harga beli aktual */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Pembelian cepat & riwayat harga (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let gudang: string;
  let finance: string;
  let wh: string;
  let supA: string;
  let supB: string;
  let p1: string;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const login = async (email: string, password: string) => (await http.post('/api/auth/login').send({ email, password }).expect(200)).body.accessToken as string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Cepat', name: 'Pemilik', email: `qk-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    await post(owner, '/api/users', { name: 'Gudang', email: `qk-g-${stamp}@uji.id`, password: 'gudang12345', role: 'WAREHOUSE' }).expect(201);
    await post(owner, '/api/users', { name: 'Keuangan', email: `qk-f-${stamp}@uji.id`, password: 'keuangan123', role: 'FINANCE' }).expect(201);
    gudang = await login(`qk-g-${stamp}@uji.id`, 'gudang12345');
    finance = await login(`qk-f-${stamp}@uji.id`, 'keuangan123');
    wh = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    supA = (await post(owner, '/api/suppliers', { code: 'SA', name: 'Pemasok A' }).expect(201)).body.id;
    supB = (await post(owner, '/api/suppliers', { code: 'SB', name: 'Pemasok B' }).expect(201)).body.id;
    p1 = (await post(owner, '/api/products', { sku: 'MIE', name: 'Mie', sellPrice: '3500' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('pembelian cepat: PO langsung terkonfirmasi dan bertanda harga estimasi; gudang tidak boleh', async () => {
    const body = { supplierId: supA, warehouseId: wh, notes: 'Penawaran WA 11 Okt', lines: [{ productId: p1, qty: '100', price: '2000' }] };
    await post(gudang, '/api/purchase-orders/quick', body).expect(403);
    const r = (await post(finance, '/api/purchase-orders/quick', body).expect(201)).body;
    expect(r).toMatchObject({ status: 'CONFIRMED', priceEstimate: true, approvalPending: false, receiptStatus: 'NONE' });
    const normal = (await post(owner, '/api/purchase-orders', { ...body }).expect(201)).body;
    expect(normal.priceEstimate).toBe(false);
  });

  it('barang sudah tiba: diterima sekaligus, lalu faktur dengan harga berbeda menjadi biaya perolehan', async () => {
    const r = (await post(owner, '/api/purchase-orders/quick', { supplierId: supA, warehouseId: wh, receiveNow: true, lines: [{ productId: p1, qty: '50', price: '2000' }] }).expect(201)).body;
    expect(r).toMatchObject({ status: 'CONFIRMED', receiptStatus: 'FULL', priceEstimate: true });
    const stock = (await get(owner, `/api/inventory/balances?productId=${p1}`).expect(200)).body[0];
    expect(Number(stock.qty)).toBe(50);
    const inv = (await post(owner, '/api/purchase-invoices', { purchaseOrderId: r.id, supplierInvoiceNo: 'INV-A-1', varianceReason: 'MARKET_VOLATILITY', prices: [{ orderLineId: r.lines[0].id, price: '2300' }] }).expect(201)).body;
    expect(inv.priceVariance).toBe('15000.00');
    expect(Number((await get(owner, `/api/inventory/balances?productId=${p1}`).expect(200)).body[0].avgCost)).toBe(2300);
  });

  it('riwayat harga: terakhir, rata-rata, terendah, tertinggi, dan per supplier dari faktur aktual', async () => {
    const r = (await post(owner, '/api/purchase-orders/quick', { supplierId: supB, warehouseId: wh, receiveNow: true, lines: [{ productId: p1, qty: '10', price: '1800' }] }).expect(201)).body;
    await post(owner, '/api/purchase-invoices', { purchaseOrderId: r.id, supplierInvoiceNo: 'INV-B-1' }).expect(201); // harga PO 1.800 = harga faktur
    const h = (await get(owner, `/api/purchase-orders/price-history?productIds=${p1}`).expect(200)).body[p1];
    expect(h).toMatchObject({ last: 1800, lastSupplier: 'Pemasok B', min: 1800, max: 2300, count: 2 });
    expect(h.avg90).toBe(2050);
    expect(h.suppliers.map((s: { name: string }) => s.name).sort()).toEqual(['Pemasok A', 'Pemasok B']);
    expect(h.suppliers.find((s: { name: string }) => s.name === 'Pemasok A')).toMatchObject({ last: 2300, count: 1 });
  });

  it('produk tanpa riwayat tidak muncul; id sembarang ditolak; tenant lain tidak melihat harga', async () => {
    const other = (await post(owner, '/api/products', { sku: 'BARU', name: 'Baru', sellPrice: '1000' }).expect(201)).body.id;
    const h = (await get(owner, `/api/purchase-orders/price-history?productIds=${p1},${other}`).expect(200)).body;
    expect(Object.keys(h)).toEqual([p1]);
    expect((await get(owner, '/api/purchase-orders/price-history?productIds=bukan-uuid')).status).toBe(400);
    expect((await get(owner, '/api/purchase-orders/price-history')).status).toBe(400);
    const lain = (await http.post('/api/auth/register').send({ companyName: 'PT Lain', name: 'X', email: `qk-o-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    expect((await get(lain, `/api/purchase-orders/price-history?productIds=${p1}`).expect(200)).body).toEqual({});
  });

  it('nilai di atas batas persetujuan: PO tetap draft dan menunggu keputusan', async () => {
    await http.put('/api/approvals/policy').set(as(owner)).send({ purchaseOrder: 100000 }).expect(200);
    const r = (await post(finance, '/api/purchase-orders/quick', { supplierId: supA, warehouseId: wh, receiveNow: true, lines: [{ productId: p1, qty: '100', price: '2000' }] }).expect(201)).body;
    expect(r).toMatchObject({ status: 'DRAFT', approvalPending: true, receiptStatus: 'NONE' });
    expect(r.approvalMessage).toContain('persetujuan');
  });
});
