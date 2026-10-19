/**
 * Laporan pendukung Dagang: barang diterima belum ditagih (GRNI), surat jalan belum difaktur, dan umur piutang/utang.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

type Rec = { key: string; ok: boolean; diff: number; left: { value: number }; right: { value: number } };
type Rep = { conclusion: { status: string; findings: { level: string; title: string }[] }; reconciliation: Rec[]; sections: { key: string; tables: { rows: (string | number | null)[][]; total?: (string | number | null)[] }[] }[] };

describe('Laporan pendukung dagang: GRNI, surat jalan, umur (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const from = `${day.slice(0, 7)}-01`;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (u: string) => http.get(u).set(as(owner));
  const post = (u: string, b: object = {}) => http.post(u).set(as(owner)).send(b);
  const report = async (kind: string) => (await get(`/api/accounting/support/${kind}?from=${from}&to=${day}`).expect(200)).body as Rep;
  const sec = (r: Rep, k: string) => r.sections.find((s) => s.key === k)!.tables[0];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Dagang Laporan', name: 'P', email: `gs-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    const wh = (await get('/api/warehouses').expect(200)).body[0].id;
    const sup = (await post('/api/suppliers', { code: 'S1', name: 'Pemasok Uji', paymentTermDays: 30 }).expect(201)).body.id;
    const cus = (await post('/api/customers', { code: 'C1', name: 'Pelanggan Uji', paymentTermDays: 30 }).expect(201)).body.id;
    const prod = (await post('/api/products', { sku: 'D-1', name: 'Barang Dagang', baseUom: 'PCS', sellPrice: '20000' }).expect(201)).body.id;
    const bank = ((await get('/api/cash/accounts').expect(200)).body as { id: string; code: string }[]).find((a) => a.code === '1-1200')!.id;
    const eq = ((await get('/api/cash/counter-accounts').expect(200)).body as { id: string; code: string }[]).find((a) => a.code === '3-1000')!.id;
    await post('/api/cash/transactions', { type: 'IN', cashAccountId: bank, date: day, description: 'Modal', reference: 'M-1', lines: [{ accountId: eq, amount: '100000000' }] }).expect(201);
    // PO 100 pcs @10.000: diterima semua, ditagih separuh → GRNI 500.000
    const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: wh, lines: [{ productId: prod, qty: '100', price: '10000' }] }).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    const full = (await get(`/api/purchase-orders/${po.id}`).expect(200)).body as { lines: { id: string }[] };
    await post(`/api/purchase-orders/${po.id}/receipts`, { lines: [{ orderLineId: full.lines[0].id, qty: '100' }] }).expect(201);
    await post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'F-1', lines: [{ orderLineId: full.lines[0].id, qty: '50' }] }).expect(201);
    // SO 10 pcs dikirim (HPP 100.000) belum difaktur; SO 5 pcs dikirim dan difaktur
    const so1 = (await post('/api/sales-orders', { customerId: cus, warehouseId: wh, lines: [{ productId: prod, qty: '10' }] }).expect(201)).body;
    await post(`/api/sales-orders/${so1.id}/confirm`).expect(201);
    await post(`/api/sales-orders/${so1.id}/deliver`, {}).expect(201);
    const so2 = (await post('/api/sales-orders', { customerId: cus, warehouseId: wh, lines: [{ productId: prod, qty: '5' }] }).expect(201)).body;
    await post(`/api/sales-orders/${so2.id}/confirm`).expect(201);
    await post('/api/invoices', { salesOrderId: so2.id }).expect(201);
  });
  afterAll(() => app.close());

  it('pembelian: GRNI cocok dengan buku besar dan umur utang tampil', async () => {
    const r = await report('purchases');
    const grni = r.reconciliation.find((x) => x.key === 'purchases-grni')!;
    expect({ ok: grni.ok, diff: grni.diff }).toEqual({ ok: true, diff: 0 });
    expect(grni.left.value).toBe(500_000);
    const rows = sec(r, 'purchases-grni').rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].slice(5, 8)).toEqual([1_000_000, 500_000, 500_000]);
    const aging = sec(r, 'purchases-aging');
    expect(aging.rows).toHaveLength(1);
    expect(aging.rows[0][0]).toBe('Pemasok Uji');
    expect(aging.rows[0][6]).toBeGreaterThan(0);
    expect(r.conclusion.findings.map((f) => f.title).join('|')).toContain('1 penerimaan barang belum ditagih Rp500.000');
    expect(r.reconciliation.every((x) => x.ok)).toBe(true);
  });

  it('penjualan: surat jalan belum difaktur dan umur piutang tampil', async () => {
    const r = await report('sales');
    const sj = sec(r, 'sales-unbilled').rows;
    expect(sj).toHaveLength(1); // yang difaktur tidak tampil
    expect(sj[0][5]).toBe(100_000); // 10 × 10.000
    const aging = sec(r, 'sales-aging');
    expect(aging.rows).toHaveLength(1);
    expect(aging.rows[0][0]).toBe('Pelanggan Uji');
    expect(aging.rows[0][1]).toBe(Math.round(5 * 20000 * 1.11)); // belum jatuh tempo
    expect(aging.rows[0][6]).toBe(aging.rows[0][1]);
    expect(r.conclusion.findings.map((f) => f.title).join('|')).toContain('1 surat jalan belum difaktur (HPP Rp100.000)');
    expect(r.reconciliation.every((x) => x.ok)).toBe(true);
  });

  it('GRNI per tanggal: penerimaan dan faktur bertanggal mundur dihitung pada tanggalnya masing-masing', async () => {
    const back = (n: number) => { const x = new Date(`${day}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
    const wh = (await get('/api/warehouses').expect(200)).body[0].id;
    const sup = (await post('/api/suppliers', { code: 'S2', name: 'Pemasok Mundur', paymentTermDays: 30 }).expect(201)).body.id;
    const prod = (await post('/api/products', { sku: 'D-2', name: 'Barang Mundur', baseUom: 'PCS', sellPrice: '20000' }).expect(201)).body.id;
    const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: wh, date: back(10), lines: [{ productId: prod, qty: '40', price: '5000' }] }).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    const full = (await get(`/api/purchase-orders/${po.id}`).expect(200)).body as { lines: { id: string }[] };
    await post(`/api/purchase-orders/${po.id}/receipts`, { date: back(8), lines: [{ orderLineId: full.lines[0].id, qty: '40' }] }).expect(201);
    await post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'MUNDUR-1', date: back(4), lines: [{ orderLineId: full.lines[0].id, qty: '10' }] }).expect(201);
    const at = async (to: string) => {
      const r = (await get(`/api/accounting/support/purchases?from=${back(30)}&to=${to}`).expect(200)).body as Rep;
      return r.reconciliation.find((x) => x.key === 'purchases-grni')!;
    };
    const before = await at(back(9)); // sebelum barang diterima
    expect({ ok: before.ok, left: before.left.value }).toEqual({ ok: true, left: 0 });
    const received = await at(back(6)); // sudah diterima, belum difaktur
    expect({ ok: received.ok, left: received.left.value, right: received.right.value }).toEqual({ ok: true, left: 200_000, right: 200_000 });
    const billed = await at(back(3)); // difaktur 10 dari 40
    expect({ ok: billed.ok, left: billed.left.value }).toEqual({ ok: true, left: 150_000 });
    const rep = (await get(`/api/accounting/support/purchases?from=${back(30)}&to=${back(6)}`).expect(200)).body as Rep;
    expect(sec(rep, 'purchases-grni').rows.some((r) => r[7] === 200_000 && r[4] === 2)).toBe(true); // umur dihitung sampai tanggal akhir
  });
});
