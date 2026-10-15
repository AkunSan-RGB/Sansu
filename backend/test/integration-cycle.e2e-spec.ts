/**
 * Keterpaduan modul per jenis usaha. Setiap jenis usaha menjalankan siklus bisnisnya yang khas, lalu semua laporan dan
 * daftar pendukung dicocokkan satu sama lain setelah setiap tahap:
 *   neraca saldo = neraca, laba rugi resmi = ringkas, arus kas = saldo kas, piutang/utang buku besar = daftar per
 *   pelanggan/pemasok, persediaan buku besar = nilai stok, cek kesehatan tanpa ERROR.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';

const today = todayJakarta();
const n = (v: unknown) => Number(v ?? 0);

describe('Keterpaduan modul per jenis usaha (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  type Co = Awaited<ReturnType<typeof company>>;
  async function company(model: 'DAGANG' | 'RITEL' | 'JASA' | 'FMCG' | 'MANUFAKTUR') {
    const token = (await http.post('/api/auth/register').send({ companyName: `Siklus ${model}`, name: 'Pemilik', email: `cyc-${model}-${stamp}@uji.id`, password: 'rahasia123', businessModel: model }).expect(201)).body.accessToken;
    const as = () => ({ Authorization: `Bearer ${token}` });
    const get = (u: string) => http.get(u).set(as());
    const post = (u: string, b: object = {}) => http.post(u).set(as()).send(b);
    const accounts = (await get('/api/accounting/accounts').expect(200)).body as { id: string; code: string }[];
    const acc = (c: string) => accounts.find((a) => a.code === c)!.id;
    const warehouseId = (await get('/api/warehouses').expect(200)).body[0].id as string;
    // modal awal agar kas tidak minus dan ekuitas positif (cek kesehatan)
    await post('/api/accounting/journals', { date: today, description: 'Setoran modal', lines: [{ accountId: acc('1-1200'), debit: '500000000' }, { accountId: acc('3-1000'), credit: '500000000' }] }).expect(201);

    /** Semua laporan dan daftar pendukung harus saling cocok */
    async function reconcile(label: string) {
      const trial = (await get('/api/accounting/reports/trial-balance').expect(200)).body;
      const bal = (code: string) => n(trial.rows.find((x: { code: string }) => x.code === code)?.balance);
      expect({ label, balanced: trial.balanced }).toEqual({ label, balanced: true });
      const bs = (await get('/api/accounting/statements/financial-position').expect(200)).body;
      expect({ label, balanced: bs.balanced }).toEqual({ label, balanced: true });
      const inc = (await get('/api/accounting/statements/income').expect(200)).body;
      const pl = (await get('/api/accounting/reports/profit-loss').expect(200)).body;
      const plNet = n(pl.netIncome);
      expect({ label, laba: n(inc.netProfit) }).toEqual({ label, laba: plNet });
      const cf = (await get('/api/accounting/statements/cash-flow').expect(200)).body;
      expect({ label, selisihKas: n(cf.current.difference) }).toEqual({ label, selisihKas: 0 });
      let ar = 0;
      for (const c of (await get('/api/customers').expect(200)).body as { id: string }[]) ar += n((await get(`/api/customers/${c.id}`).expect(200)).body.outstanding);
      expect({ label, piutang: bal('1-1300') }).toEqual({ label, piutang: ar });
      let ap = 0;
      for (const s of (await get('/api/suppliers').expect(200)).body as { id: string }[]) ap += n((await get(`/api/suppliers/${s.id}`).expect(200)).body.outstanding);
      expect({ label, utang: bal('2-1100') }).toEqual({ label, utang: ap });
      const dash = (await get('/api/dashboard').expect(200)).body;
      if (dash.stockValue !== null && dash.stockValue !== undefined) expect({ label, persediaan: bal('1-1400') + bal('1-1410') }).toEqual({ label, persediaan: n(dash.stockValue) });
      // setiap jurnal bisa ditelusuri: dokumen asal yang dijanjikan rutenya memang bisa dimuat
      const journals = (await get('/api/accounting/journals').expect(200)).body as { id: string; sourceType: string; docRoute: string | null }[];
      for (const j of journals) {
        const doc = await get(`/api/accounting/journals/${j.id}/document`).expect(200);
        if (j.docRoute?.startsWith('/documents/')) expect({ label, source: j.sourceType, hasDocument: !!doc.body.document }).toEqual({ label, source: j.sourceType, hasDocument: true });
      }
      const health = (await get('/api/accounting/health').expect(200)).body.checks as { key: string; status: string; title: string }[];
      expect({ label, errors: health.filter((c) => c.status === 'ERROR').map((c) => `${c.key}: ${c.title}`) }).toEqual({ label, errors: [] });
      return { bal, inc, dash };
    }
    return { token, as, get, post, acc, warehouseId, reconcile };
  }

  async function stockUp(c: Co, sku: string, qty: string, price: string) {
    const sup = (await c.post('/api/suppliers', { code: `S-${sku}`, name: `Pemasok ${sku}`, paymentTermDays: 14 }).expect(201)).body.id;
    const productId = (await c.post('/api/products', { sku, name: `Barang ${sku}`, sellPrice: '20000' }).expect(201)).body.id;
    const po = (await c.post('/api/purchase-orders', { supplierId: sup, warehouseId: c.warehouseId, lines: [{ productId, qty, price }] }).expect(201)).body;
    await c.post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    const pi = (await c.post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: `INV-${sku}` }).expect(201)).body;
    return { productId, pi };
  }

  it('DAGANG: beli → bayar sebagian → kirim → faktur → terima → retur → laporan cocok', async () => {
    const c = await company('DAGANG');
    const { productId, pi } = await stockUp(c, 'DG-1', '100', '10000');
    await c.reconcile('setelah pembelian');
    await c.post('/api/purchase-invoices/payments', { purchaseInvoiceId: pi.id, amount: '400000' }).expect(201);
    const cust = (await c.post('/api/customers', { code: 'TK-1', name: 'Toko Satu', paymentTermDays: 30 }).expect(201)).body.id;
    const so = (await c.post('/api/sales-orders', { customerId: cust, warehouseId: c.warehouseId, lines: [{ productId, qty: '30' }] }).expect(201)).body;
    await c.post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    await c.post(`/api/sales-orders/${so.id}/deliver`).expect(201);
    await c.reconcile('setelah surat jalan');
    const inv = (await c.post('/api/invoices', { salesOrderId: so.id }).expect(201)).body;
    await c.reconcile('setelah faktur');
    await c.post('/api/payments', { invoiceId: inv.id, amount: '300000', method: 'TRANSFER' }).expect(201);
    await c.post('/api/sales-returns', { invoiceId: inv.id, lines: [{ invoiceLineId: inv.lines[0].id, qty: '2' }] }).expect(201);
    const r = await c.reconcile('setelah pembayaran dan retur');
    expect(r.bal('4-1000')).toBeGreaterThan(0);
    expect(r.bal('5-1000')).toBeGreaterThan(0);
  });

  it('RITEL: beli stok → kasir → tutup sesi → laporan cocok', async () => {
    const c = await company('RITEL');
    const { productId } = await stockUp(c, 'RT-1', '50', '8000');
    await c.reconcile('setelah pembelian');
    const sessionId = (await c.post('/api/pos/sessions', { warehouseId: c.warehouseId, openingCash: '100000' }).expect(201)).body.id;
    for (const qty of ['2', '3', '1']) await c.post('/api/pos/orders', { sessionId, lines: [{ productId, qty }], payments: [{ method: 'CASH', amount: String(Number(qty) * 22200) }] }).expect(201);
    await c.reconcile('setelah penjualan kasir');
    const close = await c.post(`/api/pos/sessions/${sessionId}/close`, { countedCash: String(100000 + 6 * 22200) });
    expect([200, 201]).toContain(close.status);
    const r = await c.reconcile('setelah tutup kasir');
    expect(r.bal('4-1000')).toBeGreaterThan(0);
    expect(r.bal('2-1200')).toBeGreaterThan(0);
  });

  it('JASA: proyek → uang muka → faktur termin ber-PPh 23 → pakai uang muka → tagihan pemasok ber-PPh 23 → laporan cocok', async () => {
    const c = await company('JASA');
    await http.patch('/api/settings/company').set(c.as()).send({ npwp: '0123456789012345' }).expect(200);
    const cust = (await c.post('/api/customers', { code: 'PT-JS', name: 'PT Klien', npwp: '0987654321098765', paymentTermDays: 30 }).expect(201)).body.id;
    const prj = (await c.post('/api/services/projects', { name: 'Konsultasi', customerId: cust, contractValue: '50000000', startDate: today }).expect(201)).body;
    const dep = (await c.post('/api/services/deposits', { customerId: cust, projectId: prj.id, date: today, amount: '11100000', description: 'DP' }).expect(201)).body;
    await c.reconcile('setelah uang muka');
    const inv = (await c.post('/api/services/invoices', { customerId: cust, projectId: prj.id, date: today, withholdingType: 'PPH23', lines: [{ description: 'Jasa konsultasi', price: '20000000' }] }).expect(201)).body;
    await c.post(`/api/services/deposits/${dep.id}/apply`, { invoiceId: inv.id }).expect(201);
    await c.reconcile('setelah faktur dan uang muka dipakai');
    const sup = (await c.post('/api/suppliers', { code: 'S-JS', name: 'CV Tenaga Ahli', npwp: '0123456789012345' }).expect(201)).body.id;
    await c.post('/api/purchase-invoices/bills', { supplierId: sup, supplierInvoiceNo: 'TA-1', date: today, withholdingType: 'PPH23', lines: [{ type: 'EXPENSE', description: 'Jasa tenaga ahli', price: '5000000', accountId: c.acc('5-1800'), withholding: true }] }).expect(201);
    const r = await c.reconcile('setelah tagihan pemasok');
    expect(r.bal('1-1510')).toBeGreaterThan(0); // PPh 23 dipotong pelanggan
    expect(r.bal('2-1320')).toBeGreaterThan(0); // PPh 23 yang kita potong
    expect(r.bal('1-1400')).toBe(0); // usaha jasa tidak punya persediaan
  });

  it.each(['MANUFAKTUR'] as const)('%s: bahan → resep → produksi → jual hasil → laporan cocok', async (model) => {
    const c = await company(model);
    const sup = (await c.post('/api/suppliers', { code: 'S-PR', name: 'Toko Bahan' }).expect(201)).body.id;
    const bahan = (await c.post('/api/products', { sku: 'BHN', name: 'Bahan', baseUom: 'M', sellPrice: '0' }).expect(201)).body.id;
    const jadi = (await c.post('/api/products', { sku: 'JDI', name: 'Produk jadi', sellPrice: '90000' }).expect(201)).body.id;
    const po = (await c.post('/api/purchase-orders', { supplierId: sup, warehouseId: c.warehouseId, lines: [{ productId: bahan, qty: '100', price: '20000' }] }).expect(201)).body;
    await c.post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    await c.post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'BHN-1' }).expect(201);
    await c.reconcile('setelah beli bahan');
    const bom = (await c.post('/api/production/boms', { name: 'Produk jadi', productId: jadi, outputQty: '10', laborCost: '100000', overheadCost: '50000', lines: [{ productId: bahan, qty: '15' }] }).expect(201)).body;
    const order = (await c.post('/api/production/orders', { bomId: bom.id, warehouseId: c.warehouseId, batches: '2', date: today }).expect(201)).body;
    await c.post(`/api/production/orders/${order.id}/start`, { date: today }).expect(201);
    await c.reconcile('produksi berjalan (barang dalam proses)');
    await c.post(`/api/production/orders/${order.id}/complete`, { date: today, outputQty: '20' }).expect(201);
    await c.reconcile('setelah produksi selesai');
    const cust = (await c.post('/api/customers', { code: 'TK-PR', name: 'Pembeli', paymentTermDays: 14 }).expect(201)).body.id;
    const so = (await c.post('/api/sales-orders', { customerId: cust, warehouseId: c.warehouseId, lines: [{ productId: jadi, qty: '8' }] }).expect(201)).body;
    await c.post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    await c.post(`/api/sales-orders/${so.id}/deliver`).expect(201);
    await c.post('/api/invoices', { salesOrderId: so.id }).expect(201);
    const r = await c.reconcile('setelah menjual hasil produksi');
    expect(r.bal('1-1420')).toBe(0); // barang dalam proses habis
    expect(r.bal('5-1000')).toBeGreaterThan(0);
  });
});
