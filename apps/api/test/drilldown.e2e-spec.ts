/** Penelusuran: dari buku besar dan daftar jurnal ke dokumen asal (faktur, surat jalan, pembayaran) */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Penelusuran laporan → buku besar → jurnal → dokumen asal (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let invoiceId: string;
  let deliveryId: string;
  const as = () => ({ Authorization: `Bearer ${token}` });
  const get = (u: string) => http.get(u).set(as());
  const post = (u: string, b: object = {}) => http.post(u).set(as()).send(b);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (await http.post('/api/auth/register').send({ companyName: 'PT Telusur', name: 'P', email: `dd-${Date.now()}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    const wh = (await get('/api/warehouses').expect(200)).body[0].id;
    const productId = (await post('/api/products', { sku: 'DD-1', name: 'Barang', sellPrice: '20000' }).expect(201)).body.id;
    const sup = (await post('/api/suppliers', { code: 'S', name: 'Pemasok' }).expect(201)).body.id;
    const cust = (await post('/api/customers', { code: 'C', name: 'Pelanggan' }).expect(201)).body.id;
    const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: wh, lines: [{ productId, qty: '10', price: '10000' }] }).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    await post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'DD' }).expect(201);
    const so = (await post('/api/sales-orders', { customerId: cust, warehouseId: wh, lines: [{ productId, qty: '3' }] }).expect(201)).body;
    await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    deliveryId = (await post(`/api/sales-orders/${so.id}/deliver`).expect(201)).body.id;
    invoiceId = (await post('/api/invoices', { salesOrderId: so.id }).expect(201)).body.id;
    await post('/api/payments', { invoiceId, amount: '10000', method: 'TRANSFER' }).expect(201);
  });
  afterAll(() => app.close());

  const accountId = async (code: string) => ((await get('/api/accounting/accounts').expect(200)).body as { id: string; code: string }[]).find((a) => a.code === code)!.id;

  it('buku besar piutang: baris faktur membuka faktur, baris pembayaran membuka faktur yang dibayar', async () => {
    const led = (await get(`/api/accounting/reports/ledger?accountId=${await accountId('1-1300')}`).expect(200)).body;
    const byType = (t: string) => led.rows.find((r: { sourceType: string }) => r.sourceType === t);
    expect(byType('INVOICE').docRoute).toBe(`/invoices/${invoiceId}`);
    expect(byType('PAYMENT').docRoute).toBe(`/invoices/${invoiceId}`);
  });

  it('buku besar HPP: baris surat jalan membuka surat jalan', async () => {
    const led = (await get(`/api/accounting/reports/ledger?accountId=${await accountId('5-1000')}`).expect(200)).body;
    expect(led.rows.find((r: { sourceType: string }) => r.sourceType === 'DELIVERY').docRoute).toBe(`/deliveries/${deliveryId}`);
  });

  it('daftar dan rincian jurnal memuat dokumen asal; jurnal manual tidak punya', async () => {
    const list = (await get('/api/accounting/journals').expect(200)).body as { id: string; sourceType: string; docRoute: string | null }[];
    expect(list.find((j) => j.sourceType === 'INVOICE')!.docRoute).toBe(`/invoices/${invoiceId}`);
    const cash = await accountId('1-1100');
    const cap = await accountId('3-1000');
    const manual = (await post('/api/accounting/journals', { date: new Date().toISOString().slice(0, 10), description: 'Modal', lines: [{ accountId: cash, debit: '1000' }, { accountId: cap, credit: '1000' }] }).expect(201)).body;
    const detail = (await get(`/api/accounting/journals/${manual.id}`).expect(200)).body;
    expect(detail.docRoute).toBeNull();
    const inv = list.find((j) => j.sourceType === 'INVOICE')!;
    expect((await get(`/api/accounting/journals/${inv.id}`).expect(200)).body.docRoute).toBe(`/invoices/${invoiceId}`);
  });

  it('rincian laba rugi membawa id akun untuk membuka buku besar', async () => {
    const inc = (await get('/api/accounting/statements/income').expect(200)).body;
    const rev = inc.lines.find((l: { key: string }) => l.key === 'SALES_REVENUE');
    expect(rev.accounts.length).toBeGreaterThan(0);
    expect(rev.accounts[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  describe('dokumen per baris untuk pembelian, stok, kas, kasir, pajak, dan gaji', () => {
    const journalOf = async (source: string) => {
      const list = (await get('/api/accounting/journals?source=' + source).expect(200)).body as { id: string; sourceType: string; docRoute: string | null }[];
      expect(list.length).toBeGreaterThan(0);
      return list[0];
    };
    const documentOf = async (source: string) => {
      const j = await journalOf(source);
      expect(j.docRoute).toBe(`/documents/${j.id}`);
      return (await get(`/api/accounting/journals/${j.id}/document`).expect(200)).body as {
        journal: { sourceType: string };
        document: { title: string; number: string | null; fields: { label: string; value: string }[]; table: { rows: Record<string, string | null>[] } | null };
      };
    };

    beforeAll(async () => {
      // pembelian: bayar sebagian lalu retur; stok: penyesuaian + transfer; kas: masuk, keluar; kasir; pajak
      const invs = (await get('/api/purchase-invoices').expect(200)).body as { id: string; lines: { id: string }[] }[];
      const pi = (await get(`/api/purchase-invoices/${invs[0].id}`).expect(200)).body;
      await post('/api/purchase-invoices/payments', { purchaseInvoiceId: pi.id, amount: '10000' }).expect(201);
      await post('/api/purchase-returns', { invoiceId: pi.id, lines: [{ invoiceLineId: pi.lines[0].id, qty: '1' }] }).expect(201);
      const wh = (await get('/api/warehouses').expect(200)).body[0].id;
      const wh2 = (await post('/api/warehouses', { code: 'GDG-02', name: 'Gudang Dua' }).expect(201)).body.id;
      const productId = (await get('/api/products').expect(200)).body[0].id;
      await post('/api/inventory/adjustments', { warehouseId: wh, reason: 'OPENING', lines: [{ productId, qty: '1', unitCost: '10000' }] }).expect((r) => { if (![200, 201].includes(r.status)) throw new Error(JSON.stringify(r.body)); });
      const tr = await post('/api/inventory/transfers', { mode: 'IN_TRANSIT', fromWarehouseId: wh, toWarehouseId: wh2, lines: [{ productId, qty: '2' }] });
      expect([200, 201]).toContain(tr.status);
      const accs = (await get('/api/accounting/accounts').expect(200)).body as { id: string; code: string }[];
      const bank = accs.find((a) => a.code === '1-1200')!.id;
      const modal = accs.find((a) => a.code === '3-1000')!.id;
      const biaya = accs.find((a) => a.code === '6-9000')!.id;
      await post('/api/cash/transactions', { type: 'IN', cashAccountId: bank, date: new Date().toISOString().slice(0, 10), lines: [{ accountId: modal, amount: '500000' }], description: 'Setoran' }).expect(201);
      await post('/api/cash/transactions', { type: 'OUT', cashAccountId: bank, date: new Date().toISOString().slice(0, 10), lines: [{ accountId: biaya, amount: '30000' }], description: 'Biaya lain' }).expect(201);
    });

    it('faktur pembelian: pemasok, total, dan baris barang', async () => {
      const r = await documentOf('PURCHASE_INVOICE');
      expect(r.document.title).toBe('Faktur pembelian');
      expect(r.document.fields.map((f) => f.label)).toContain('Pemasok');
      expect(r.document.table!.rows.length).toBeGreaterThan(0);
    });
    it('pembayaran utang dan retur pembelian menunjuk faktur yang dibayar / diretur', async () => {
      const pay = await documentOf('SUPPLIER_PAYMENT');
      expect(pay.document.fields.find((f) => f.label === 'Faktur dibayar')!.value).toMatch(/^FB\//);
      const ret = await documentOf('PURCHASE_RETURN');
      expect(ret.document.fields.find((f) => f.label === 'Atas faktur')!.value).toMatch(/^FB\//);
      expect(ret.document.table!.rows).toHaveLength(1);
    });
    it('penyesuaian stok dan transfer menampilkan barang, gudang, dan nilai', async () => {
      const adj = await documentOf('STOCK_ADJUSTMENT');
      expect(adj.document.table!.rows.length).toBeGreaterThan(0);
      expect(adj.document.table!.rows[0].product).toMatch(/DD-1/);
      const trf = await documentOf('STOCK_TRANSFER');
      expect(trf.document.fields.map((f) => f.label)).toEqual(expect.arrayContaining(['Dari gudang', 'Ke gudang']));
    });
    it('kas masuk dan keluar menampilkan akun kas dan akun lawan', async () => {
      const kas = await documentOf('CASH_IN');
      expect(kas.document.title).toBe('Kas masuk');
      expect(kas.document.table!.rows[0].account).toMatch(/3-1000/);
      expect((await documentOf('CASH_OUT')).document.title).toBe('Kas keluar');
    });
    it('jurnal manual tidak punya dokumen, tetapi rincian jurnalnya tetap bisa dibuka', async () => {
      const m = await journalOf('MANUAL');
      expect(m.docRoute).toBeNull();
      const r = (await get(`/api/accounting/journals/${m.id}/document`).expect(200)).body;
      expect(r.document).toBeNull();
      expect(r.journal.lines.length).toBeGreaterThan(1);
    });
    it('dokumen milik perusahaan lain tidak bisa dibuka', async () => {
      const other = (await http.post('/api/auth/register').send({ companyName: 'PT Lain', name: 'P', email: `dd2-${Date.now()}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
      const j = await journalOf('PURCHASE_INVOICE');
      await http.get(`/api/accounting/journals/${j.id}/document`).set({ Authorization: `Bearer ${other}` }).expect(404);
    });
  });
});
