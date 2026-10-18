/**
 * Daftar belanja harian: kebutuhan di bawah stok minimum per pemasok, PO draf satu klik, dan peringatan lonjakan harga beli.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Daftar belanja harian (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  let owner: string; let buyer: string; let hr: string;
  let wh: string; let sup: string; let tepung: string; let gula: string;
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kafe Belanja', name: 'P', email: `db-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FNB' }).expect(201)).body.accessToken;
    const mk = async (role: string, n: string) => {
      await post('/api/users', { name: n, email: `db-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      return (await http.post('/api/auth/login').send({ email: `db-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    };
    buyer = await mk('PURCHASING', 'beli'); hr = await mk('HR', 'hr');
    wh = (await get('/api/warehouses').expect(200)).body[0].id;
    sup = (await post('/api/suppliers', { code: 'PSK', name: 'Pasar Segar' }).expect(201)).body.id;
    tepung = (await post('/api/products', { sku: 'TP', name: 'Tepung', baseUom: 'KG', sellPrice: '0' }).expect(201)).body.id;
    gula = (await post('/api/products', { sku: 'GL', name: 'Gula', baseUom: 'KG', sellPrice: '0' }).expect(201)).body.id;
    await http.put('/api/inventory/minimums').set(as(owner)).send({ warehouseId: wh, items: [{ productId: tepung, minQty: '20' }, { productId: gula, minQty: '10' }] }).expect(200);
  });
  afterAll(() => app.close());

  it('hanya peran pembelian/gudang/keuangan; HR ditolak', async () => {
    expect((await get('/api/shopping-list', hr)).status).toBe(403);
    expect((await get('/api/shopping-list', buyer)).status).toBe(200);
  });

  it('kebutuhan dikelompokkan per pemasok; harga beli terakhir dipakai; PO draf dibuat satu klik', async () => {
    // tepung pernah dibeli dari Pasar Segar; gula belum pernah (tanpa pemasok/harga)
    const old = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: wh, lines: [{ productId: tepung, qty: '5', price: '10000' }] }, buyer).expect(201)).body;
    await post(`/api/purchase-orders/${old.id}/confirm`, {}, buyer).expect(201);
    const list = (await get('/api/shopping-list', buyer).expect(200)).body as { groups: { supplierId: string | null; supplierName: string; lines: { sku: string; suggestedQty: number; lastPrice: number | null; estimate: number | null }[] }[] };
    const seg = list.groups.find((g) => g.supplierId === sup);
    const none = list.groups.find((g) => g.supplierId === null);
    expect(seg?.lines.map((l) => l.sku)).toContain('TP');
    expect(none?.lines.map((l) => l.sku)).toContain('GL');
    expect(none!.lines[0].lastPrice).toBeNull();
    const created = (await post('/api/shopping-list/draft-order', { supplierId: sup, warehouseId: wh }, buyer).expect(201)).body;
    expect(created.lines).toBeGreaterThanOrEqual(1);
    const po = (await get(`/api/purchase-orders/${created.id}`, buyer).expect(200)).body;
    expect(po.status).toBe('DRAFT');
    // pemasok tanpa kebutuhan ditolak
    const other = (await post('/api/suppliers', { code: 'KSG', name: 'Pemasok Kosong' }).expect(201)).body.id;
    expect((await post('/api/shopping-list/draft-order', { supplierId: other, warehouseId: wh }, buyer)).status).toBe(400);
  });

  it('lonjakan harga beli > 10% dari rata-rata sebelumnya ditandai', async () => {
    const sup2 = (await post('/api/suppliers', { code: 'LJ', name: 'Pemasok Lonjak' }).expect(201)).body.id;
    const mi = (await post('/api/products', { sku: 'MI', name: 'Minyak', baseUom: 'LITER', sellPrice: '0' }).expect(201)).body.id;
    const buy = (price: string, date: string) => post('/api/purchase-orders', { supplierId: sup2, warehouseId: wh, date, lines: [{ productId: mi, qty: '10', price }] }, buyer).expect(201);
    const day = (n: number) => new Date(Date.now() + 7 * 3600_000 - n * 86400000).toISOString().slice(0, 10);
    await buy('15000', day(40));
    await buy('15200', day(20));
    await buy('19000', day(1)); // naik ±25%
    const alerts = (await get('/api/shopping-list', buyer).expect(200)).body.priceAlerts as { sku: string; pct: number }[];
    const a = alerts.find((x) => x.sku === 'MI');
    expect(a).toBeTruthy();
    expect(a!.pct).toBeGreaterThan(20);
    expect(alerts.find((x) => x.sku === 'TP')).toBeUndefined();
  });
});
