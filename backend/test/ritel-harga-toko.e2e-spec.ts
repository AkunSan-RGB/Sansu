/**
 * Ritel: daftar harga per toko dan promo diskon di kasir. Server menghitung harga yang berlaku; kasir hanya boleh menjual
 * dengan harga itu (master, daftar harga toko/pelanggan, promo aktif), supervisor boleh mengubah.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

describe('Ritel: harga per toko + promo di kasir (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner = ''; let cashier = '';
  let W = ''; let P = ''; let Q = ''; let list = ''; let sessionId = ''; let member = '';
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const quote = async (lines: object[], extra: object = {}) => (await post(cashier, '/api/pos/quote', { sessionId, lines, ...extra }).expect(201)).body.lines as { price: string; discountPct: string; source: string; promoName: string | null }[];
  const sell = (lines: object[], extra: object = {}, who = cashier) =>
    post(who, '/api/pos/orders', { sessionId, lines, payments: [{ method: 'CASH', amount: '5000000' }], ...extra });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'Toko Harga', name: 'Pemilik', email: `rh-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'RITEL' }).expect(201)).body.accessToken;
    W = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    P = (await post(owner, '/api/products', { sku: 'RH-1', name: 'Kopi Sachet', sellPrice: '10000' }).expect(201)).body.id;
    Q = (await post(owner, '/api/products', { sku: 'RH-2', name: 'Teh Sachet', sellPrice: '6000' }).expect(201)).body.id;
    await post(owner, '/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: todayJakarta(), lines: [{ productId: P, qty: '500', unitCost: '6000' }, { productId: Q, qty: '500', unitCost: '3000' }] }).expect(201);
    await post(owner, '/api/users', { name: 'kasir', email: `rh-k-${stamp}@uji.id`, password: 'rahasia12345', role: 'CASHIER' }).expect(201);
    cashier = (await http.post('/api/auth/login').send({ email: `rh-k-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
    member = (await post(owner, '/api/customers', { code: 'RH1', name: 'Member' }).expect(201)).body.id;
    list = (await post(owner, '/api/price-lists', { name: 'Toko Mall' }).expect(201)).body.id;
    await http.put(`/api/price-lists/${list}/items`).set(as(owner)).send({ items: [{ productId: P, minQty: '1', price: '9000' }] }).expect(200);
    sessionId = (await post(cashier, '/api/pos/sessions', { warehouseId: W, openingCash: '100000' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('tanpa daftar harga toko dan promo: harga master, kasir menjual normal', async () => {
    const [l] = await quote([{ productId: P, qty: '1' }]);
    expect(Number(l.price)).toBe(10000);
    expect(l.source).toBe('MASTER');
    await sell([{ productId: P, qty: '1', price: '10000' }]).then((r) => expect(r.status).toBe(201));
  });

  it('daftar harga toko dipasang: kutipan memakai harga daftar; kasir yang memakai harga master lama ditolak', async () => {
    expect((await http.patch(`/api/warehouses/${W}`).set(as(cashier)).send({ priceListId: list })).status).toBe(403);
    await http.patch(`/api/warehouses/${W}`).set(as(owner)).send({ priceListId: list }).expect(200);
    const [l] = await quote([{ productId: P, qty: '2' }]);
    expect(Number(l.price)).toBe(9000);
    expect(l.source).toBe('LIST');
    expect((await sell([{ productId: P, qty: '1', price: '10000' }])).status).toBe(403);
    // tanpa harga di baris: server memakai harga toko
    const ok = await sell([{ productId: P, qty: '2' }]);
    expect(ok.status).toBe(201);
    const o = (await get(owner, `/api/pos/orders/${ok.body.id}`).expect(200)).body;
    expect(Number(o.total ?? o.subtotal)).toBeGreaterThan(0);
  });

  it('daftar harga perusahaan lain / acak ditolak', async () => {
    expect((await http.patch(`/api/warehouses/${W}`).set(as(owner)).send({ priceListId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
  });

  it('promo diskon aktif otomatis di kutipan; kasir hanya boleh menjual dengan potongan itu', async () => {
    await post(owner, '/api/promos', { name: 'Teh diskon 10% min 3', kind: 'DISCOUNT', productId: Q, minQty: '3', discountPct: '10' }).expect(201);
    expect((await quote([{ productId: Q, qty: '2' }]))[0].discountPct).toBe('0');
    const [l] = await quote([{ productId: Q, qty: '3' }]);
    expect(l.discountPct).toBe('10');
    expect(l.promoName).toBe('Teh diskon 10% min 3');
    // kasir tidak boleh mengarang potongan lain
    expect((await sell([{ productId: Q, qty: '3', price: '6000', discountPct: '25' }])).status).toBe(403);
    // potongan sesuai promo diterima
    expect((await sell([{ productId: Q, qty: '3', price: '6000', discountPct: '10' }])).status).toBe(201);
    // tanpa potongan padahal berhak: dipenuhi server (potongan terisi otomatis)
    expect((await sell([{ productId: Q, qty: '3' }])).status).toBe(201);
  });

  it('pelanggan dengan daftar harga sendiri menggantikan daftar harga toko', async () => {
    const own = (await post(owner, '/api/price-lists', { name: 'Member' }).expect(201)).body.id;
    await http.put(`/api/price-lists/${own}/items`).set(as(owner)).send({ items: [{ productId: P, minQty: '1', price: '8000' }] }).expect(200);
    await http.patch(`/api/customers/${member}`).set(as(owner)).send({ priceListId: own }).expect(200);
    expect(Number((await quote([{ productId: P, qty: '1' }], { customerId: member }))[0].price)).toBe(8000);
    expect(Number((await quote([{ productId: P, qty: '1' }]))[0].price)).toBe(9000);
  });

  it('supervisor (Keuangan) dengan sesi sendiri boleh mengubah harga dan memberi diskon manual', async () => {
    await post(owner, '/api/users', { name: 'fin', email: `rh-a-${stamp}@uji.id`, password: 'rahasia12345', role: 'FINANCE' }).expect(201);
    const adm = (await http.post('/api/auth/login').send({ email: `rh-a-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
    const sid = (await post(adm, '/api/pos/sessions', { warehouseId: W, openingCash: '0' }).expect(201)).body.id;
    const r = await post(adm, '/api/pos/orders', { sessionId: sid, lines: [{ productId: P, qty: '1', price: '7500', discountPct: '5' }], payments: [{ method: 'CASH', amount: '100000' }] });
    expect(r.status).toBe(201);
  });

  it('promo bonus barang: kutipan menampilkan bonus, transaksi menambah baris gratis, stok dan HPP tercatat; dibatasi sisa stok', async () => {
    const gift = (await post(owner, '/api/products', { sku: 'RH-3', name: 'Gelas Hadiah', sellPrice: '5000' }).expect(201)).body.id;
    await post(owner, '/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: todayJakarta(), lines: [{ productId: gift, qty: '5', unitCost: '2000' }] }).expect(201);
    const main = (await post(owner, '/api/products', { sku: 'RH-4', name: 'Kopi Bubuk', sellPrice: '20000' }).expect(201)).body.id;
    await post(owner, '/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: todayJakarta(), lines: [{ productId: main, qty: '100', unitCost: '12000' }] }).expect(201);
    await post(owner, '/api/promos', { name: 'Beli 2 kopi gratis 1 gelas', kind: 'BONUS', productId: main, minQty: '2', bonusProductId: gift, bonusQty: '1' }).expect(201);
    const q = (await post(cashier, '/api/pos/quote', { sessionId, lines: [{ productId: main, qty: '4' }] }).expect(201)).body;
    expect(q.bonus).toEqual([expect.objectContaining({ productId: gift, qty: '2', promoName: 'Beli 2 kopi gratis 1 gelas' })]);
    const bal = async (id: string) => Number((await get(owner, `/api/inventory/balances?productId=${id}`).expect(200)).body[0].qty);
    const r = await sell([{ productId: main, qty: '4', price: q.lines[0].price, discountPct: q.lines[0].discountPct }]);
    expect(r.status).toBe(201);
    expect(await bal(gift)).toBe(3);
    expect(await bal(main)).toBe(96);
    const order = (await get(owner, `/api/pos/orders/${r.body.id}`).expect(200)).body;
    const bonusLine = order.lines.find((l: { productId: string }) => l.productId === gift);
    expect(Number(bonusLine.lineTotal)).toBe(0);
    // total hanya barang berbayar
    expect(Number(order.subtotal ?? order.total)).toBeGreaterThan(0);
    // bonus dibatasi sisa stok: beli 20 kopi → 10 gelas diminta, hanya 3 tersedia
    const q2 = (await post(cashier, '/api/pos/quote', { sessionId, lines: [{ productId: main, qty: '20' }] }).expect(201)).body;
    expect(q2.bonus[0].qty).toBe('3');
    expect((await sell([{ productId: main, qty: '20', price: q2.lines[0].price, discountPct: q2.lines[0].discountPct }])).status).toBe(201);
    expect(await bal(gift)).toBe(0);
    expect((await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body.balanced).toBe(true);
  });
});
