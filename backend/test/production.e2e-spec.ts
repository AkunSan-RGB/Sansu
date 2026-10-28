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

  describe('Versi resep', () => {
    let revBom: string;
    const put = (url: string, body: object) => http.put(url).set(as()).send(body);
    const body = (over: object = {}) => ({
      name: 'Kemeja versi',
      productId: kemeja,
      outputQty: '10',
      laborCost: '100000',
      overheadCost: '20000',
      lines: [{ productId: kain, qty: '2' }],
      ...over,
    });

    it('resep baru berversi 1; simpan tanpa perubahan tidak menaikkan versi', async () => {
      const b = (await post('/api/production/boms', { ...body(), code: 'BOM-REV' }).expect(201)).body;
      revBom = b.id;
      expect(b.version).toBe(1);
      const same = (await put(`/api/production/boms/${revBom}`, body()).expect(200)).body;
      expect(same.version).toBe(1);
      expect((await get(`/api/production/boms/${revBom}/revisions`).expect(200)).body).toEqual([]);
    });

    it('perubahan menaikkan versi dan menyimpan versi lama beserta alasannya', async () => {
      const v2 = (
        await put(`/api/production/boms/${revBom}`, body({ lines: [{ productId: kain, qty: '3' }, { productId: benang, qty: '1' }], changeReason: 'Kain lebih tebal' })).expect(200)
      ).body;
      expect(v2.version).toBe(2);
      const revs = (await get(`/api/production/boms/${revBom}/revisions`).expect(200)).body;
      expect(revs).toHaveLength(1);
      expect(revs[0]).toMatchObject({ version: 1, reason: 'Kain lebih tebal' });
      expect(revs[0].snapshot.lines).toHaveLength(1);
      expect(revs[0].changes.map((c: { label: string }) => c.label).join('|')).toMatch(/Takaran bahan.*\|Bahan ditambah/);
    });

    it('perintah produksi mencatat versi resep saat dibuat', async () => {
      const o1 = (await post('/api/production/orders', { bomId: revBom, warehouseId, batches: '1' }).expect(201)).body;
      expect(o1.bom.version).toBe(2);
      await put(`/api/production/boms/${revBom}`, body({ outputQty: '12', lines: [{ productId: kain, qty: '3' }] })).expect(200);
      const o2 = (await post('/api/production/orders', { bomId: revBom, warehouseId, batches: '1' }).expect(201)).body;
      expect(o2.bom.version).toBe(3);
      expect((await get(`/api/production/orders/${o1.id}`).expect(200)).body.bom.version).toBe(2);
      expect((await get(`/api/production/boms/${revBom}/revisions`).expect(200)).body.map((r: { version: number }) => r.version)).toEqual([2, 1]);
    });
  });

  describe('Subkontrak (maklon)', () => {
    let vendor = ''; let other = ''; let laborAcc = ''; let expenseAcc = '';
    let orderId = ''; let bomMk = '';
    const bill = (supplierId: string, accountId: string, price: string, no: string) =>
      post('/api/purchase-invoices/bills', { supplierId, supplierInvoiceNo: no, withVat: false, lines: [{ type: 'EXPENSE', description: 'Jasa maklon jahit', accountId, price }] });

    beforeAll(async () => {
      vendor = (await post('/api/suppliers', { code: 'MK1', name: 'CV Maklon Jahit' }).expect(201)).body.id;
      other = (await post('/api/suppliers', { code: 'MK2', name: 'Pemasok Lain' }).expect(201)).body.id;
      const accs = (await get('/api/cash/counter-accounts').expect(200)).body as { id: string; code: string; type: string }[];
      laborAcc = accs.find((a) => a.code === '5-4100')!.id;
      expenseAcc = accs.find((a) => a.type === 'EXPENSE' && a.code !== '5-4100')!.id;
      bomMk = (await post('/api/production/boms', { code: 'BOM-MK', name: 'Kemeja maklon', productId: kemeja, outputQty: '10', laborCost: '1', lines: [{ productId: kain, qty: '10' }] }).expect(201)).body.id;
    });

    it('pemasok maklon harus ada; perintah subkontrak tidak bisa selesai tanpa tagihan jasa', async () => {
      expect((await post('/api/production/orders', { bomId: bomMk, warehouseId, batches: '1', subcontractorId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
      const o = (await post('/api/production/orders', { bomId: bomMk, warehouseId, batches: '1', subcontractorId: vendor }).expect(201)).body;
      orderId = o.id;
      expect(o.subcontract).toMatchObject({ supplierName: 'CV Maklon Jahit', billId: null });
      await post(`/api/production/orders/${orderId}/start`).expect(201);
      expect((await post(`/api/production/orders/${orderId}/complete`, { outputQty: '10' })).status).toBe(400);
    });

    it('tagihan yang salah ditolak: pemasok lain, akun bukan upah langsung, faktur lain', async () => {
      const b1 = (await bill(other, laborAcc, '500000', 'MK-A').expect(201)).body;
      expect((await post(`/api/production/orders/${orderId}/subcontract-bill`, { purchaseInvoiceId: b1.id })).status).toBe(400);
      const b2 = (await bill(vendor, expenseAcc, '500000', 'MK-B').expect(201)).body;
      expect((await post(`/api/production/orders/${orderId}/subcontract-bill`, { purchaseInvoiceId: b2.id })).status).toBe(400);
    });

    it('satu tagihan dibagi ke dua perintah: upah langsung = alokasi masing-masing; alokasi tak boleh melebihi sisa', async () => {
      const b = (await bill(vendor, laborAcc, '600000', 'MK-C').expect(201)).body;
      // bahan di tangan maklon terlihat selama perintah berjalan
      const h = (await get('/api/production/subcontract/holdings').expect(200)).body as { supplierName: string; totalValue: string; orders: { orderNumber: string }[] }[];
      expect(h.find((x) => x.supplierName === 'CV Maklon Jahit')?.orders.length).toBeGreaterThan(0);
      expect((await post(`/api/production/orders/${orderId}/subcontract-bill`, { purchaseInvoiceId: b.id, amount: '700000' })).status).toBe(400); // melebihi tagihan
      const linked = (await post(`/api/production/orders/${orderId}/subcontract-bill`, { purchaseInvoiceId: b.id, amount: '400000' }).expect(201)).body;
      expect(linked.subcontract).toMatchObject({ billNumber: b.number, amount: '400000.00' });
      expect((await post(`/api/production/orders/${orderId}/subcontract-bill`, { purchaseInvoiceId: b.id })).status).toBe(400); // sudah ada
      expect((await post(`/api/production/orders/${orderId}/cancel`, {})).status).toBe(400); // tagihan menempel
      expect((await post(`/api/production/orders/${orderId}/complete`, { outputQty: '10', laborCost: '1' })).status).toBe(400); // upah tidak boleh diketik
      const done = (await post(`/api/production/orders/${orderId}/complete`, { outputQty: '10' }).expect(201)).body;
      expect(Number(done.laborCost)).toBe(400000);
      // bahan 10 × 20.000 = 200.000 + upah maklon 400.000 → 600.000 / 10
      expect(Number(done.totalCost)).toBe(600000);
      expect(Number(done.unitCost)).toBe(60000);
      // perintah kedua mengambil sisa tagihan (200.000)
      const o2 = (await post('/api/production/orders', { bomId: bomMk, warehouseId, batches: '1', subcontractorId: vendor }).expect(201)).body;
      await post(`/api/production/orders/${o2.id}/start`).expect(201);
      const l2 = (await post(`/api/production/orders/${o2.id}/subcontract-bill`, { purchaseInvoiceId: b.id }).expect(201)).body;
      expect(l2.subcontract.amount).toBe('200000.00');
      expect(Number((await post(`/api/production/orders/${o2.id}/complete`, { outputQty: '10' }).expect(201)).body.laborCost)).toBe(200000);
      // tagihan sudah habis dialokasikan
      const o3 = (await post('/api/production/orders', { bomId: bomMk, warehouseId, batches: '1', subcontractorId: vendor }).expect(201)).body;
      expect((await post(`/api/production/orders/${o3.id}/subcontract-bill`, { purchaseInvoiceId: b.id })).status).toBe(400);
      await bal('2-1100'); // neraca saldo tetap seimbang
    });
  });
});
