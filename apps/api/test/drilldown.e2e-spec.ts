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
});
