/**
 * FMCG: penelusuran lot untuk penarikan produk (recall) — satu nomor lot ditelusuri ke asal penerimaan dan seluruh
 * pelanggan penerimanya (surat jalan & faktur langsung), transfer, serta pembuangan; lot lain tidak ikut terbawa.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('FMCG: penelusuran lot / recall (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  let owner: string;
  let wh: string;
  let P: string;
  let c1: string;
  let c2: string;
  let c3: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const today = new Date().toISOString().slice(0, 10);
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Recall Uji', name: 'Pemilik', email: `rc-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FMCG' }).expect(201)).body.accessToken;
    wh = (await get('/api/warehouses').expect(200)).body[0].id;
    P = (await post('/api/products', { sku: 'BSK', name: 'Biskuit Kelapa', baseUom: 'PCS', sellPrice: '9500' }).expect(201)).body.id;
    const sup = (await post('/api/suppliers', { code: 'PRI', name: 'PT Prinsipal Pangan' }).expect(201)).body.id;
    const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: wh, lines: [{ productId: P, qty: '100', price: '7000' }, { productId: P, qty: '60', price: '7100' }] }).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    await post(`/api/purchase-orders/${po.id}/receipts`, { date: today, lines: [
      { orderLineId: po.lines[0].id, qty: '100', lotNo: 'BSK-A', expiryDate: inDays(90) },
      { orderLineId: po.lines[1].id, qty: '60', lotNo: 'BSK-B', expiryDate: inDays(200) },
    ] }).expect(201);
    c1 = (await post('/api/customers', { code: 'OTL-1', name: 'Minimarket Berkah', phone: '0812', address: 'Bekasi' }).expect(201)).body.id;
    c2 = (await post('/api/customers', { code: 'OTL-2', name: 'Warung Bu Sari' }).expect(201)).body.id;
    c3 = (await post('/api/customers', { code: 'OTL-3', name: 'Grosir Rezeki' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  const sell = async (customerId: string, qty: string, mode: 'DELIVER' | 'INVOICE') => {
    const so = (await post('/api/sales-orders', { customerId, warehouseId: wh, lines: [{ productId: P, qty }] }).expect(201)).body;
    await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    if (mode === 'DELIVER') return (await post(`/api/sales-orders/${so.id}/deliver`).expect(201)).body;
    return (await post('/api/invoices', { salesOrderId: so.id }).expect(201)).body;
  };
  const trace = (lotNo: string, t = owner) => get(`/api/inventory/lots/trace?productId=${P}&lotNo=${lotNo}`, t);

  it('FEFO: penjualan mengambil lot yang lebih cepat kedaluwarsa (A) dulu; penelusuran A menemukan semua pelanggannya', async () => {
    await sell(c1, '40', 'DELIVER');
    await sell(c2, '35', 'INVOICE');
    const t = (await trace('BSK-A').expect(200)).body;
    expect(t.product.sku).toBe('BSK');
    expect(t.lots).toHaveLength(1);
    expect(t.lots[0].source).toMatchObject({ type: 'Penerimaan barang', supplier: 'PT Prinsipal Pangan' });
    expect(t.lots[0].source.number).toMatch(/^GR/);
    expect(t.customers.map((c: { code: string; qty: string }) => [c.code, Number(c.qty)])).toEqual([['OTL-1', 40], ['OTL-2', 35]]);
    expect(t.customers[0]).toMatchObject({ name: 'Minimarket Berkah', phone: '0812', address: 'Bekasi' });
    expect(t.customers[0].docs[0].number).toMatch(/^(DO|SJ|DLV)/);
    expect(Number(t.summary.received)).toBe(100);
    expect(Number(t.summary.toCustomers)).toBe(75);
    expect(Number(t.summary.remaining)).toBe(25);
    expect(Number(t.summary.untraced)).toBe(0);
    // lot B belum disentuh: tidak ada pelanggan yang terkait
    const b = (await trace('BSK-B').expect(200)).body;
    expect(b.customers).toEqual([]);
    expect(Number(b.summary.remaining)).toBe(60);
  });

  it('pengeluaran lain (pembuangan) dan penjualan berikutnya yang melewati batas lot tercatat per lot', async () => {
    await sell(c3, '30', 'INVOICE'); // 25 dari A (habis) + 5 dari B
    const a = (await trace('BSK-A').expect(200)).body;
    expect(a.customers.map((c: { code: string }) => c.code).sort()).toEqual(['OTL-1', 'OTL-2', 'OTL-3']);
    expect(Number(a.customers.find((c: { code: string }) => c.code === 'OTL-3').qty)).toBe(25);
    expect(Number(a.summary.remaining)).toBe(0);
    const b = (await trace('BSK-B').expect(200)).body;
    expect(b.customers.map((c: { code: string; qty: string }) => [c.code, Number(c.qty)])).toEqual([['OTL-3', 5]]);
    // buang sisa lot B → muncul di "lainnya", bukan di pelanggan
    const lots = (await get('/api/inventory/lots').expect(200)).body.items as { id: string; lotNo: string }[];
    await post(`/api/inventory/lots/${lots.find((l) => l.lotNo === 'BSK-B')!.id}/discard`, { notes: 'Uji' }).expect(201);
    const b2 = (await trace('BSK-B').expect(200)).body;
    expect(b2.other.map((o: { type: string; qty: string }) => [o.type, Number(o.qty)])).toEqual([['ADJUSTMENT_OUT', 55]]);
    expect(Number(b2.summary.untraced)).toBe(0);
  });

  it('pengiriman yang dibatalkan ditandai dan tidak dihitung ke pelanggan', async () => {
    const p2 = (await post('/api/products', { sku: 'TEH', name: 'Teh Kotak', baseUom: 'PCS', sellPrice: '5000' }).expect(201)).body.id;
    const sup = (await post('/api/suppliers', { code: 'PRI2', name: 'PT Minuman' }).expect(201)).body.id;
    const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: wh, lines: [{ productId: p2, qty: '50', price: '3000' }] }).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    await post(`/api/purchase-orders/${po.id}/receipts`, { date: today, lines: [{ orderLineId: po.lines[0].id, qty: '50', lotNo: 'TEH-1', expiryDate: inDays(30) }] }).expect(201);
    const so = (await post('/api/sales-orders', { customerId: c1, warehouseId: wh, lines: [{ productId: p2, qty: '20' }] }).expect(201)).body;
    await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    const dl = (await post(`/api/sales-orders/${so.id}/deliver`).expect(201)).body;
    await post(`/api/deliveries/${dl.id}/cancel`, {}).expect(201);
    const t = (await get(`/api/inventory/lots/trace?productId=${p2}&lotNo=TEH-1`).expect(200)).body;
    expect(Number(t.summary.toCustomers)).toBe(0);
    expect(t.customers[0].docs[0].cancelled).toBe(true);
    expect(Number(t.summary.untraced)).toBe(0);
  });

  it('lot tidak ada = 404; peran tanpa hak tidak boleh; perusahaan lain tidak melihat lot ini', async () => {
    expect((await trace('TIDAK-ADA')).status).toBe(404);
    const other = (await http.post('/api/auth/register').send({ companyName: 'PT Lain', name: 'P', email: `rc-o-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FMCG' }).expect(201)).body.accessToken;
    expect((await trace('BSK-A', other)).status).toBe(404);
    await post('/api/users', { name: 'Kasir', email: `rc-k-${stamp}@uji.id`, password: 'kasir12345', role: 'CASHIER' }).expect(201);
    const k = (await http.post('/api/auth/login').send({ email: `rc-k-${stamp}@uji.id`, password: 'kasir12345' }).expect(200)).body.accessToken;
    expect((await trace('BSK-A', k)).status).toBe(403);
  });
});
