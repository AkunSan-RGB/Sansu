/**
 * Gudang (e2e): transfer antar gudang (HPP ikut pindah, tanpa jurnal), stock opname (selisih → penyesuaian & jurnal),
 * stok minimum & peringatan, rekap semua gudang, gudang nonaktif, dan pembatasan pengguna per gudang.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Operasi gudang (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let A: string; // gudang utama
  let B: string; // gudang cabang
  let P1: string;
  let P2: string;
  const stamp = Date.now();
  const as = (t = token) => ({ Authorization: `Bearer ${t}` });
  const bal = async (w: string, p: string) => {
    const r = await http.get('/api/inventory/balances').query({ warehouseId: w, productId: p }).set(as()).expect(200);
    return r.body[0] ? { qty: Number(r.body[0].qty), avg: Number(r.body[0].avgCost) } : { qty: 0, avg: 0 };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (await http.post('/api/auth/register').send({ companyName: 'PT Gudang Banyak', name: 'Pemilik', email: `gdg-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    A = (await http.get('/api/warehouses').set(as())).body[0].id;
    B = (await http.post('/api/warehouses').set(as()).send({ code: 'GDG-CB', name: 'Gudang Cabang' }).expect(201)).body.id;
    P1 = (await http.post('/api/products').set(as()).send({ sku: 'MIE-1', name: 'Mie', sellPrice: '3500', category: 'Makanan' }).expect(201)).body.id;
    P2 = (await http.post('/api/products').set(as()).send({ sku: 'GULA-1', name: 'Gula', sellPrice: '18000', category: 'Sembako' }).expect(201)).body.id;
    await http
      .post('/api/inventory/adjustments')
      .set(as())
      .send({ warehouseId: A, reason: 'OPENING', date: '2025-12-31', lines: [{ productId: P1, qty: '100', unitCost: '2500' }, { productId: P2, qty: '50', unitCost: '15000' }] })
      .expect(201);
    await http.post('/api/inventory/adjustments').set(as()).send({ warehouseId: B, reason: 'OPENING', date: '2025-12-31', lines: [{ productId: P1, qty: '10', unitCost: '3100' }] }).expect(201);
  });
  afterAll(() => app.close());

  it('transfer: stok pindah dengan HPP gudang asal, tidak bisa melebihi stok', async () => {
    const t = await http.post('/api/inventory/transfers').set(as()).send({ fromWarehouseId: A, toWarehouseId: B, date: '2026-02-01', lines: [{ productId: P1, qty: '30' }, { productId: P1, qty: '10' }, { productId: P2, qty: '5' }] }).expect(201);
    expect(t.body.number).toMatch(/^MG\//);
    expect(Number(t.body.totalValue)).toBe(40 * 2500 + 5 * 15000);
    expect(await bal(A, P1)).toMatchObject({ qty: 60, avg: 2500 });
    // B: 10 @3100 + 40 @2500 → rata-rata 2620
    expect(await bal(B, P1)).toMatchObject({ qty: 50, avg: 2620 });
    const d = await http.get(`/api/inventory/transfers/${t.body.id}`).set(as()).expect(200);
    expect(d.body.lines).toHaveLength(2);
    await http.post('/api/inventory/transfers').set(as()).send({ fromWarehouseId: A, toWarehouseId: B, lines: [{ productId: P2, qty: '999' }] }).expect(400);
    await http.post('/api/inventory/transfers').set(as()).send({ fromWarehouseId: A, toWarehouseId: A, lines: [{ productId: P2, qty: '1' }] }).expect(400);
  });

  it('stock opname: selisih dibukukan terhadap stok saat posting', async () => {
    const c = await http.post('/api/inventory/counts').set(as()).send({ warehouseId: A, date: '2026-02-10' }).expect(201);
    expect(c.body.number).toMatch(/^OPN\//);
    await http.post('/api/inventory/counts').set(as()).send({ warehouseId: A }).expect(400); // masih ada draft
    const sheet = (await http.get(`/api/inventory/counts/${c.body.id}`).set(as()).expect(200)).body;
    expect(sheet.lines.find((l: { productId: string }) => l.productId === P1).systemQty).toBe('60.0000');
    await http.put(`/api/inventory/counts/${c.body.id}`).set(as()).send({ lines: [{ productId: P1, countedQty: '57' }, { productId: P2, countedQty: '46' }] }).expect(200);
    const r = await http.post(`/api/inventory/counts/${c.body.id}/post`).set(as()).expect(201);
    expect(r.body).toMatchObject({ counted: 2, adjusted: 2 });
    expect(r.body.adjustmentNumber).toMatch(/^ADJ\//);
    // Mie 60 → 57 (kurang 3), Gula 45 → 46 (lebih 1, dinilai HPP rata-rata)
    expect(Number(r.body.valueOut)).toBe(3 * 2500);
    expect(Number(r.body.valueIn)).toBe(1 * 15000);
    expect((await bal(A, P1)).qty).toBe(57);
    expect((await bal(A, P2)).qty).toBe(46);
    await http.put(`/api/inventory/counts/${c.body.id}`).set(as()).send({ lines: [] }).expect(400);
  });

  it('stok minimum & peringatan stok menipis', async () => {
    await http.put('/api/inventory/minimums').set(as()).send({ warehouseId: B, items: [{ productId: P1, minQty: '80' }, { productId: P2, minQty: '2' }] }).expect(200);
    const low = (await http.get('/api/inventory/low-stock').set(as()).expect(200)).body;
    expect(low).toHaveLength(1);
    expect(low[0]).toMatchObject({ sku: 'MIE-1', warehouseCode: 'GDG-CB', shortage: '30.0000' });
    const att = (await http.get('/api/dashboard/attention').set(as()).expect(200)).body;
    expect(att.items.some((i: { key: string }) => i.key === 'low-stock')).toBe(true);
    await http.put('/api/inventory/minimums').set(as()).send({ warehouseId: B, items: [{ productId: P1, minQty: null }] }).expect(200);
    expect((await http.get('/api/inventory/low-stock').set(as())).body).toHaveLength(0);
  });

  it('rekap stok semua gudang', async () => {
    const m = (await http.get('/api/inventory/matrix').set(as()).expect(200)).body;
    expect(m.warehouses).toHaveLength(2);
    const mie = m.rows.find((r: { sku: string }) => r.sku === 'MIE-1');
    expect(mie.qty[A]).toBe('57.0000');
    expect(mie.qty[B]).toBe('50.0000');
    expect(mie.totalQty).toBe('107.0000');
    expect(Number(mie.value)).toBeCloseTo(57 * 2500 + 50 * 2620, 2);
  });

  it('gudang nonaktif tidak bisa menerima barang', async () => {
    const C = (await http.post('/api/warehouses').set(as()).send({ code: 'GDG-X', name: 'Gudang Lama' }).expect(201)).body.id;
    await http.patch(`/api/warehouses/${C}`).set(as()).send({ isActive: false }).expect(200);
    const r = await http.post('/api/inventory/transfers').set(as()).send({ fromWarehouseId: A, toWarehouseId: C, lines: [{ productId: P1, qty: '1' }] }).expect(400);
    expect(r.body.message).toContain('nonaktif');
    await http.post('/api/inventory/adjustments').set(as()).send({ warehouseId: C, reason: 'OTHER', lines: [{ productId: P1, qty: '1', unitCost: '1' }] }).expect(400);
  });

  it('pengguna dibatasi ke satu gudang', async () => {
    const u = await http.post('/api/users').set(as()).send({ name: 'Staf Cabang', email: `cabang-${stamp}@uji.id`, password: 'rahasia123', role: 'WAREHOUSE', warehouseIds: [B] }).expect(201);
    expect(u.body).toBeDefined();
    const t = (await http.post('/api/auth/login').send({ email: `cabang-${stamp}@uji.id`, password: 'rahasia123' }).expect(200)).body.accessToken;
    expect((await http.get('/api/auth/me').set(as(t))).body.warehouseIds).toEqual([B]);
    const whs = (await http.get('/api/warehouses').set(as(t)).expect(200)).body;
    expect(whs.map((w: { id: string }) => w.id)).toEqual([B]);
    const balances = (await http.get('/api/inventory/balances').set(as(t)).expect(200)).body;
    expect(balances.every((b: { warehouseId: string }) => b.warehouseId === B)).toBe(true);
    await http.get('/api/inventory/balances').query({ warehouseId: A }).set(as(t)).expect(403);
    await http.post('/api/inventory/adjustments').set(as(t)).send({ warehouseId: A, reason: 'DAMAGED', lines: [{ productId: P1, qty: '-1' }] }).expect(403);
    await http.post('/api/inventory/transfers').set(as(t)).send({ fromWarehouseId: A, toWarehouseId: B, lines: [{ productId: P1, qty: '1' }] }).expect(403);
    // boleh mengirim dari gudangnya ke gudang lain
    await http.post('/api/inventory/transfers').set(as(t)).send({ fromWarehouseId: B, toWarehouseId: A, lines: [{ productId: P1, qty: '2' }] }).expect(201);
    await http.post('/api/inventory/counts').set(as(t)).send({ warehouseId: A }).expect(403);
    const m = (await http.get('/api/inventory/matrix').set(as(t)).expect(200)).body;
    expect(m.warehouses.map((w: { id: string }) => w.id)).toEqual([B]);
  });
});
