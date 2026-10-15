/**
 * Metode biaya persediaan: rata-rata bergerak dan MPKP/FIFO (SAK EP Bab 13, ED SAK EMKM Bab 9; LIFO tidak diakui).
 * Berlaku untuk semua jenis usaha dan kedua standar pelaporan; berpindah metode tidak mengubah nilai persediaan yang sudah ada.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Metode biaya persediaan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const MODELS = ['DAGANG', 'RITEL', 'JASA', 'FMCG', 'MANUFAKTUR', 'FNB'] as const;
  const tokens: Record<string, string> = {};
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    for (const m of MODELS) {
      tokens[m] = (await http.post('/api/auth/register').send({ companyName: `Metode ${m}`, name: 'Pemilik', email: `im-${m}-${stamp}@uji.id`, password: 'rahasia123', businessModel: m }).expect(201)).body.accessToken;
    }
  });
  afterAll(() => app.close());

  describe.each(MODELS)('%s', (m) => {
    it('bawaan rata-rata bergerak, FIFO bisa dipilih, LIFO ditolak, saran mengikuti jenis usaha dan standar', async () => {
      const t = tokens[m];
      const cur = (await http.get('/api/settings/inventory-method').set(as(t)).expect(200)).body;
      expect(cur.method).toBe('AVERAGE');
      expect(cur.options.map((o: { key: string }) => o.key)).toEqual(['AVERAGE', 'FIFO']);
      expect(cur.guide.notes.join(' ')).toContain('LIFO tidak diakui');
      expect(cur.guide.notes.join(' ')).toContain('SAK EP Bab 13');
      if (m === 'JASA') expect(cur.guide.recommended).toBeNull();
      else expect(cur.guide.recommended).toBe('AVERAGE');
      const bad = await http.put('/api/settings/inventory-method').set(as(t)).send({ method: 'LIFO' });
      expect(bad.status).toBe(400);
      expect(bad.body.message).toContain('LIFO');
      await http.put('/api/settings/inventory-method').set(as(t)).send({ method: 'FIFO' }).expect(200);
      // pindah ke SAK EMKM: aturan metode sama, rujukan standar berubah, CALK mengikuti metode
      await http.patch('/api/settings/reporting').set(as(t)).send({ framework: 'SAK_EMKM' }).expect(200);
      const emkm = (await http.get('/api/settings/inventory-method').set(as(t)).expect(200)).body;
      expect(emkm.method).toBe('FIFO');
      expect(emkm.guide.notes.join(' ')).toContain('ED SAK EMKM Bab 9');
      const notes = JSON.stringify((await http.get(`/api/accounting/notes/${new Date().getFullYear()}`).set(as(t)).expect(200)).body);
      expect(notes).toContain('masuk pertama keluar pertama');
      expect(notes).not.toContain('rata-rata tertimbang (moving average)');
      await http.patch('/api/settings/reporting').set(as(t)).send({ framework: 'SAK_EP' }).expect(200);
      await http.put('/api/settings/inventory-method').set(as(t)).send({ method: 'AVERAGE' }).expect(200);
      const notes2 = JSON.stringify((await http.get(`/api/accounting/notes/${new Date().getFullYear()}`).set(as(t)).expect(200)).body);
      expect(notes2).toContain('rata-rata tertimbang (moving average)');
    });
  });

  it('HPP mengikuti metode: FIFO 16.000 vs rata-rata 16.500; beralih metode tidak mengubah nilai stok; jurnal tetap seimbang', async () => {
    const t = tokens.RITEL;
    const get = (u: string) => http.get(u).set(as(t));
    const post = (u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
    const bal = async (code: string) => {
      const tb = (await get('/api/accounting/reports/trial-balance').expect(200)).body;
      expect(tb.balanced).toBe(true);
      return Number(tb.rows.find((x: { code: string }) => x.code === code)?.balance ?? 0);
    };
    const wh = (await get('/api/warehouses').expect(200)).body[0].id;
    const sup = (await post('/api/suppliers', { code: 'S1', name: 'Pemasok' }).expect(201)).body.id;
    const product = async (sku: string) => (await post('/api/products', { sku, name: `Barang ${sku}`, sellPrice: '5000' }).expect(201)).body.id as string;
    const buy = async (productId: string, qty: string, price: string, no: string) => {
      const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: wh, lines: [{ productId, qty, price }] }).expect(201)).body;
      await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
      await post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: no }).expect(201);
    };
    const stock = async (productId: string) => (await get(`/api/inventory/balances?productId=${productId}`).expect(200)).body[0];
    const session = (await post('/api/pos/sessions', { warehouseId: wh, openingCash: '0' }).expect(201)).body.id;
    const sell = (productId: string, qty: number) => post('/api/pos/orders', { sessionId: session, lines: [{ productId, qty: String(qty) }], payments: [{ method: 'CASH', amount: String(qty * 5550) }] }).expect(201);

    // FIFO: 10 @1.000 lalu 10 @1.200, jual 15
    await http.put('/api/settings/inventory-method').set(as(t)).send({ method: 'FIFO' }).expect(200);
    const p1 = await product('F1');
    await buy(p1, '10', '1000', 'F-1');
    await buy(p1, '10', '1200', 'F-2');
    await sell(p1, 15);
    expect(await bal('5-1000')).toBe(16000);
    expect(await bal('1-1400')).toBe(6000); // sisa 5 @1.200
    expect(Number((await stock(p1)).avgCost)).toBe(1200);

    // rata-rata bergerak pada barang lain: 15 × 1.100 = 16.500
    await http.put('/api/settings/inventory-method').set(as(t)).send({ method: 'AVERAGE' }).expect(200);
    const p2 = await product('A1');
    await buy(p2, '10', '1000', 'A-1');
    await buy(p2, '10', '1200', 'A-2');
    await sell(p2, 15);
    expect(await bal('5-1000')).toBe(16000 + 16500);
    expect(await bal('1-1400')).toBe(6000 + 5500); // sisa 5 @1.100

    // kembali ke FIFO: sisa 5 @1.100 menjadi lapisan awal; beli 10 @1.300, jual 10 → 5×1.100 + 5×1.300 = 12.000
    await http.put('/api/settings/inventory-method').set(as(t)).send({ method: 'FIFO' }).expect(200);
    expect(await bal('1-1400')).toBe(6000 + 5500); // beralih tidak mengubah nilai
    await buy(p2, '10', '1300', 'A-3');
    await sell(p2, 10);
    expect(await bal('5-1000')).toBe(16000 + 16500 + 12000);
    expect(Number((await stock(p2)).qty)).toBe(5);
    expect(Number((await stock(p2)).avgCost)).toBe(1300);
  });
});
