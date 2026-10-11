/**
 * Harga faktur supplier boleh berbeda dari PO (harga volatil di FMCG): biaya perolehan persediaan mengikuti harga faktur,
 * bukan harga PO. Selisih masuk ke nilai stok yang masih ada dan ke HPP untuk barang yang sudah terjual.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Selisih harga faktur terhadap PO (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let wh: string;
  let sup: string;
  const stamp = Date.now();
  const as = () => ({ Authorization: `Bearer ${token}` });
  const get = (u: string) => http.get(u).set(as());
  const post = (u: string, b: object = {}) => http.post(u).set(as()).send(b);
  const bal = async (code: string) => {
    const tb = (await get('/api/accounting/reports/trial-balance').expect(200)).body;
    expect(tb.balanced).toBe(true);
    return Number(tb.rows.find((x: { code: string }) => x.code === code)?.balance ?? 0);
  };
  const stock = async (productId: string) => (await get(`/api/inventory/balances?productId=${productId}`).expect(200)).body[0] as { qty: string; avgCost: string };
  const product = async (sku: string) => (await post('/api/products', { sku, name: `Barang ${sku}`, sellPrice: '5000' }).expect(201)).body.id as string;
  const order = async (lines: { productId: string; qty: string; price: string }[]) => {
    const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: wh, lines }).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    return (await get(`/api/purchase-orders/${po.id}`).expect(200)).body;
  };
  let n = 0;
  const bill = (poId: string, extra: object = {}) => post('/api/purchase-invoices', { purchaseOrderId: poId, supplierInvoiceNo: `F-${stamp}-${++n}`, ...extra });
  const lineOf = (po: { lines: { id: string; productId: string }[] }, productId: string) => po.lines.find((l) => l.productId === productId)!.id;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (await http.post('/api/auth/register').send({ companyName: 'CV Harga Volatil', name: 'Pemilik', email: `pv-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'RITEL' }).expect(201)).body.accessToken;
    wh = (await get('/api/warehouses')).body[0].id;
    sup = (await post('/api/suppliers', { code: 'S1', name: 'PT Pemasok' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('barang tiba bersama faktur: harga faktur langsung jadi biaya perolehan, PPN dan utang mengikuti faktur', async () => {
    const p = await product('V1');
    const po = await order([{ productId: p, qty: '10', price: '1000' }]); // DPP 10.000
    const inv = (await bill(po.id, { prices: [{ orderLineId: lineOf(po, p), price: '1200' }] }).expect(201)).body;
    expect(inv).toMatchObject({ subtotal: '12000.00', taxAmount: '1320.00', total: '13320.00', priceVariance: '2000.00' });
    expect(inv.lines[0]).toMatchObject({ price: '1200', lineTotal: '12000', priceVariance: '2000' });
    expect(Number((await stock(p)).avgCost)).toBe(1200);
    expect(await bal('1-1400')).toBe(12000);
    expect(await bal('2-1100')).toBe(13320);
    expect(await bal('2-1160')).toBe(0);
    expect(await bal('1-1500')).toBe(1320);
  });

  it('terima dulu, faktur lebih mahal: stok yang masih ada naik nilainya, penampung barang diterima tertutup', async () => {
    const p = await product('V2');
    const po = await order([{ productId: p, qty: '10', price: '1000' }]);
    await post(`/api/purchase-orders/${po.id}/receipts`, {}).expect(201);
    expect(await bal('2-1160')).toBe(10000);
    const before = await bal('1-1400');
    const inv = (await bill(po.id, { prices: [{ orderLineId: lineOf(po, p), price: '1300' }] }).expect(201)).body;
    expect(inv).toMatchObject({ subtotal: '13000.00', taxAmount: '1430.00', total: '14430.00', priceVariance: '3000.00' });
    expect(await bal('2-1160')).toBe(0);
    expect(await bal('1-1400')).toBe(before + 3000);
    expect(Number((await stock(p)).avgCost)).toBe(1300);
    expect((await get(`/api/purchase-orders/${po.id}`).expect(200)).body.status).toBe('BILLED');
  });

  it('sebagian barang sudah terjual saat faktur tiba: selisih dibagi ke persediaan dan HPP', async () => {
    const p = await product('V3');
    const po = await order([{ productId: p, qty: '10', price: '1000' }]);
    await post(`/api/purchase-orders/${po.id}/receipts`, {}).expect(201);
    const session = (await post('/api/pos/sessions', { warehouseId: wh, openingCash: '0' }).expect(201)).body.id;
    await post('/api/pos/orders', { sessionId: session, lines: [{ productId: p, qty: '6' }], payments: [{ method: 'CASH', amount: String(6 * 5550) }] }).expect(201);
    expect(await bal('5-1000')).toBe(6000);
    const invBefore = await bal('1-1400');
    await bill(po.id, { prices: [{ orderLineId: lineOf(po, p), price: '1500' }] }).expect(201); // selisih 5.000; sisa 4 dari 10 = 40%
    expect(await bal('5-1000')).toBe(6000 + 3000);
    expect(await bal('1-1400')).toBe(invBefore + 2000);
    expect(Number((await stock(p)).avgCost)).toBe(1500);
    expect(await bal('2-1160')).toBe(0);
  });

  it('faktur lebih murah dari PO menurunkan biaya perolehan', async () => {
    const p = await product('V4');
    const po = await order([{ productId: p, qty: '10', price: '1000' }]);
    await post(`/api/purchase-orders/${po.id}/receipts`, {}).expect(201);
    const inv = (await bill(po.id, { prices: [{ orderLineId: lineOf(po, p), price: '900' }] }).expect(201)).body;
    expect(inv).toMatchObject({ subtotal: '9000.00', taxAmount: '990.00', priceVariance: '-1000.00' });
    expect(Number((await stock(p)).avgCost)).toBe(900);
    expect(await bal('2-1160')).toBe(0);
  });

  it('faktur bertahap dengan selisih pada tahap pertama: PPN mengikuti DPP faktur dan pesanan tuntas', async () => {
    const p = await product('V5');
    const po = await order([{ productId: p, qty: '10', price: '1000' }]);
    await post(`/api/purchase-orders/${po.id}/receipts`, {}).expect(201);
    const i1 = (await bill(po.id, { lines: [{ orderLineId: lineOf(po, p), qty: '4' }], prices: [{ orderLineId: lineOf(po, p), price: '1100' }] }).expect(201)).body;
    expect(i1).toMatchObject({ subtotal: '4400.00', taxAmount: '484.00', priceVariance: '400.00' });
    const i2 = (await bill(po.id).expect(201)).body; // sisa 6 @ harga PO
    expect(i2).toMatchObject({ subtotal: '6000.00', taxAmount: '660.00', total: '6660.00' });
    expect((await get(`/api/purchase-orders/${po.id}`).expect(200)).body.status).toBe('BILLED');
    expect(await bal('2-1160')).toBe(0);
  });

  it('harga sama dengan PO tidak menimbulkan selisih', async () => {
    const p = await product('V6');
    const po = await order([{ productId: p, qty: '10', price: '1000' }]);
    const inv = (await bill(po.id, { prices: [{ orderLineId: lineOf(po, p), price: '1000' }] }).expect(201)).body;
    expect(inv).toMatchObject({ subtotal: '10000.00', taxAmount: '1100.00', priceVariance: '0.00' });
  });

  it('validasi: harga nol/negatif/sembarang, baris asing, ganda, dan baris yang tidak ditagih', async () => {
    const a = await product('V7');
    const b = await product('V8');
    const po = await order([
      { productId: a, qty: '5', price: '1000' },
      { productId: b, qty: '5', price: '2000' },
    ]);
    await post(`/api/purchase-orders/${po.id}/receipts`, {}).expect(201);
    const la = lineOf(po, a);
    const lb = lineOf(po, b);
    expect((await bill(po.id, { prices: [{ orderLineId: la, price: '0' }] })).status).toBe(400);
    expect((await bill(po.id, { prices: [{ orderLineId: la, price: '-5' }] })).status).toBe(400);
    expect((await bill(po.id, { prices: [{ orderLineId: la, price: 'abc' }] })).status).toBe(400);
    expect((await bill(po.id, { prices: [{ orderLineId: '00000000-0000-4000-8000-000000000000', price: '10' }] })).status).toBe(400);
    expect((await bill(po.id, { prices: [{ orderLineId: la, price: '10' }, { orderLineId: la, price: '11' }] })).status).toBe(400);
    const notBilled = await bill(po.id, { lines: [{ orderLineId: la, qty: '5' }], prices: [{ orderLineId: lb, price: '2500' }] });
    expect(notBilled.status).toBe(400);
    expect(notBilled.body.message).toContain('tidak ditagih');
    // tidak ada yang tercatat dari percobaan gagal
    expect(await bal('2-1100')).toBeGreaterThan(0);
    const ok = await bill(po.id, { prices: [{ orderLineId: la, price: '1100' }, { orderLineId: lb, price: '1900' }] }).expect(201);
    expect(ok.body.priceVariance).toBe('0.00'); // +500 dan −500
    expect(await bal('2-1160')).toBe(0);
  });
});
