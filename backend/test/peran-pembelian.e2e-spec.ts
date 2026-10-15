/**
 * Peran Pembelian (semua jenis usaha): memesan (permintaan beli → pesanan), tidak menerima barang, tidak membayar atau
 * memasukkan tagihan pemasok, tidak menyetujui permintaan beli, dan tidak mengubah data master pemasok yang sensitif.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Peran Pembelian (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const MODELS = ['DAGANG', 'RITEL', 'JASA', 'FMCG', 'MANUFAKTUR', 'FNB'] as const;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  describe.each(MODELS)('%s', (m) => {
    let owner: string;
    let buyer: string;
    let wh: string;
    let supplier: string;
    let product: string;
    const post = (url: string, body: object = {}, t = buyer) => http.post(url).set(as(t)).send(body);
    const get = (url: string, t = buyer) => http.get(url).set(as(t));

    beforeAll(async () => {
      owner = (await http.post('/api/auth/register').send({ companyName: `Beli ${m}`, name: 'Pemilik', email: `pb-${m}-${stamp}@uji.id`, password: 'rahasia123', businessModel: m }).expect(201)).body.accessToken;
      await http.post('/api/users').set(as(owner)).send({ name: 'Pembelian', email: `pb-b-${m}-${stamp}@uji.id`, password: 'beli12345678', role: 'PURCHASING' }).expect(201);
      buyer = (await http.post('/api/auth/login').send({ email: `pb-b-${m}-${stamp}@uji.id`, password: 'beli12345678' }).expect(200)).body.accessToken;
      wh = (await http.get('/api/warehouses').set(as(owner)).expect(200)).body[0].id;
      product = (await http.post('/api/products').set(as(owner)).send({ sku: 'BRG', name: 'Barang', baseUom: 'PCS', sellPrice: '1000' }).expect(201)).body.id;
    });

    it('bisa mendaftarkan pemasok, membuat & mengonfirmasi pesanan pembelian, dan melihat data pembelian', async () => {
      supplier = (await post('/api/suppliers', { code: 'SUP1', name: 'PT Pemasok' }).expect(201)).body.id;
      const po = (await post('/api/purchase-orders', { supplierId: supplier, warehouseId: wh, lines: [{ productId: product, qty: '10', price: '500' }] }).expect(201)).body;
      await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
      expect((await get('/api/purchase-orders').expect(200)).body.length).toBeGreaterThan(0);
      expect((await get('/api/suppliers').expect(200)).body.length).toBe(1);
      expect((await get('/api/purchase-invoices').expect(200)).status).toBe(200);
      expect((await get('/api/goods-receipts').expect(200)).status).toBe(200);
      // pesanan tanpa "barang sudah tiba" saja
      const quick = await post('/api/purchase-orders/quick', { supplierId: supplier, warehouseId: wh, receiveNow: true, lines: [{ productId: product, qty: '1', price: '500' }] });
      expect(quick.status).toBe(403);
      (global as unknown as { __po?: string }).__po = po.id;
    });

    it('tidak bisa menerima barang, membayar/menagihkan pemasok, menyetujui permintaan beli, atau mengubah pemasok', async () => {
      const poId = (global as unknown as { __po: string }).__po;
      expect((await post(`/api/purchase-orders/${poId}/receipts`, { lines: [] })).status).toBe(403);
      expect((await post('/api/purchase-invoices/payments', {})).status).toBe(403);
      expect((await post('/api/purchase-invoices/bills', {})).status).toBe(403);
      expect((await post('/api/purchase-invoices', {})).status).toBe(403);
      expect((await post('/api/purchase-returns', {})).status).toBe(403);
      expect((await http.patch(`/api/suppliers/${supplier}`).set(as(buyer)).send({ name: 'Ganti' })).status).toBe(403);
      expect((await post('/api/accounting/journals', {})).status).toBe(403);
      expect((await post('/api/inventory/adjustments', {})).status).toBe(403);
      expect((await get('/api/accounting/statements/income')).status).toBe(403);
      // pesanan tidak bisa dijadikan preferred/auto-approve oleh pembeli sendiri
      const flag = await post('/api/suppliers', { code: 'SUP2', name: 'Pemasok Dua', isPreferred: true });
      expect(flag.status).toBe(403);
    });

    it('permintaan beli: boleh membuat dan mengonversi ke pesanan, tidak menyetujui', async () => {
      const pr = (await post('/api/purchase-requests', { warehouseId: wh, lines: [{ productId: product, qty: '5' }] }).expect(201)).body;
      await post(`/api/purchase-requests/${pr.id}/submit`).expect(201);
      expect((await post(`/api/purchase-requests/${pr.id}/approve`, {})).status).toBe(403);
      await post(`/api/purchase-requests/${pr.id}/approve`, {}, owner).expect(201);
      const full = (await get(`/api/purchase-requests/${pr.id}`).expect(200)).body;
      const conv = await post(`/api/purchase-requests/${pr.id}/convert`, { lines: full.lines.map((l: { id: string }) => ({ lineId: l.id, supplierId: supplier, price: '500' })) });
      expect(conv.status).toBe(201);
    });
  });
});
