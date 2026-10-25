/**
 * Temuan uji klik (e2e): kasir tidak boleh menjual barang tanpa harga jual (Rp 0) walau ada barang berharga lain di keranjang
 * (celah barang gratis: stok berkurang tanpa pendapatan).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Temuan uji klik (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let cashier: string;
  let W: string;
  let PAID: string;
  let FREE: string;
  let sessionId: string;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const stockOf = async (pid: string) => Number((await http.get(`/api/inventory/balances?productId=${pid}&warehouseId=${W}`).set(as(owner)).expect(200)).body[0]?.qty ?? 0);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kasir Gratis', name: 'Pemilik', email: `kg-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'RITEL' }).expect(201)).body.accessToken;
    await post(owner, '/api/apps/pos/install').catch(() => undefined);
    await post(owner, '/api/users', { name: 'Kasir', email: `kg-k-${stamp}@uji.id`, password: 'kasir123456', role: 'CASHIER' }).expect(201);
    cashier = (await http.post('/api/auth/login').send({ email: `kg-k-${stamp}@uji.id`, password: 'kasir123456' }).expect(200)).body.accessToken;
    W = (await http.get('/api/warehouses').set(as(owner)).expect(200)).body[0].id;
    PAID = (await post(owner, '/api/products', { sku: 'KG-1', name: 'Minuman', sellPrice: '8000', category: 'Lain-lain' }).expect(201)).body.id;
    FREE = (await post(owner, '/api/products', { sku: 'KG-2', name: 'Bahan tanpa harga', sellPrice: '0', category: 'Lain-lain' }).expect(201)).body.id;
    await post(owner, '/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: addDays(todayJakarta(), -1), lines: [{ productId: PAID, qty: '50', unitCost: '4000' }, { productId: FREE, qty: '500', unitCost: '100' }] }).expect(201);
    sessionId = (await post(cashier, '/api/pos/sessions', { warehouseId: W, openingCash: '100000' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('kasir tidak bisa menyertakan barang tanpa harga jual; stok tidak berkurang', async () => {
    const r = await post(cashier, '/api/pos/orders', { sessionId, lines: [{ productId: PAID, qty: '1' }, { productId: FREE, qty: '200' }], payments: [{ method: 'CASH', amount: '10000' }] });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('belum diisi');
    expect(await stockOf(FREE)).toBe(500);
    expect(await stockOf(PAID)).toBe(50);
  });

  it('penjualan normal tetap berjalan', async () => {
    await post(cashier, '/api/pos/orders', { sessionId, lines: [{ productId: PAID, qty: '2' }], payments: [{ method: 'CASH', amount: '16000' }] }).expect(201);
    expect(await stockOf(PAID)).toBe(48);
  });
  it('tutup kasir buta: Kasir tidak melihat tunai seharusnya; selisih tetap dihitung server', async () => {
    const put = (u: string, b: object) => http.put(u).set(as(owner)).send(b);
    const cur = async (t: string) => (await http.get('/api/pos/sessions/current').set(as(t)).expect(200)).body.summary as { expectedCash: string; byMethod: Record<string, string>; blind?: boolean };
    // kebijakan mati: Kasir melihat angka sebenarnya (modal 100.000 + penjualan tunai 16.000)
    expect((await cur(cashier)).expectedCash).toBe('116000.00');
    await put('/api/approvals/policy', { blindCashClose: true }).expect(200);
    const hidden = await cur(cashier);
    expect(hidden.blind).toBe(true);
    expect(hidden.expectedCash).toBe('0.00');
    expect(hidden.byMethod.CASH).toBe('0.00');
    // hitung 113.000 → kurang 3.000 terhadap yang seharusnya (116.000) walau angka itu tidak pernah ditampilkan
    const closed = (await post(cashier, `/api/pos/sessions/${sessionId}/close`, { countedCash: '113000' }).expect(201)).body;
    expect(closed.difference).toBe('-3000.00');
    expect(closed.journalNumber).toBeTruthy();
  });
  it('dashboard: penjualan bulan ini mengikuti pembukuan (penjualan kasir ikut, sama dengan Laba Rugi)', async () => {
    const dash = (await http.get('/api/dashboard').set(as(owner)).expect(200)).body;
    const pl = (await http.get('/api/accounting/reports/profit-loss').set(as(owner)).expect(200)).body;
    expect(Number(dash.salesMonth)).toBeGreaterThan(0); // seluruhnya dari kasir: tidak ada faktur
    expect(dash.invoicesMonth).toBe(0);
    expect(dash.posOrdersMonth).toBe(1);
    expect(dash.salesMonth).toBe(Number(pl.totalRevenue).toFixed(2));
    // laba kotor = penjualan − beban pokok (kelompok yang sama dengan laporan)
    const cost = (pl.expense as { code: string; balance: string }[]).filter((r) => r.code === '5-1000').reduce((a, r) => a + Number(r.balance), 0);
    expect(Number(dash.grossProfitMonth)).toBeCloseTo(Number(dash.salesMonth) - cost, 2);
  });
});
