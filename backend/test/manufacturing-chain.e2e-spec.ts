/**
 * Manufaktur: perintah produksi berjenjang dari rencana (induk + anak untuk barang setengah jadi) dan akun
 * "Persediaan Barang Setengah Jadi" yang nilainya selalu sama dengan kartu stok barang setengah jadi.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Manufaktur: perintah berjenjang & persediaan setengah jadi (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let t: string;
  let wh: string;
  let sup: string;
  let bomAdonan: string;
  let bomRoti: string;
  const stamp = Date.now();
  const as = (tok = t) => ({ Authorization: `Bearer ${tok}` });
  const get = (u: string, tok = t) => http.get(u).set(as(tok));
  const post = (u: string, b: object = {}, tok = t) => http.post(u).set(as(tok)).send(b);
  const prod: Record<string, string> = {};
  const bal = async (code: string) => {
    const tb = (await get('/api/accounting/reports/trial-balance').expect(200)).body;
    expect(tb.balanced).toBe(true);
    return Number(tb.rows.find((x: { code: string }) => x.code === code)?.balance ?? 0);
  };
  const stock = async (id: string, w = wh) => (await get(`/api/inventory/balances?productId=${id}`).expect(200)).body.find((b: { warehouseId: string }) => b.warehouseId === w) as { qty: string; avgCost: string } | undefined;
  const health = async (key: string) => ((await get('/api/accounting/health').expect(200)).body.checks as { key: string; status: string }[]).find((c) => c.key === key);
  const buy = async (sku: string, qty: string, price: string) => {
    const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: wh, lines: [{ productId: prod[sku], qty, price }] }).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    await post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: `${sku}-${stamp}` }).expect(201);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    t = (await http.post('/api/auth/register').send({ companyName: 'Pabrik Roti', name: 'Pemilik', email: `mc-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'MANUFAKTUR' }).expect(201)).body.accessToken;
    wh = (await get('/api/warehouses').expect(200)).body[0].id;
    sup = (await post('/api/suppliers', { code: 'S1', name: 'PT Bahan' }).expect(201)).body.id;
    for (const s of ['TEPUNG', 'GULA', 'KEMASAN', 'ROTI']) prod[s] = (await post('/api/products', { sku: s, name: s, sellPrice: '1000' }).expect(201)).body.id;
    prod.ADONAN = (await post('/api/products', { sku: 'ADONAN', name: 'Adonan', sellPrice: '0', inventoryKind: 'SEMI' }).expect(201)).body.id;
    await buy('TEPUNG', '100', '1000');
    await buy('GULA', '100', '2000');
    await buy('KEMASAN', '100', '500');
    bomAdonan = (await post('/api/production/boms', { name: 'Adonan', productId: prod.ADONAN, outputQty: '10', laborCost: '20000', overheadCost: '10000', lines: [{ productId: prod.TEPUNG, qty: '2' }, { productId: prod.GULA, qty: '1' }] }).expect(201)).body.id;
    bomRoti = (await post('/api/production/boms', { name: 'Roti', productId: prod.ROTI, outputQty: '8', laborCost: '30000', overheadCost: '15000', lines: [{ productId: prod.ADONAN, qty: '4' }, { productId: prod.KEMASAN, qty: '1' }] }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('jenis barang: setengah jadi hanya untuk Produksi/Manufaktur, tidak dijual/dibeli, jenis tak berubah setelah ada mutasi', async () => {
    const dagang = (await http.post('/api/auth/register').send({ companyName: 'Toko', name: 'P', email: `mc-d-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken as string;
    expect((await post('/api/products', { sku: 'X', name: 'X', sellPrice: '1', inventoryKind: 'SEMI' }, dagang)).status).toBe(400);
    const wh2 = (await get('/api/warehouses').expect(200)).body[0].id;
    const so = await post('/api/sales-orders', { customerId: (await post('/api/customers', { code: 'C', name: 'Pelanggan' }).expect(201)).body.id, warehouseId: wh2, lines: [{ productId: prod.ADONAN, qty: '1' }] });
    expect(so.status).toBe(400);
    expect(so.body.message).toContain('barang setengah jadi');
    const po = await post('/api/purchase-orders', { supplierId: sup, warehouseId: wh, lines: [{ productId: prod.ADONAN, qty: '1', price: '1000' }] });
    expect(po.status).toBe(400);
    // jenis barang yang sudah bergerak tidak boleh berubah
    expect((await http.patch(`/api/products/${prod.TEPUNG}`).set(as()).send({ inventoryKind: 'SEMI' })).status).toBe(400);
    const fresh = (await post('/api/products', { sku: 'BARU', name: 'Baru', sellPrice: '1' }).expect(201)).body.id;
    await http.patch(`/api/products/${fresh}`).set(as()).send({ inventoryKind: 'SEMI' }).expect(200);
    expect((await get('/api/products').expect(200)).body.find((p: { id: string }) => p.id === prod.ADONAN).inventoryKind).toBe('SEMI');
  });

  it('rencana berjenjang: induk dan anak dibuat bersama; induk tidak bisa mulai sebelum anaknya selesai', async () => {
    const plan = (await post('/api/production/plan', { warehouseId: wh, items: [{ bomId: bomRoti, batches: '3' }] }).expect(201)).body;
    expect(plan.planNo).toMatch(/^MRP/);
    expect(plan.orders).toHaveLength(2); // 3 batch roti butuh 12 adonan → 2 batch adonan (20)
    const parent = plan.orders.find((o: { level: number }) => o.level === 0);
    const child = plan.orders.find((o: { level: number }) => o.level === 1);
    expect(child).toMatchObject({ bom: 'BOM-ADONAN', batches: '2', parent: parent.number });
    const list = (await get('/api/production/orders').expect(200)).body as { id: string; parentNumber: string | null; childCount: number; planNo: string | null; status: string }[];
    expect(list.find((o) => o.id === parent.id)).toMatchObject({ childCount: 1, parentNumber: null, planNo: plan.planNo, status: 'DRAFT' });
    expect(list.find((o) => o.id === child.id)).toMatchObject({ parentNumber: parent.number, childCount: 0, planNo: plan.planNo });

    const early = await post(`/api/production/orders/${parent.id}/start`);
    expect(early.status).toBe(400);
    expect(early.body.message).toContain(child.number);

    // anak: bahan baku → barang setengah jadi (akun tersendiri)
    const gl1400 = await bal('1-1400');
    await post(`/api/production/orders/${child.id}/start`).expect(201); // 4 tepung × 1.000 + 2 gula × 2.000 = 8.000
    expect(gl1400 - (await bal('1-1400'))).toBe(8000);
    expect(await bal('1-1420')).toBe(8000);
    await post(`/api/production/orders/${child.id}/complete`, { outputQty: '20' }).expect(201); // + upah 40.000 + overhead 20.000
    expect(await bal('1-1430')).toBe(68000);
    expect(await bal('1-1420')).toBe(0);
    const ad = await stock(prod.ADONAN);
    expect(Number(ad!.qty)).toBe(20);
    expect(Number(ad!.avgCost)).toBe(3400);
    expect((await health('inventory'))?.status).toBe('OK');
    expect((await health('inventory-semi'))?.status).toBe('OK');

    // induk: setengah jadi + kemasan → roti
    await post(`/api/production/orders/${parent.id}/start`).expect(201); // 12 × 3.400 + 3 × 500
    expect(await bal('1-1430')).toBe(68000 - 40800);
    expect(await bal('1-1420')).toBe(40800 + 1500);
    await post(`/api/production/orders/${parent.id}/complete`, { outputQty: '24' }).expect(201);
    expect(await bal('1-1420')).toBe(0);
    expect(await bal('1-1430')).toBe(27200); // sisa 8 adonan × 3.400
    expect(Number((await stock(prod.ADONAN))!.qty)).toBe(8);
    expect(Number((await stock(prod.ROTI))!.qty)).toBe(24);
    expect((await health('inventory-semi'))?.status).toBe('OK');
  });

  it('penyesuaian stok, transfer antar gudang, dan batal produksi mengikuti akun barang setengah jadi', async () => {
    const before = await bal('1-1430');
    // rusak 2 adonan @3.400
    await post('/api/inventory/adjustments', { warehouseId: wh, reason: 'DAMAGED', lines: [{ productId: prod.ADONAN, qty: '-2' }] }).expect(201);
    expect(await bal('1-1430')).toBe(before - 6800);
    // transfer dalam perjalanan 3 adonan ke gudang lain: keluar dari akun setengah jadi, masuk akun transit, lalu kembali
    const wh2 = (await post('/api/warehouses', { code: 'GDG-02', name: 'Gudang Dua' }).expect(201)).body.id;
    const tr = (await post('/api/inventory/transfers', { mode: 'IN_TRANSIT', fromWarehouseId: wh, toWarehouseId: wh2, lines: [{ productId: prod.ADONAN, qty: '3' }] }).expect(201)).body;
    expect(await bal('1-1430')).toBe(before - 6800 - 10200);
    expect(await bal('1-1410')).toBe(10200);
    await post(`/api/inventory/transfers/${tr.id}/receive`, {}).expect(201);
    expect(await bal('1-1410')).toBe(0);
    expect(await bal('1-1430')).toBe(before - 6800);
    expect(await bal('1-1400')).toBeGreaterThan(0);
    expect((await health('inventory-semi'))?.status).toBe('OK');
    expect((await health('inventory'))?.status).toBe('OK');
    // batal produksi yang sedang berjalan mengembalikan bahan ke akun semula (induk memakai adonan = akun setengah jadi)
    const plan = (await post('/api/production/plan', { warehouseId: wh, items: [{ bomId: bomRoti, batches: '0.5' }] }).expect(201)).body;
    expect(plan.orders).toHaveLength(1); // 2 adonan dibutuhkan, 3 ada di stok → tanpa perintah anak
    const o = plan.orders[0];
    const semi0 = await bal('1-1430');
    await post(`/api/production/orders/${o.id}/start`).expect(201);
    expect(await bal('1-1430')).toBe(semi0 - 2 * 3400);
    await post(`/api/production/orders/${o.id}/cancel`).expect(201);
    expect(await bal('1-1430')).toBe(semi0);
    expect((await health('inventory-semi'))?.status).toBe('OK');
  });

  it('validasi rencana: tanpa kebutuhan anak, kedalaman, batch tak sah, dan hanya Manufaktur', async () => {
    expect((await post('/api/production/plan', { warehouseId: wh, items: [{ bomId: bomRoti, batches: '0' }] })).status).toBe(400);
    expect((await post('/api/production/plan', { warehouseId: wh, items: [] })).status).toBe(400);
    expect((await post('/api/production/plan', { warehouseId: '00000000-0000-4000-8000-000000000000', items: [{ bomId: bomRoti, batches: '1' }] })).status).toBe(400);
    const produksi = (await http.post('/api/auth/register').send({ companyName: 'Produksi', name: 'P', email: `mc-p-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'PRODUKSI' }).expect(201)).body.accessToken as string;
    const w = (await get('/api/warehouses', produksi).expect(200)).body[0].id;
    expect((await post('/api/production/plan', { warehouseId: w, items: [{ bomId: bomRoti, batches: '1' }] }, produksi)).status).toBe(403);
  });
});
