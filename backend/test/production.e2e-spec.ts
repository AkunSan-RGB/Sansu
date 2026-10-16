/**
 * Produksi (e2e): resep/BOM, perintah produksi (bahan → barang dalam proses → produk jadi), pembatalan,
 * upah langsung produksi dari penggajian, dan laporan harga pokok produksi.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Produksi: BOM, perintah produksi, HPP produksi (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let warehouseId: string;
  let kain: string;
  let benang: string;
  let kemeja: string;
  let bomId: string;
  let orderId: string;
  const stamp = Date.now();
  const as = () => ({ Authorization: `Bearer ${token}` });
  const get = (url: string) => http.get(url).set(as());
  const post = (url: string, body: object = {}) => http.post(url).set(as()).send(body);
  const bal = async (code: string) => {
    const tb = (await get('/api/accounting/reports/trial-balance').expect(200)).body;
    expect(tb.balanced).toBe(true);
    return Number(tb.rows.find((x: { code: string }) => x.code === code)?.balance ?? 0);
  };
  const stock = async (productId: string) =>
    (await get(`/api/inventory/balances?productId=${productId}`).expect(200)).body[0];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (
      await http
        .post('/api/auth/register')
        .send({
          companyName: 'CV Konveksi Rapi',
          name: 'Pemilik',
          email: `prd-${stamp}@uji.id`,
          password: 'rahasia123',
          businessModel: 'MANUFAKTUR',
        })
        .expect(201)
    ).body.accessToken;
    warehouseId = (await get('/api/warehouses')).body[0].id;
    kain = (await post('/api/products', { sku: 'KAIN', name: 'Kain katun', baseUom: 'M', sellPrice: '0' }).expect(201))
      .body.id;
    benang = (await post('/api/products', { sku: 'BNG', name: 'Benang', baseUom: 'ROLL', sellPrice: '0' }).expect(201))
      .body.id;
    kemeja = (await post('/api/products', { sku: 'KMJ-L', name: 'Kemeja L', sellPrice: '90000' }).expect(201)).body.id;
    const sup = (await post('/api/suppliers', { code: 'S1', name: 'Toko Kain' }).expect(201)).body.id;
    const po = (
      await post('/api/purchase-orders', {
        supplierId: sup,
        warehouseId,
        lines: [
          { productId: kain, qty: '100', price: '20000' },
          { productId: benang, qty: '50', price: '2000' },
        ],
      }).expect(201)
    ).body;
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    await post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'K-1' }).expect(201);
  });
  afterAll(() => app.close());

  it('resep: bahan per batch + upah & overhead standar → taksiran harga pokok', async () => {
    await post('/api/production/boms', {
      name: 'x',
      productId: kemeja,
      outputQty: '10',
      lines: [{ productId: kemeja, qty: '1' }],
    }).expect(400);
    const b = (
      await post('/api/production/boms', {
        name: 'Kemeja L',
        productId: kemeja,
        outputQty: '10',
        laborCost: '100000',
        overheadCost: '50000',
        lines: [
          { productId: kain, qty: '15' },
          { productId: benang, qty: '5' },
        ],
      }).expect(201)
    ).body;
    bomId = b.id;
    expect(b.code).toBe('BOM-KMJ-L');
    // (15 × 20.000 + 5 × 2.000 + 150.000) / 10
    expect(b.estimate).toMatchObject({ material: '310000.00', batchCost: '460000.00', unitCost: '46000.00' });
  });

  it('perintah produksi: mulai (bahan → barang dalam proses), selesai (produk jadi masuk dengan harga pokok)', async () => {
    const o = (
      await post('/api/production/orders', { bomId, warehouseId, batches: '2', date: '2026-10-05' }).expect(201)
    ).body;
    orderId = o.id;
    expect(o).toMatchObject({ status: 'DRAFT', plannedQty: '20' });
    expect(o.lines.find((l: { productId: string }) => l.productId === kain).plannedQty).toBe('30');
    await post(`/api/production/orders/${o.id}/complete`, { outputQty: '20' }).expect(400); // belum mulai

    const inv0 = await bal('1-1400');
    const s = (
      await post(`/api/production/orders/${o.id}/start`, {
        date: '2026-10-05',
        lines: [{ productId: kain, qty: '31' }],
      }).expect(201)
    ).body;
    expect(s).toMatchObject({ status: 'IN_PROGRESS', materialCost: '640000.00' }); // 31 × 20.000 + 10 × 2.000
    expect(Number((await stock(kain)).qty)).toBe(69);
    expect(await bal('1-1420')).toBe(640000);
    expect(inv0 - (await bal('1-1400'))).toBe(640000);
    const h = (await get('/api/accounting/health').expect(200)).body.checks as { key: string; status: string }[];
    expect(h.find((c) => c.key === 'wip')?.status).toBe('OK');

    const c = (
      await post(`/api/production/orders/${o.id}/complete`, { date: '2026-10-06', outputQty: '19' }).expect(201)
    ).body;
    expect(c).toMatchObject({
      status: 'COMPLETED',
      laborCost: '200000.00',
      overheadCost: '100000.00',
      totalCost: '940000.00',
      unitCost: '49473.68',
    });
    const st = await stock(kemeja);
    expect(Number(st.qty)).toBe(19);
    expect(Number(st.avgCost)).toBeCloseTo(49473.68, 1);
    expect(await bal('1-1420')).toBe(0);
    expect(await bal('5-4900')).toBe(-300000); // biaya konversi dibebankan ke persediaan
    expect(inv0 - (await bal('1-1400'))).toBeCloseTo(640000 - 940000, 0);
    const moves = (await get(`/api/inventory/moves?productId=${kemeja}`).expect(200)).body;
    expect(moves[0]).toMatchObject({ type: 'PRODUCTION_OUTPUT', qty: '19.0000' });
  });

  it('batal produksi yang sedang berjalan: bahan kembali ke gudang, barang dalam proses nol', async () => {
    const o = (
      await post('/api/production/orders', { bomId, warehouseId, batches: '1', date: '2026-10-06' }).expect(201)
    ).body;
    await post(`/api/production/orders/${o.id}/start`, { date: '2026-10-06' }).expect(201);
    expect(Number((await stock(kain)).qty)).toBe(54);
    expect(await bal('1-1420')).toBe(310000);
    const x = (await post(`/api/production/orders/${o.id}/cancel`, { date: '2026-10-07' }).expect(201)).body;
    expect(x.status).toBe('CANCELLED');
    expect(Number((await stock(kain)).qty)).toBe(69);
    expect(await bal('1-1420')).toBe(0);
    await post(`/api/production/orders/${o.id}/start`).expect(400);
  });

  it('upah tenaga kerja produksi dari penggajian → Upah Langsung Produksi; laporan HPP produksi', async () => {
    await post('/api/apps/payroll/install').expect(201);
    await post('/api/hr/employees', {
      code: 'JHT-1',
      name: 'Penjahit Ani',
      ptkp: 'TK/0',
      joinDate: '2026-10-01',
      baseSalary: '4000000',
      isProduction: true,
    }).expect(201);
    await post('/api/hr/employees', {
      code: 'ADM-1',
      name: 'Admin Budi',
      ptkp: 'TK/0',
      joinDate: '2026-10-01',
      baseSalary: '5000000',
    }).expect(201);
    const run = (await post('/api/payroll/runs', { period: '2026-10' }).expect(201)).body;
    await post(`/api/payroll/runs/${run.id}/post`).expect(201);
    const direct = await bal('5-4100');
    expect(direct).toBeGreaterThan(4000000); // gaji + iuran BPJS perusahaan penjahit
    expect(await bal('6-1000')).toBe(5000000); // gaji admin tetap beban umum

    const r = (await get('/api/production/report?period=2026-10').expect(200)).body;
    expect(r).toMatchObject({
      wipStart: '0.00',
      materialUsed: '640000.00',
      laborApplied: '200000.00',
      overheadApplied: '100000.00',
      wipEnd: '0.00',
      costOfGoodsManufactured: '940000.00',
      check: '0.00',
    });
    expect(Number(r.laborActual)).toBe(direct);
    expect(Number(r.variance)).toBeCloseTo(direct - 300000, 2);
    expect(r.byProduct[0]).toMatchObject({ sku: 'KMJ-L', orders: 1, qty: '19', total: '940000.00' });
  });
});
