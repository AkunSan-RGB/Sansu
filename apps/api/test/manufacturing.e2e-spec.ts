/**
 * Jenis usaha Manufaktur: pengaturan bawaan (aplikasi, akun, istilah laporan, panduan), perencanaan kebutuhan bahan dari resep
 * bertingkat, analisis selisih produksi, dan pembatasan fitur ke jenis usaha ini.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Jenis usaha Manufaktur (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let t: string;
  let produksi: string;
  let wh: string;
  let sup: string;
  const stamp = Date.now();
  const as = (tok: string) => ({ Authorization: `Bearer ${tok}` });
  const get = (u: string, tok = t) => http.get(u).set(as(tok));
  const post = (u: string, b: object = {}, tok = t) => http.post(u).set(as(tok)).send(b);
  const prod: Record<string, string> = {};
  const product = async (sku: string) => (prod[sku] = (await post('/api/products', { sku, name: `Produk ${sku}`, sellPrice: '1000' }).expect(201)).body.id);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    const reg = async (model: string) => (await http.post('/api/auth/register').send({ companyName: `Pabrik ${model}`, name: 'Pemilik', email: `mf-${model}-${stamp}@uji.id`, password: 'rahasia123', businessModel: model }).expect(201)).body.accessToken as string;
    t = await reg('MANUFAKTUR');
    produksi = await reg('PRODUKSI');
    wh = (await get('/api/warehouses').expect(200)).body[0].id;
    sup = (await post('/api/suppliers', { code: 'S1', name: 'PT Bahan Baku' }).expect(201)).body.id;
    for (const s of ['TEPUNG', 'GULA', 'ADONAN', 'ROTI', 'KEMASAN']) await product(s);
    // adonan (setengah jadi) = 2 tepung + 1 gula per batch → 10 adonan; roti = 4 adonan + 1 kemasan per batch → 8 roti
    await post('/api/production/boms', { name: 'Adonan', productId: prod.ADONAN, outputQty: '10', laborCost: '20000', overheadCost: '10000', lines: [{ productId: prod.TEPUNG, qty: '2' }, { productId: prod.GULA, qty: '1' }] }).expect(201);
    await post('/api/production/boms', { name: 'Roti', productId: prod.ROTI, outputQty: '8', laborCost: '30000', overheadCost: '15000', lines: [{ productId: prod.ADONAN, qty: '4' }, { productId: prod.KEMASAN, qty: '1' }] }).expect(201);
  });
  afterAll(() => app.close());

  it('pengaturan bawaan: aplikasi, akun pabrik, istilah laporan, dan langkah panduan', async () => {
    const m = (await get('/api/auth/me').expect(200)).body;
    expect(m.businessModel).toBe('MANUFAKTUR');
    expect(m.apps).toEqual(expect.arrayContaining(['sales', 'purchase', 'inventory', 'accounting', 'cash']));
    const accs = (await get('/api/accounting/accounts').expect(200)).body as { code: string; name: string; isActive: boolean }[];
    const by = (c: string) => accs.find((a) => a.code === c);
    expect(by('5-4950')).toMatchObject({ isActive: true });
    expect(by('5-4100')?.isActive).toBe(true); // upah langsung produksi
    expect(by('5-4500')?.isActive).toBe(true); // energi produksi
    expect(by('1-1400')?.name).toBe('Persediaan Bahan Baku & Barang Jadi');
    expect(by('1-1130')).toBeUndefined(); // piutang QRIS khusus ritel
    const accP = (await get('/api/accounting/accounts', produksi).expect(200)).body as { code: string }[];
    expect(accP.some((a) => a.code === '5-4950')).toBe(false); // akun maklon hanya Manufaktur
    const income = (await get('/api/accounting/statements/income').expect(200)).body;
    expect(JSON.stringify(income)).toContain('Beban pokok produksi dan penjualan');
    const steps = (await get('/api/onboarding').expect(200)).body.steps as { key: string; description: string }[];
    expect(steps.find((s) => s.key === 'production')?.description).toContain('bertingkat');
  });

  it('kebutuhan bahan: resep bertingkat diledakkan sampai bahan baku, stok barang setengah jadi dipakai dulu', async () => {
    // 3 batch roti → 12 adonan; stok adonan 4 → 8 adonan harus dibuat = 1 batch adonan (10) → 2 tepung + 1 gula
    const bomRoti = (await get('/api/production/boms').expect(200)).body.find((b: { name: string }) => b.name === 'Roti').id;
    // stok awal 4 adonan lewat PO + faktur (cukup untuk uji)
    const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: wh, lines: [{ productId: prod.ADONAN, qty: '4', price: '1000' }] }).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    await post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'ADN-1' }).expect(201);

    const r = (await post('/api/production/requirements', { warehouseId: wh, items: [{ bomId: bomRoti, batches: '3' }] }).expect(201)).body;
    const need = (sku: string) => r.materials.find((m: { sku: string }) => m.sku === sku);
    expect(r.subAssemblies).toHaveLength(1);
    expect(r.subAssemblies[0]).toMatchObject({ sku: 'ADONAN', needed: 12, fromStock: 4, toProduce: 10, batches: 1 });
    expect(need('KEMASAN')).toMatchObject({ required: 3, shortage: 3 });
    expect(need('TEPUNG')).toMatchObject({ required: 2, shortage: 2 });
    expect(need('GULA')).toMatchObject({ required: 1, shortage: 1 });
    expect(r.materials.find((m: { sku: string }) => m.sku === 'ADONAN')).toBeUndefined(); // bukan bahan baku
    expect(r.canProduce).toBe(false);
    expect(r.conversion).toEqual({ labor: '110000.00', overhead: '55000.00' }); // 3×30.000 + 1×20.000 ; 3×15.000 + 1×10.000

    // pesanan berjalan dan permintaan pembelian mengurangi kekurangan
    const po2 = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: wh, lines: [{ productId: prod.TEPUNG, qty: '2', price: '9000' }] }).expect(201)).body;
    await post(`/api/purchase-orders/${po2.id}/confirm`).expect(201);
    await post('/api/purchase-requests', { warehouseId: wh, submit: true, lines: [{ productId: prod.GULA, qty: '1', estPrice: '12000' }, { productId: prod.KEMASAN, qty: '1' }] }).expect(201);
    const r2 = (await post('/api/production/requirements', { warehouseId: wh, items: [{ bomId: bomRoti, batches: '3' }] }).expect(201)).body;
    const need2 = (sku: string) => r2.materials.find((m: { sku: string }) => m.sku === sku);
    expect(need2('TEPUNG')).toMatchObject({ onOrder: 2, shortage: 0, supplierName: 'PT Bahan Baku' });
    expect(need2('GULA')).toMatchObject({ requested: 1, shortage: 0 });
    expect(need2('KEMASAN')).toMatchObject({ requested: 1, shortage: 2 });
    expect(r2.shortageCount).toBe(1);
  });

  it('kebutuhan bahan: validasi, resep berputar ditolak, dan hanya untuk jenis usaha Manufaktur', async () => {
    const bomRoti = (await get('/api/production/boms').expect(200)).body.find((b: { name: string }) => b.name === 'Roti').id;
    expect((await post('/api/production/requirements', { warehouseId: wh, items: [] })).status).toBe(400);
    expect((await post('/api/production/requirements', { warehouseId: wh, items: [{ bomId: bomRoti, batches: '0' }] })).status).toBe(400);
    expect((await post('/api/production/requirements', { warehouseId: wh, items: [{ bomId: '00000000-0000-4000-8000-000000000000', batches: '1' }] })).status).toBe(400);
    expect((await post('/api/production/requirements', { warehouseId: '00000000-0000-4000-8000-000000000000', items: [{ bomId: bomRoti, batches: '1' }] })).status).toBe(400);
    // resep berputar: adonan memakai roti (A → B → A)
    await http.put(`/api/production/boms/${(await get('/api/production/boms').expect(200)).body.find((b: { name: string }) => b.name === 'Adonan').id}`).set(as(t)).send({ name: 'Adonan', productId: prod.ADONAN, outputQty: '10', lines: [{ productId: prod.ROTI, qty: '1' }] }).expect(200);
    const loop = await post('/api/production/requirements', { warehouseId: wh, items: [{ bomId: bomRoti, batches: '3' }] }); // stok adonan tidak cukup → resepnya diledakkan
    expect(loop.status).toBe(400);
    expect(loop.body.message).toContain('berputar');
    // jenis usaha Produksi (biasa) tidak punya fitur ini
    const w2 = (await get('/api/warehouses', produksi).expect(200)).body[0].id;
    const denied = await post('/api/production/requirements', { warehouseId: w2, items: [{ bomId: bomRoti, batches: '1' }] }, produksi);
    expect(denied.status).toBe(403);
    expect((await get('/api/production/variance', produksi)).status).toBe(403);
  });

  it('analisis selisih produksi: pemakaian bahan berlebih dan hasil rendah ditandai', async () => {
    const t2 = (await http.post('/api/auth/register').send({ companyName: 'Pabrik Selisih', name: 'Pemilik', email: `mf-var-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'MANUFAKTUR' }).expect(201)).body.accessToken as string;
    const w = (await get('/api/warehouses', t2).expect(200)).body[0].id;
    const s = (await post('/api/suppliers', { code: 'S', name: 'Pemasok' }, t2).expect(201)).body.id;
    const mk = async (sku: string) => (await post('/api/products', { sku, name: sku, sellPrice: '1000' }, t2).expect(201)).body.id as string;
    const [bahan, jadi] = [await mk('BAHAN'), await mk('JADI')];
    const po = (await post('/api/purchase-orders', { supplierId: s, warehouseId: w, lines: [{ productId: bahan, qty: '1000', price: '1000' }] }, t2).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`, {}, t2).expect(201);
    await post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'B-1' }, t2).expect(201);
    const bom = (await post('/api/production/boms', { name: 'Jadi', productId: jadi, outputQty: '10', laborCost: '100000', overheadCost: '50000', lines: [{ productId: bahan, qty: '20' }] }, t2).expect(201)).body;
    const run = async (batches: string, issued: string, out: string) => {
      const o = (await post('/api/production/orders', { bomId: bom.id, warehouseId: w, batches }, t2).expect(201)).body;
      await post(`/api/production/orders/${o.id}/start`, { lines: [{ productId: bahan, qty: issued }] }, t2).expect(201);
      return (await post(`/api/production/orders/${o.id}/complete`, { outputQty: out, laborCost: '210000' }, t2).expect(201)).body;
    };
    const normal = await run('2', '40', '20'); // sesuai standar
    const boros = await run('2', '48', '17'); // bahan +20%, hasil −15%
    const v = (await get('/api/production/variance', t2).expect(200)).body;
    expect(v.totals.orders).toBe(2);
    const rn = v.rows.find((r: { orderId: string }) => r.orderId === normal.id);
    const rb = v.rows.find((r: { orderId: string }) => r.orderId === boros.id);
    expect(rn.flags).toEqual([]);
    expect(rn.materialValue).toBe(0);
    expect(rb.flags).toEqual(expect.arrayContaining(['HIGH_USAGE', 'LOW_YIELD']));
    expect(rb.materials[0]).toMatchObject({ planned: 40, issued: 48, pct: 20, value: 8000 });
    expect(rb.yieldPct).toBe(15);
    expect(rb.laborVariance).toBe(10000); // upah dibebankan 210.000 vs standar 2 × 100.000
    expect(rb.overheadVariance).toBe(0);
    expect(v.byMaterial[0]).toMatchObject({ sku: 'BAHAN', planned: 80, issued: 88, value: 8000 });
    expect(v.totals.flagged).toBe(1);
    // toleransi lebih longgar menghapus penanda
    const loose = (await get('/api/production/variance?tolerancePct=25', t2).expect(200)).body;
    expect(loose.totals.flagged).toBe(0);
    expect((await get('/api/production/variance?tolerancePct=abc', t2)).status).toBe(400);
    expect((await get('/api/production/variance?from=bukan', t2)).status).toBe(400);
    await get('/api/production/variance', t2).expect(200);
  });

  it('alur produksi dasar tetap berjalan dan peran gudang tidak melihat analisis selisih', async () => {
    await post('/api/users', { name: 'Gudang', email: `mf-g-${stamp}@uji.id`, password: 'gudang12345', role: 'WAREHOUSE' }).expect(201);
    const g = (await http.post('/api/auth/login').send({ email: `mf-g-${stamp}@uji.id`, password: 'gudang12345' }).expect(200)).body.accessToken as string;
    expect((await get('/api/production/variance', g)).status).toBe(403);
    expect((await get('/api/production/boms', g)).status).toBe(200);
  });
});
