/**
 * Laporan pendukung (e2e): penjualan, pembelian, persediaan, kas & bank, akun lainnya — rincian cocok dengan buku besar.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, todayJakarta } from '../src/common/utils/dates';

describe('Laporan pendukung (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string; let wh2: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const from = `${day.slice(0, 7)}-01`;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (u: string, t = owner) => http.get(u).set(as(t));
  const post = (u: string, b: object = {}) => http.post(u).set(as(owner)).send(b);
  type Rec = { key: string; ok: boolean; diff: number; left: { value: number }; right: { value: number } };
  type Rep = { reconciliation: Rec[]; sections: { key: string; tables: { rows: (string | number | null)[][]; total?: (string | number | null)[] }[] }[] };
  const report = async (kind: string) => (await get(`/api/accounting/support/${kind}?from=${from}&to=${day}`).expect(200)).body as Rep;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Pendukung', name: 'P', email: `lp-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    const wh = (await get('/api/warehouses').expect(200)).body[0].id;
    const sup = (await post('/api/suppliers', { code: 'S-LP', name: 'Pemasok Uji' }).expect(201)).body.id;
    const cus = (await post('/api/customers', { code: 'C-LP', name: 'Pelanggan Uji', paymentTermDays: 30 }).expect(201)).body.id;
    const prod = (await post('/api/products', { sku: 'LP-1', name: 'Barang Pendukung', baseUom: 'PCS', sellPrice: '20000' }).expect(201)).body.id;
    // modal, pembelian barang, penjualan, pembayaran sebagian
    const bank = ((await get('/api/cash/accounts').expect(200)).body as { id: string; code: string }[]).find((a) => a.code === '1-1200')!.id;
    const eq = ((await get('/api/cash/counter-accounts').expect(200)).body as { id: string; code: string }[]).find((a) => a.code === '3-1000')!.id;
    await post('/api/cash/transactions', { type: 'IN', cashAccountId: bank, date: from, description: 'Modal', reference: 'M-1', lines: [{ accountId: eq, amount: '100000000' }] }).expect(201);
    const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: wh, lines: [{ productId: prod, qty: '100', price: '10000' }] }).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    await post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'LP-1' }).expect(201);
    const so = (await post('/api/sales-orders', { customerId: cus, warehouseId: wh, lines: [{ productId: prod, qty: '10', price: '20000' }] }).expect(201)).body;
    await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    const inv = (await post('/api/invoices', { salesOrderId: so.id }).expect(201)).body;
    await post('/api/payments', { invoiceId: inv.id, amount: '50000', method: 'TRANSFER', cashAccountId: bank }).expect(201);
    wh2 = wh;
  });
  afterAll(async () => { await app.close(); });

  it('penjualan: rekap, rincian, dan pencocokan buku besar cocok', async () => {
    const r = await report('sales');
    expect(r.reconciliation.map((x) => x.key)).toEqual(['sales-revenue', 'sales-revenue-all', 'sales-delivery-cogs', 'sales-ar']);
    expect(r.reconciliation.every((x) => x.ok)).toBe(true);
    const monthly = r.sections.find((s) => s.key === 'sales-monthly')!.tables[0];
    expect(monthly.total?.[2]).toBe(200000); // 10 × 20.000
    expect(r.sections.find((s) => s.key === 'sales-list')!.tables[0].rows).toHaveLength(1);
    expect(r.reconciliation.find((x) => x.key === 'sales-ar')!.left.value).toBe(Math.round(200000 * 1.11) - 50000);
  });

  it('pembelian: rekap dan pencocokan utang usaha', async () => {
    const r = await report('purchases');
    expect(r.reconciliation.every((x) => x.ok)).toBe(true);
    expect(r.sections.find((s) => s.key === 'purchases-monthly')!.tables[0].total?.[2]).toBe(1000000);
    expect(r.sections.find((s) => s.key === 'purchases-list')!.tables[0].rows).toHaveLength(1);
  });

  it('persediaan: kartu stok per produk dan nilai cocok dengan buku besar', async () => {
    const r = await report('inventory');
    const t = r.sections.find((s) => s.key === 'inventory-card')!.tables[0];
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toEqual(expect.arrayContaining(['LP-1', 90])); // 100 masuk − 10 keluar
    expect(r.reconciliation.find((x) => x.key === 'inventory-gl')!.ok).toBe(true);
    expect(r.reconciliation.find((x) => x.key === 'inventory-balance')!.ok).toBe(true);
  });

  it('kas & bank: mutasi per akun dan pencocokan', async () => {
    const r = await report('cash');
    expect(r.reconciliation.find((x) => x.key === 'cash-gl')!.ok).toBe(true);
    const acc = r.sections.find((s) => s.key === 'cash-accounts')!.tables[0];
    expect(Number(acc.total?.[3])).toBeGreaterThanOrEqual(100000000); // penerimaan: modal + pembayaran pelanggan
    expect(r.sections.find((s) => s.key === 'cash-sources')!.tables[0].rows.length).toBeGreaterThan(0);
  });

  it('akun lainnya: neraca saldo seimbang; tanggal tidak sah ditolak; peran Gudang tidak boleh', async () => {
    const r = await report('other');
    expect(r.reconciliation[0].ok).toBe(true);
    expect(r.sections.some((s) => s.key === 'other-equity' && s.tables[0].rows.length > 0)).toBe(true);
    await get(`/api/accounting/support/ngawur`).expect(400);
    await get(`/api/accounting/support/sales?from=${day}&to=${addDays(day, -5)}`).expect(400);
    void wh2;
    await post('/api/users', { name: 'gd', email: `lp-gd-${stamp}@uji.id`, password: 'rahasia12345', role: 'WAREHOUSE' }).expect(201);
    const gd = (await http.post('/api/auth/login').send({ email: `lp-gd-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
    await get(`/api/accounting/support/sales`, gd).expect(403);
  });
});
