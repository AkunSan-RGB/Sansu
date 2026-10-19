/**
 * Laporan bagian: tiap bagian punya laporan kerja sendiri (bukan laporan pendukung pembukuan). Memeriksa angka utama,
 * bentuk seragam, hak akses peran, aplikasi yang harus aktif, validasi rentang, dan isolasi antar perusahaan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

interface Section { key: string; title: string; columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }
interface Report { dept: string; title: string; kpis: { label: string; value: string | number }[]; sections: Section[]; period: { from: string; to: string } }

describe('Laporan bagian (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const today = todayJakarta();
  let owner = ''; let acct = ''; let fin = ''; let hrUser = ''; let sales = ''; let cashier = ''; let other = '';
  let W = ''; let P = ''; let C = ''; let S = '';
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const login = async (email: string) => (await http.post('/api/auth/login').send({ email, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
  const mk = async (role: string, n: string) => {
    await post(owner, '/api/users', { name: n, email: `lb-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    return login(`lb-${n}-${stamp}@uji.id`);
  };
  const report = async (t: string, dept: string, qs = '') => (await get(t, `/api/dept-reports/${dept}${qs}`).expect(200)).body as Report;
  const kpi = (r: Report, label: string) => Number(r.kpis.find((k) => k.label === label)?.value);
  const sec = (r: Report, key: string) => r.sections.find((s) => s.key === key)!;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'Toko Laporan Bagian', name: 'Pemilik', email: `lb-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    for (const a of ['pos', 'hr', 'payroll', 'utility']) await post(owner, `/api/apps/${a}/install`).expect(201);
    acct = await mk('ACCOUNTANT', 'akt'); fin = await mk('FINANCE', 'fin'); hrUser = await mk('HR', 'sdm'); sales = await mk('SALES', 'sls'); cashier = await mk('CASHIER', 'kasir');
    other = (await http.post('/api/auth/register').send({ companyName: 'Toko Lain', name: 'Lain', email: `lb-x-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    W = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    P = (await post(owner, '/api/products', { sku: 'LB-1', name: 'Barang Laporan', sellPrice: '100000' }).expect(201)).body.id;
    C = (await post(owner, '/api/customers', { code: 'LB1', name: 'PT Pembeli Laporan', paymentTermDays: 14 }).expect(201)).body.id;
    S = (await post(owner, '/api/suppliers', { code: 'SLB', name: 'Pemasok Laporan' }).expect(201)).body.id;
    await post(owner, '/api/inventory/adjustments', { warehouseId: W, reason: 'OPENING', date: today, lines: [{ productId: P, qty: '100', unitCost: '60000' }] }).expect(201);
    // penjualan: 2 × 100.000
    const so = (await post(owner, '/api/sales-orders', { customerId: C, warehouseId: W, lines: [{ productId: P, qty: '2', price: '100000' }] }).expect(201)).body;
    await post(owner, `/api/sales-orders/${so.id}/confirm`).expect(201);
    await post(owner, '/api/invoices', { salesOrderId: so.id }).expect(201);
    // pembelian: 5 × 5.000 = 25.000
    const po = (await post(owner, '/api/purchase-orders', { supplierId: S, warehouseId: W, lines: [{ productId: P, qty: '5', price: '5000' }] }).expect(201)).body;
    await post(owner, `/api/purchase-orders/${po.id}/confirm`).expect(201);
    await post(owner, '/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'LB-INV-1' }).expect(201);
    // kasir: 3 × 100.000 tunai
    const session = (await post(cashier, '/api/pos/sessions', { warehouseId: W, openingCash: '0' }).expect(201)).body.id;
    await post(cashier, '/api/pos/orders', { sessionId: session, lines: [{ productId: P, qty: '3', price: '100000' }], payments: [{ method: 'CASH', amount: '400000' }] }).expect(201);
    // SDM
    await post(owner, '/api/hr/employees', { code: 'E-LB', name: 'Karyawan Laporan', ptkp: 'TK/0', joinDate: '2025-01-02', baseSalary: '5000000', department: 'Gudang' }).expect(201);
  });
  afterAll(() => app.close());

  it('penjualan: angka utama, per pelanggan/produk, umur piutang, bentuk seragam', async () => {
    const r = await report(owner, 'sales');
    expect(r.title).toBe('Laporan penjualan');
    expect(kpi(r, 'Penjualan (sebelum PPN)')).toBe(200000);
    expect(kpi(r, 'Jumlah faktur')).toBe(1);
    expect(kpi(r, 'Piutang berjalan')).toBeGreaterThanOrEqual(200000);
    expect(sec(r, 'pelanggan').rows[0]).toMatchObject({ customer: 'PT Pembeli Laporan', invoices: 1 });
    const prod = sec(r, 'produk').rows[0] as { product: string; qty: string; sales: string; cogs: string; margin: string };
    expect(prod.product).toBe('Barang Laporan');
    expect(Number(prod.qty)).toBe(2);
    expect(Number(prod.sales)).toBe(200000);
    expect(Number(prod.cogs)).toBe(120000);
    expect(Number(prod.margin)).toBe(80000);
    expect(sec(r, 'umur').rows[0]).toMatchObject({ customer: 'PT Pembeli Laporan' });
    expect(sec(r, 'sales').rows.length).toBeGreaterThanOrEqual(1);
    for (const s of r.sections) for (const row of s.rows) for (const col of s.columns) expect(Object.keys(row)).toContain(col.key); // kolom selalu ada di baris
  });

  it('pembelian: faktur pemasok, per pemasok/produk, umur utang', async () => {
    const r = await report(owner, 'purchases');
    expect(kpi(r, 'Pembelian (sebelum PPN)')).toBe(25000);
    expect(sec(r, 'pemasok').rows[0]).toMatchObject({ supplier: 'Pemasok Laporan' });
    expect(Number((sec(r, 'produk').rows[0] as { qty: string }).qty)).toBe(5);
    expect(sec(r, 'umur').rows.length).toBe(1);
  });

  it('persediaan, kas & bank, kasir, SDM: angka sesuai transaksi', async () => {
    const inv = await report(owner, 'inventory');
    expect(kpi(inv, 'Nilai persediaan')).toBeGreaterThan(0);
    expect(sec(inv, 'gudang').rows.length).toBeGreaterThanOrEqual(1);
    expect(sec(inv, 'produk').rows[0]).toMatchObject({ product: 'Barang Laporan' });
    const cash = await report(owner, 'cash');
    expect(sec(cash, 'saldo').rows.length).toBeGreaterThanOrEqual(1);
    const pos = await report(owner, 'pos');
    expect(kpi(pos, 'Jumlah transaksi')).toBe(1);
    expect(kpi(pos, 'Penjualan kasir (termasuk pajak)')).toBeGreaterThanOrEqual(300000);
    expect(sec(pos, 'terlaris').rows[0]).toMatchObject({ product: 'Barang Laporan' });
    expect(sec(pos, 'metode').rows[0]).toMatchObject({ method: 'CASH' });
    const hr = await report(owner, 'hr');
    expect(kpi(hr, 'Karyawan aktif')).toBe(1);
    expect(sec(hr, 'karyawan').rows[0]).toMatchObject({ department: 'Gudang', employees: 1 });
  });

  it('bagian lain berjalan tanpa galat dan berbentuk seragam (FMCG, produksi, jasa, F&B, utilitas)', async () => {
    for (const dept of ['fmcg', 'mfg', 'jasa', 'fnb', 'utility']) {
      const r = await report(owner, dept);
      expect(r.dept).toBe(dept);
      expect(r.sections.length).toBeGreaterThanOrEqual(4);
      for (const s of r.sections) expect(Array.isArray(s.rows)).toBe(true);
    }
  });

  it('rentang tanggal memengaruhi angka; validasi rentang', async () => {
    const past = await report(owner, 'sales', `?from=${addDays(today, -400)}&to=${addDays(today, -300)}`);
    expect(kpi(past, 'Penjualan (sebelum PPN)')).toBe(0);
    expect(past.period.from).toBe(addDays(today, -400));
    expect((await get(owner, `/api/dept-reports/sales?from=${today}&to=${addDays(today, -1)}`)).status).toBe(400);
    expect((await get(owner, `/api/dept-reports/sales?from=${addDays(today, -900)}&to=${today}`)).status).toBe(400);
    expect((await get(owner, '/api/dept-reports/sales?from=bukan-tanggal')).status).toBe(400);
    expect((await get(owner, '/api/dept-reports/tidak-ada')).status).toBe(404);
    // rentang panjang dikelompokkan per bulan
    const year = await report(owner, 'sales', `?from=${addDays(today, -200)}&to=${today}`);
    expect(String((sec(year, 'periode').rows[0] as { period: string }).period)).toMatch(/^\d{4}-\d{2}$/);
  });

  it('hak akses: Akuntan dan Keuangan boleh, Sales dan Kasir ditolak, SDM hanya laporan SDM', async () => {
    await get(acct, '/api/dept-reports/sales').expect(200);
    await get(fin, '/api/dept-reports/purchases').expect(200);
    expect((await get(sales, '/api/dept-reports/sales')).status).toBe(403);
    expect((await get(cashier, '/api/dept-reports/pos')).status).toBe(403);
    await get(hrUser, '/api/dept-reports/hr').expect(200);
    expect((await get(hrUser, '/api/dept-reports/sales')).status).toBe(403);
  });

  it('isolasi antar perusahaan dan aplikasi yang belum aktif', async () => {
    const r = await report(other, 'sales');
    expect(kpi(r, 'Penjualan (sebelum PPN)')).toBe(0);
    expect(sec(r, 'pelanggan').rows).toHaveLength(0);
    expect((await get(other, '/api/dept-reports/pos')).status).toBe(403); // aplikasi Kasir belum diaktifkan di perusahaan itu
    expect((await get(other, '/api/dept-reports/hr')).status).toBe(403);
  });

  describe('jasa dan produksi dengan data', () => {
    let jasa = ''; let mfg = ''; let jasaAdm = '';
    beforeAll(async () => {
      jasa = (await http.post('/api/auth/register').send({ companyName: 'Konsultan Laporan', name: 'Pemilik', email: `lb-j-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'JASA' }).expect(201)).body.accessToken;
      await post(jasa, '/api/apps/payroll/install').expect(201);
      await post(jasa, '/api/users', { name: 'Adm', email: `lb-ja-${stamp}@uji.id`, password: 'rahasia12345', role: 'ADMIN' }).expect(201);
      jasaAdm = await login(`lb-ja-${stamp}@uji.id`);
      const emp = (await post(jasa, '/api/hr/employees', { code: 'E-J', name: 'Dewi Konsultan', ptkp: 'TK/0', joinDate: '2025-01-02', baseSalary: '5000000' }).expect(201)).body.id;
      const cust = (await post(jasa, '/api/customers', { code: 'JK1', name: 'PT Klien Jasa', paymentTermDays: 14 }).expect(201)).body.id;
      await post(jasa, '/api/services/projects', { name: 'Audit Sistem', customerId: cust, contractValue: '10000000' }).expect(201);
      await post(jasaAdm, '/api/timesheets/rates', { rate: '200000', validFrom: addDays(today, -30) }).expect(201);
      const e = (await post(jasaAdm, '/api/timesheets/entries', { employeeId: emp, customerId: cust, workDate: today, hours: '3', description: 'Analisis sistem' }).expect(201)).body;
      await post(jasaAdm, '/api/timesheets/submit', { ids: [e.id] }).expect(201);
      await post(jasa, `/api/timesheets/entries/${e.id}/approve`).expect(201);
      await post(jasaAdm, '/api/retainers', { customerId: cust, title: 'Retainer pajak', monthlyFee: '2000000', startDate: `${addDays(today, -70).slice(0, 7)}-01` }).expect(201);
      mfg = (await http.post('/api/auth/register').send({ companyName: 'Pabrik Laporan', name: 'Pemilik', email: `lb-m-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'MANUFAKTUR' }).expect(201)).body.accessToken;
      const w = (await get(mfg, '/api/warehouses').expect(200)).body[0].id;
      const raw = (await post(mfg, '/api/products', { sku: 'M-RAW', name: 'Bahan', sellPrice: '1000' }).expect(201)).body.id;
      const fg = (await post(mfg, '/api/products', { sku: 'M-FG', name: 'Barang Jadi', sellPrice: '50000' }).expect(201)).body.id;
      await post(mfg, '/api/inventory/adjustments', { warehouseId: w, reason: 'OPENING', date: today, lines: [{ productId: raw, qty: '1000', unitCost: '1000' }] }).expect(201);
      const bom = (await post(mfg, '/api/production/boms', { name: 'Resep', productId: fg, outputQty: '10', laborCost: '5000', overheadCost: '2000', lines: [{ productId: raw, qty: '5' }] }).expect(201)).body.id;
      const o = (await post(mfg, '/api/production/orders', { bomId: bom, warehouseId: w, batches: '2', date: today }).expect(201)).body;
      await post(mfg, `/api/production/orders/${o.id}/start`, { date: today }).expect(201);
      await post(mfg, `/api/production/orders/${o.id}/complete`, { outputQty: '20', date: today }).expect(201);
    });

    it('jasa: jam belum ditagih, proyek, retainer yang tertinggal', async () => {
      const r = await report(jasa, 'jasa');
      expect(kpi(r, 'Jam disetujui belum ditagih')).toBe(3);
      expect(kpi(r, 'Nilai belum ditagih')).toBe(600000);
      expect(sec(r, 'proyek').rows[0]).toMatchObject({ project: 'Audit Sistem', pct: 0 });
      expect(sec(r, 'belum-ditagih').rows[0]).toMatchObject({ customer: 'PT Klien Jasa' });
      expect(sec(r, 'utilisasi').rows[0]).toMatchObject({ employee: 'Dewi Konsultan' });
      expect(sec(r, 'retainer').rows[0]).toMatchObject({ title: 'Retainer pajak', status: 'Ada periode belum ditagih' });
      expect(kpi(r, 'Retainer dengan periode belum ditagih')).toBe(1);
    });

    it('produksi: biaya per produk, hasil per perintah, rendemen', async () => {
      const r = await report(mfg, 'mfg');
      expect(kpi(r, 'Perintah selesai')).toBe(1);
      expect(kpi(r, 'Hasil produksi')).toBe(20);
      const hpp = sec(r, 'hpp').rows[0] as { product: string; qty: string; total: string };
      expect(hpp.product).toBe('Barang Jadi');
      expect(Number(hpp.qty)).toBe(20);
      expect(Number(hpp.total)).toBeGreaterThan(0);
      expect(Number((sec(r, 'perintah').rows[0] as { yield: string }).yield)).toBe(100);
    });
  });

  describe('F&B: selisih bahan terhadap resep', () => {
    it('bahan yang dibuang tampil sebagai susut terhadap kebutuhan resep', async () => {
      const fnb = (await http.post('/api/auth/register').send({ companyName: 'Kedai Laporan', name: 'Pemilik', email: `lb-f-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FNB' }).expect(201)).body.accessToken;
      await post(fnb, '/api/apps/pos/install').expect(201);
      const w = (await get(fnb, '/api/warehouses').expect(200)).body[0].id;
      const kopi = (await post(fnb, '/api/products', { sku: 'F-KOPI', name: 'Biji Kopi', baseUom: 'GRAM', sellPrice: '0' }).expect(201)).body.id;
      const menu = (await post(fnb, '/api/products', { sku: 'F-MENU', name: 'Kopi Susu', baseUom: 'PCS', sellPrice: '24000', madeToOrder: true }).expect(201)).body.id;
      await post(fnb, '/api/production/boms', { name: 'Resep Kopi Susu', productId: menu, outputQty: '1', laborCost: '0', overheadCost: '0', lines: [{ productId: kopi, qty: '18' }] }).expect(201);
      await post(fnb, '/api/inventory/adjustments', { warehouseId: w, reason: 'OPENING', date: today, lines: [{ productId: kopi, qty: '1000', unitCost: '140' }] }).expect(201);
      const kasir = await (async () => { await post(fnb, '/api/users', { name: 'Kasir', email: `lb-fk-${stamp}@uji.id`, password: 'rahasia12345', role: 'CASHIER' }).expect(201); return login(`lb-fk-${stamp}@uji.id`); })();
      const session = (await post(kasir, '/api/pos/sessions', { warehouseId: w, openingCash: '0' }).expect(201)).body.id;
      await post(kasir, '/api/pos/orders', { sessionId: session, lines: [{ productId: menu, qty: '10', price: '24000' }], payments: [{ method: 'CASH', amount: '300000' }] }).expect(201);
      await post(fnb, '/api/inventory/adjustments', { warehouseId: w, reason: 'DAMAGED', date: today, lines: [{ productId: kopi, qty: '-90' }] }).expect(201);
      const r = await report(fnb, 'fnb');
      const row = sec(r, 'selisih').rows[0] as { ingredient: string; expected: string; pos_used: string; waste: string; waste_pct: string; waste_value: string };
      expect(row.ingredient).toBe('Biji Kopi');
      expect(Number(row.expected)).toBe(180); // 10 menu × 18 gr
      expect(Number(row.pos_used)).toBe(180);
      expect(Number(row.waste)).toBe(90);
      expect(Number(row.waste_pct)).toBe(50);
      expect(Number(row.waste_value)).toBe(12600); // 90 gr × Rp140
      expect(kpi(r, 'Susut bahan (penyesuaian keluar)')).toBe(12600);
    });
  });
});
