/**
 * Kasir ↔ stok ↔ buku besar (e2e): retur/pembatalan penjualan kasir oleh supervisor (stok kembali, jurnal dibalik,
 * uang laci dikurangi), kasir tidak boleh mengubah harga/diskon atau membatalkan sendiri, pembatasan toko, temuan kontrol.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

describe('Kasir: retur, kontrol harga, pembatasan toko (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let cashier: string;
  let cashier2: string;
  let A: string;
  let B: string;
  let P: string;
  let sessionId: string;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const login = async (email: string, password: string) => (await http.post('/api/auth/login').send({ email, password }).expect(200)).body.accessToken as string;
  const qty = async () => Number((await get(owner, `/api/inventory/balances?productId=${P}&warehouseId=${A}`).expect(200)).body[0].qty);
  const bal = async (code: string) => {
    const tb = (await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body;
    expect(tb.balanced).toBe(true);
    return Number(tb.rows.find((x: { code: string }) => x.code === code)?.balance ?? 0);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Toko Retur', name: 'Pemilik', email: `kr-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await post(owner, '/api/apps/pos/install').expect(201);
    A = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    B = (await post(owner, '/api/warehouses', { code: 'TK-B', name: 'Toko B' }).expect(201)).body.id;
    P = (await post(owner, '/api/products', { sku: 'KR-1', name: 'Barang Kasir', sellPrice: '10000' }).expect(201)).body.id;
    await post(owner, '/api/inventory/adjustments', { warehouseId: A, reason: 'OPENING', date: todayJakarta(), lines: [{ productId: P, qty: '20', unitCost: '6000' }] }).expect(201);
    await post(owner, '/api/users', { name: 'Kasir A', email: `kr-k1-${stamp}@uji.id`, password: 'kasir12345', role: 'CASHIER' }).expect(201);
    await post(owner, '/api/users', { name: 'Kasir B', email: `kr-k2-${stamp}@uji.id`, password: 'kasir12345', role: 'CASHIER', warehouseIds: [B] }).expect(201);
    cashier = await login(`kr-k1-${stamp}@uji.id`, 'kasir12345');
    cashier2 = await login(`kr-k2-${stamp}@uji.id`, 'kasir12345');
  });
  afterAll(() => app.close());

  it('kasir yang dibatasi ke toko B tidak bisa membuka sesi di toko A', async () => {
    await post(cashier2, '/api/pos/sessions', { warehouseId: A, openingCash: '100000' }).expect(403);
  });

  let orderId: string;
  let orderTotal: number;
  let lineId: string;

  it('kasir menjual dengan harga master; ubah harga atau beri diskon ditolak', async () => {
    sessionId = (await post(cashier, '/api/pos/sessions', { warehouseId: A, openingCash: '100000' }).expect(201)).body.id;
    const bad = { sessionId, lines: [{ productId: P, qty: '1', price: '1000' }], payments: [{ method: 'CASH', amount: '100000' }] };
    await post(cashier, '/api/pos/orders', bad).expect(403);
    await post(cashier, '/api/pos/orders', { ...bad, lines: [{ productId: P, qty: '1', price: '10000', discountPct: '10' }] }).expect(403);
    const o = (await post(cashier, '/api/pos/orders', { sessionId, lines: [{ productId: P, qty: '5', price: '10000' }], payments: [{ method: 'CASH', amount: '100000' }] }).expect(201)).body;
    orderId = o.id;
    orderTotal = Number(o.total);
    lineId = o.lines[0].id;
    expect(await qty()).toBe(15);
  });

  it('kasir tidak bisa membatalkan penjualannya sendiri; supervisor retur sebagian lalu sisanya', async () => {
    await post(cashier, `/api/pos/orders/${orderId}/return`, { all: true, reason: 'pelanggan batal' }).expect(403);
    const sales0 = await bal('4-1000');
    const inv0 = await bal('1-1400');

    await post(owner, `/api/pos/orders/${orderId}/return`, { all: true, reason: 'x' }).expect(400); // alasan terlalu pendek
    const r1 = (await post(owner, `/api/pos/orders/${orderId}/return`, { lines: [{ orderLineId: lineId, qty: '2' }], reason: 'barang cacat' }).expect(201)).body;
    expect(await qty()).toBe(17);
    expect(r1.refundMethod).toBe('CASH');
    expect(Number(r1.total)).toBeCloseTo((orderTotal * 2) / 5, 0);
    expect(await bal('1-1400')).toBe(inv0 + 2 * 6000); // persediaan kembali pada HPP asal

    // retur melebihi sisa ditolak
    await post(owner, `/api/pos/orders/${orderId}/return`, { lines: [{ orderLineId: lineId, qty: '4' }], reason: 'kelebihan' }).expect(400);
    const r2 = (await post(owner, `/api/pos/orders/${orderId}/return`, { all: true, reason: 'sisanya dibatalkan' }).expect(201)).body;
    // jumlah dua retur = total penjualan persis
    expect(Number(r1.total) + Number(r2.total)).toBeCloseTo(orderTotal, 2);
    expect(await qty()).toBe(20);
    expect(await bal('1-1400')).toBe(inv0 + 5 * 6000);
    // pendapatan bersih kembali seperti sebelum penjualan dibatalkan semua
    expect(await bal('4-1000')).toBe(sales0);
    await post(owner, `/api/pos/orders/${orderId}/return`, { all: true, reason: 'sudah habis diretur' }).expect(400);
  });

  it('tutup kasir: uang laci seharusnya sudah dikurangi retur tunai', async () => {
    const cur = (await get(cashier, '/api/pos/sessions/current').expect(200)).body;
    expect(Number(cur.summary.cashRefunds)).toBeCloseTo(orderTotal, 2);
    expect(Number(cur.summary.expectedCash)).toBeCloseTo(100000, 2); // modal awal + tunai − retur
    const closed = (await post(cashier, `/api/pos/sessions/${sessionId}/close`, { countedCash: '100000' }).expect(201)).body;
    expect(Number(closed.difference)).toBe(0);
  });

  it('temuan kontrol kasir memuat retur', async () => {
    await get(cashier, '/api/pos/controls').expect(403);
    const r = (await get(owner, '/api/pos/controls').expect(200)).body as { items: { key: string }[] };
    expect(r.items.map((i) => i.key)).toContain('POS_RETURNS');
  });
});
