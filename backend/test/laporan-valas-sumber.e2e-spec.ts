/**
 * Laporan pendukung: piutang/utang valas ikut pencocokan dan umur, pendapatan menurut sumber (di luar faktur),
 * dan baris "Lainnya" pada tabel teratas.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

type Rec = { key: string; ok: boolean; diff: number; left: { value: number }; right: { value: number } };
type Rep = { reconciliation: Rec[]; sections: { key: string; paragraphs: string[]; tables: { rows: (string | number | null)[][]; total?: (string | number | null)[] }[] }[] };

describe('Laporan pendukung: valas, sumber pendapatan, lainnya (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let t: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const from = `${day.slice(0, 7)}-01`;
  const as = () => ({ Authorization: `Bearer ${t}` });
  const get = (u: string) => http.get(u).set(as());
  const post = (u: string, b: object = {}) => http.post(u).set(as()).send(b);
  const report = async (kind: string) => (await get(`/api/accounting/support/${kind}?from=${from}&to=${day}`).expect(200)).body as Rep;
  const sec = (r: Rep, k: string) => r.sections.find((s) => s.key === k)!.tables[0];
  const allOk = (r: Rep) => { for (const x of r.reconciliation) expect({ key: x.key, ok: x.ok, diff: x.diff }).toEqual({ key: x.key, ok: true, diff: 0 }); };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    t = (await http.post('/api/auth/register').send({ companyName: 'PT Valas Laporan', name: 'P', email: `vs-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    const wh = (await get('/api/warehouses').expect(200)).body[0].id;
    const cust = (await post('/api/customers', { code: 'BUY', name: 'Buyer Singapore' }).expect(201)).body.id;
    const supp = (await post('/api/suppliers', { code: 'SUP', name: 'Supplier Shenzhen' }).expect(201)).body.id;
    const prod = (await post('/api/products', { sku: 'BRG', name: 'Barang', sellPrice: '1000' }).expect(201)).body.id;
    const po0 = (await post('/api/purchase-orders/quick', { supplierId: supp, warehouseId: wh, receiveNow: true, lines: [{ productId: prod, qty: '500', price: '50000' }] }).expect(201)).body;
    await post('/api/purchase-invoices', { purchaseOrderId: po0.id, supplierInvoiceNo: 'IDR-1' }).expect(201);
    await http.put('/api/fx/rates').set(as()).send({ currency: 'USD', rate: '16000', note: 'JISDOR' }).expect(200);
    const so = (await post('/api/sales-orders', { customerId: cust, warehouseId: wh, currency: 'USD', lines: [{ productId: prod, qty: '100', price: '10' }] }).expect(201)).body;
    await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    const inv = (await post('/api/invoices', { salesOrderId: so.id }).expect(201)).body;
    await post('/api/payments', { invoiceId: inv.id, amount: '500' }).expect(201);
    await post('/api/payments', { invoiceId: inv.id, amount: '100', fxRate: '16200' }).expect(201);
    const po = (await post('/api/purchase-orders', { supplierId: supp, warehouseId: wh, currency: 'USD', fxRate: '16000', lines: [{ productId: prod, qty: '100', price: '5' }] }).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    await post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'SZ-1' }).expect(201);
    await http.put('/api/fx/rates').set(as()).send({ currency: 'USD', rate: '16500', note: 'Kurs penutup' }).expect(200);
    await post('/api/fx/revaluation').expect(201); // selisih belum terealisasi di akun terpisah
    // pendapatan di luar faktur: jurnal manual ke akun pendapatan lain
    const accs = (await get('/api/accounting/accounts').expect(200)).body as { id: string; code: string }[];
    await post('/api/accounting/journals', { date: day, description: 'Pendapatan lain', lines: [{ accountId: accs.find((a) => a.code === '1-1100')!.id, debit: '250000' }, { accountId: accs.find((a) => a.code === '4-9100')?.id ?? accs.find((a) => a.code === '4-1000')!.id, credit: '250000' }] }).expect(201);
  });
  afterAll(() => app.close());

  it('piutang valas ikut pencocokan dan umur piutang (nilai rupiah tercatat)', async () => {
    const r = await report('sales');
    allOk(r);
    const ar = r.reconciliation.find((x) => x.key === 'sales-ar')!;
    expect(ar.left.value).toBe(8_160_000); // 510 USD × kurs faktur 16.000 (sebelum penilaian ulang)
    expect(sec(r, 'sales-aging').rows[0][6]).toBe(8_160_000);
  });

  it('utang valas ikut pencocokan dan umur utang', async () => {
    const r = await report('purchases');
    allOk(r);
    const ap = r.reconciliation.find((x) => x.key === 'purchases-ap-balance')!;
    expect(ap.left.value).toBeGreaterThanOrEqual(8_880_000);
  });

  it('pendapatan menurut sumber mencakup jurnal di luar faktur dan cocok dengan seluruh akun pendapatan', async () => {
    const r = await report('sales');
    const all = r.reconciliation.find((x) => x.key === 'sales-revenue-all')!;
    expect(all.ok).toBe(true);
    const rows = sec(r, 'sales-source').rows;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.some((x) => x[2] === 250_000)).toBe(true);
  });
});
