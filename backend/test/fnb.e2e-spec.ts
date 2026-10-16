/**
 * Jenis usaha F&B (e2e): panduan mulai, menu yang memakai barang setengah jadi (adonan) sebagai bahan, penjualan kasir
 * memotong bahan per jenis akun persediaan, menu tidak dijual lewat faktur, pembukuan tetap seimbang.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

describe('Jenis usaha F&B (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let W: string;
  const ids: Record<string, string> = {};
  const stamp = Date.now();
  const as = () => ({ Authorization: `Bearer ${owner}` });
  const get = (u: string) => http.get(u).set(as());
  const post = (u: string, b: object = {}) => http.post(u).set(as()).send(b);
  const qty = async (sku: string) => Number((await get(`/api/inventory/balances?productId=${ids[sku]}&warehouseId=${W}`).expect(200)).body[0]?.qty ?? 0);
  const bal = async (code: string) => {
    const tb = (await get('/api/accounting/reports/trial-balance').expect(200)).body;
    expect(tb.balanced).toBe(true);
    return Number(tb.rows.find((x: { code: string }) => x.code === code)?.balance ?? 0);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kafe Uji', name: 'Pemilik', email: `fnb-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FNB' }).expect(201)).body.accessToken;
    W = (await get('/api/warehouses').expect(200)).body[0].id;
    await post('/api/apps/sales/install').expect(201); // pesanan kantor/katering lewat faktur
  });
  afterAll(() => app.close());

  it('jenis usaha F&B: aplikasi bawaan, istilah, dan akun khusus', async () => {
    const me = (await get('/api/auth/me').expect(200)).body;
    expect(me.businessModel).toBe('FNB');
    expect(me.apps).toEqual(expect.arrayContaining(['pos', 'purchase', 'inventory', 'accounting', 'cash']));
    const accs = (await get('/api/accounting/accounts').expect(200)).body as { code: string; isActive: boolean }[];
    for (const code of ['5-1350', '5-1450', '6-2460', '1-1430']) expect(accs.find((a) => a.code === code)?.isActive).toBe(true);
  });

  it('barang setengah jadi boleh dipakai di F&B; bahan, adonan, dan menu dibuat', async () => {
    const mk = async (sku: string, body: object) => (ids[sku] = (await post('/api/products', { sku, sellPrice: '0', ...body }).expect(201)).body.id);
    await mk('BB-TEPUNG', { name: 'Tepung', baseUom: 'GRAM' });
    await mk('BB-GULA', { name: 'Gula', baseUom: 'GRAM' });
    await mk('BB-MINYAK', { name: 'Minyak', baseUom: 'ML' });
    await mk('SF-ADONAN', { name: 'Adonan Donat', baseUom: 'PCS', inventoryKind: 'SEMI' });
    await mk('MN-DONAT', { name: 'Donat Gula', baseUom: 'PCS', sellPrice: '9000', madeToOrder: true });
    await post('/api/inventory/adjustments', {
      warehouseId: W,
      reason: 'OPENING',
      date: todayJakarta(),
      lines: [
        { productId: ids['BB-TEPUNG'], qty: '10000', unitCost: '13' },
        { productId: ids['BB-GULA'], qty: '5000', unitCost: '16' },
        { productId: ids['BB-MINYAK'], qty: '5000', unitCost: '17' },
      ],
    }).expect(201);
    const adonanBom = (await post('/api/production/boms', { name: 'Adonan (batch 50)', productId: ids['SF-ADONAN'], outputQty: '50', laborCost: '0', overheadCost: '0', lines: [{ productId: ids['BB-TEPUNG'], qty: '4000' }, { productId: ids['BB-GULA'], qty: '500' }] }).expect(201)).body;
    await post('/api/production/boms', { name: 'Resep Donat', productId: ids['MN-DONAT'], outputQty: '1', laborCost: '0', overheadCost: '0', lines: [{ productId: ids['SF-ADONAN'], qty: '1' }, { productId: ids['BB-GULA'], qty: '10' }, { productId: ids['BB-MINYAK'], qty: '40' }] }).expect(201);
    const o = (await post('/api/production/orders', { bomId: adonanBom.id, warehouseId: W, batches: '2', date: todayJakarta() }).expect(201)).body;
    await post(`/api/production/orders/${o.id}/start`, { date: todayJakarta() }).expect(201);
    await post(`/api/production/orders/${o.id}/complete`, { date: todayJakarta(), outputQty: '100' }).expect(201);
    expect(await qty('SF-ADONAN')).toBe(100);
  });

  it('menu tidak bisa dijual lewat sales order; hanya lewat kasir', async () => {
    const cust = (await post('/api/customers', { code: 'C-1', name: 'Pelanggan' }).expect(201)).body.id;
    const r = await post('/api/sales-orders', { customerId: cust, warehouseId: W, date: todayJakarta(), lines: [{ productId: ids['MN-DONAT'], qty: '1' }] }).expect(400);
    expect(JSON.stringify(r.body)).toContain('Kasir');
  });

  it('kasir: adonan (setengah jadi) dan bahan lain terpotong, tiap jenis persediaan pada akunnya; pembukuan seimbang', async () => {
    const semi0 = await bal('1-1430');
    const inv0 = await bal('1-1400');
    const cogs0 = await bal('5-1000');
    const sessionId = (await post('/api/pos/sessions', { warehouseId: W, openingCash: '100000' }).expect(201)).body.id;
    const o = (await post('/api/pos/orders', { sessionId, lines: [{ productId: ids['MN-DONAT'], qty: '10' }], payments: [{ method: 'CASH', amount: '200000' }] }).expect(201)).body;
    expect(await qty('SF-ADONAN')).toBe(90);
    expect(await qty('BB-GULA')).toBe(5000 - 500 * 2 - 100); // dua batch adonan + 10 donat × 10 g
    expect(await qty('BB-MINYAK')).toBe(5000 - 400);
    // adonan = (4000 × 13 + 500 × 16) / 50 = 1200 per buah; 10 buah = 12.000 di akun setengah jadi
    const semiDrop = semi0 - (await bal('1-1430'));
    expect(semiDrop).toBeCloseTo(12000, 2);
    // gula 100 g × biaya rata-rata + minyak 400 ml × 17 = sisanya di akun persediaan biasa
    const invDrop = inv0 - (await bal('1-1400'));
    expect(invDrop).toBeGreaterThan(0);
    expect(Number(o.cogsAmount)).toBeCloseTo(semiDrop + invDrop, 2);
    expect((await bal('5-1000')) - cogs0).toBeCloseTo(semiDrop + invDrop, 2);
  });

  it('panduan mulai: langkah resep dan penjualan ditandai selesai setelah menu terjual', async () => {
    const steps = (await get('/api/onboarding').expect(200)).body.steps as { key: string; done: boolean; link: string }[];
    const prod = steps.find((s) => s.key === 'production')!;
    expect(prod.done).toBe(true);
    expect(prod.link).toBe('/production/boms');
    expect(steps.find((s) => s.key === 'sale')!.link).toBe('/pos');
  });

  it('pemeriksaan kesehatan pembukuan tanpa galat setelah penjualan menu', async () => {
    const checks = (await get('/api/accounting/health').expect(200)).body.checks as { key: string; status: string }[];
    expect(checks.filter((c) => c.status === 'ERROR')).toEqual([]);
  });
});

describe('Umur simpan barang hasil produksi (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let W: string;
  const stamp = Date.now();
  const today = todayJakarta();
  const as = () => ({ Authorization: `Bearer ${owner}` });
  const get = (u: string) => http.get(u).set(as());
  const post = (u: string, b: object = {}) => http.post(u).set(as()).send(b);
  const patch = (u: string, b: object = {}) => http.patch(u).set(as()).send(b);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Roti Umur', name: 'Pemilik', email: `um-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FNB' }).expect(201)).body.accessToken;
    W = (await get('/api/warehouses').expect(200)).body[0].id;
  });
  afterAll(() => app.close());

  it('hasil produksi barang berumur simpan menjadi lot dengan tanggal kedaluwarsa; tanpa umur simpan tidak dilacak', async () => {
    const tepung = (await post('/api/products', { sku: 'T-1', name: 'Tepung', baseUom: 'GRAM', sellPrice: '0' }).expect(201)).body.id;
    const roti = (await post('/api/products', { sku: 'R-1', name: 'Roti Tawar', baseUom: 'PCS', sellPrice: '15000', shelfLifeDays: 3 }).expect(201)).body;
    expect(roti.shelfLifeDays).toBe(3);
    const kue = (await post('/api/products', { sku: 'K-1', name: 'Kue Kering', baseUom: 'PCS', sellPrice: '5000' }).expect(201)).body.id;
    await post('/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: today, lines: [{ productId: tepung, qty: '100000', unitCost: '13' }] }).expect(201);
    const run = async (productId: string, qty: string) => {
      const bom = (await post('/api/production/boms', { name: `Resep ${productId.slice(0, 4)}`, productId, outputQty: '10', laborCost: '0', overheadCost: '0', lines: [{ productId: tepung, qty: '1000' }] }).expect(201)).body;
      const o = (await post('/api/production/orders', { bomId: bom.id, warehouseId: W, batches: '1', date: today }).expect(201)).body;
      await post(`/api/production/orders/${o.id}/start`, { date: today }).expect(201);
      await post(`/api/production/orders/${o.id}/complete`, { date: today, outputQty: qty }).expect(201);
      return o.number as string;
    };
    const number = await run(roti.id, '10');
    await run(kue, '10');
    const lots = (await get('/api/inventory/lots').expect(200)).body.items as { productId: string; lotNo: string; expiryDate: string; qtyRemaining: string; status: string; daysLeft: number }[];
    const l = lots.filter((x) => x.productId === roti.id);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ lotNo: number, status: 'SOON', daysLeft: 3 });
    expect(Number(l[0].qtyRemaining)).toBe(10);
    expect(lots.some((x) => x.productId === kue)).toBe(false);
  });

  it('umur simpan bisa diubah dan dikosongkan; nilai tidak masuk akal ditolak', async () => {
    const p = (await post('/api/products', { sku: 'R-2', name: 'Donat', baseUom: 'PCS', sellPrice: '9000', shelfLifeDays: 2 }).expect(201)).body;
    expect((await patch(`/api/products/${p.id}`, { shelfLifeDays: 5 }).expect(200)).body.shelfLifeDays).toBe(5);
    expect((await patch(`/api/products/${p.id}`, { shelfLifeDays: null }).expect(200)).body.shelfLifeDays).toBeNull();
    await patch(`/api/products/${p.id}`, { shelfLifeDays: 0 }).expect(400);
    await patch(`/api/products/${p.id}`, { shelfLifeDays: 99999 }).expect(400);
    await patch(`/api/products/${p.id}`, { shelfLifeDays: 1.5 }).expect(400);
  });
});
