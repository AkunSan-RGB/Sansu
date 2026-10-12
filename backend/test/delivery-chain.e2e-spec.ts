/**
 * Rantai dokumen penjualan ujung ke ujung:
 *   penawaran → pesanan → surat jalan → faktur → pembayaran → jurnal & laporan
 * Satu dokumen melahirkan dokumen berikutnya tanpa input ulang; stok, HPP, piutang, dan laporan tetap cocok.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Rantai dokumen: penawaran → pesanan → surat jalan → faktur → pembayaran (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let warehouseId: string;
  let productId: string;
  let customerId: string;
  const stamp = Date.now();
  const as = () => ({ Authorization: `Bearer ${token}` });
  const get = (u: string) => http.get(u).set(as());
  const post = (u: string, b: object = {}) => http.post(u).set(as()).send(b);
  const stockQty = async () => Number((await get(`/api/inventory/balances?productId=${productId}`).expect(200)).body[0].qty);
  const bal = async (code: string) => {
    const tb = (await get('/api/accounting/reports/trial-balance').expect(200)).body;
    expect(tb.balanced).toBe(true);
    return Number(tb.rows.find((x: { code: string }) => x.code === code)?.balance ?? 0);
  };
  /** Persediaan di buku besar = nilai stok (dashboard) */
  const expectInventoryMatches = async () => {
    const dash = (await get('/api/dashboard').expect(200)).body;
    expect((await bal('1-1400')) + (await bal('1-1410'))).toBeCloseTo(Number(dash.stockValue), 2);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (await http.post('/api/auth/register').send({ companyName: 'PT Rantai Dokumen', name: 'Pemilik', email: `chain-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    warehouseId = (await get('/api/warehouses').expect(200)).body[0].id;
    productId = (await post('/api/products', { sku: 'CH-1', name: 'Barang Rantai', sellPrice: '20000' }).expect(201)).body.id;
    const sup = (await post('/api/suppliers', { code: 'S-CH', name: 'Pemasok' }).expect(201)).body.id;
    customerId = (await post('/api/customers', { code: 'C-CH', name: 'Pelanggan Rantai', paymentTermDays: 30 }).expect(201)).body.id;
    const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId, lines: [{ productId, qty: '100', price: '10000' }] }).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    await post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: 'CH-1' }).expect(201);
    await post('/api/apps/crm/install').expect(201);
  });
  afterAll(() => app.close());

  let orderId: string;
  let deliveryId: string;
  let invoiceId: string;

  it('penawaran → pesanan: pesanan lahir dari penawaran tanpa input ulang', async () => {
    const q = (await post('/api/crm/quotations', { customerId, warehouseId, lines: [{ productId, qty: '10', price: '20000' }] }).expect(201)).body;
    const conv = (await post(`/api/crm/quotations/${q.id}/convert`).expect(201)).body;
    orderId = conv.salesOrder.id;
    expect(conv.salesOrder.total).toBe(q.total);
    await post(`/api/sales-orders/${orderId}/confirm`).expect(201);
  });

  it('surat jalan: stok keluar dan HPP dijurnal, belum ada piutang atau penjualan', async () => {
    expect(await stockQty()).toBe(100);
    const d = (await post(`/api/sales-orders/${orderId}/deliver`, { notes: 'Dikirim pagi' }).expect(201)).body;
    deliveryId = d.id;
    expect(d.number).toMatch(/^SJ\//);
    expect(d.cogsAmount).toBe('100000.00'); // 10 × 10.000
    expect(await stockQty()).toBe(90);
    expect(await bal('5-1000')).toBe(100000);
    expect(await bal('1-1300')).toBe(0);
    expect(await bal('4-1000')).toBe(0);
    expect((await get(`/api/sales-orders/${orderId}`).expect(200)).body.status).toBe('DELIVERED');
    await expectInventoryMatches();
    // tidak bisa dikirim dua kali, tidak bisa dibatalkan sebagai pesanan sebelum surat jalan dibatalkan
    await post(`/api/sales-orders/${orderId}/deliver`).expect(400);
    await post(`/api/sales-orders/${orderId}/cancel`).expect(400);
  });

  it('faktur dari surat jalan: hanya piutang, penjualan, PPN; stok dan HPP tidak dihitung dua kali', async () => {
    const inv = (await post('/api/invoices', { salesOrderId: orderId }).expect(201)).body;
    invoiceId = inv.id;
    expect(inv.total).toBe('222000.00');
    expect(await stockQty()).toBe(90);
    expect(await bal('5-1000')).toBe(100000);
    expect(await bal('1-1300')).toBe(222000);
    expect(await bal('4-1000')).toBe(200000);
    expect(await bal('2-1200')).toBe(22000);
    const d = (await get(`/api/deliveries/${deliveryId}`).expect(200)).body;
    expect(d.invoice.id).toBe(invoiceId);
    expect((await get(`/api/sales-orders/${orderId}`).expect(200)).body.status).toBe('INVOICED');
    await post(`/api/deliveries/${deliveryId}/cancel`).expect(400); // sudah difakturkan
    await expectInventoryMatches();
  });

  it('pembayaran lalu retur: harga pokok retur mengikuti surat jalan', async () => {
    await post('/api/payments', { invoiceId, amount: '100000', method: 'TRANSFER' }).expect(201);
    const inv = (await get(`/api/invoices/${invoiceId}`).expect(200)).body;
    await post('/api/sales-returns', { invoiceId, lines: [{ invoiceLineId: inv.lines[0].id, qty: '2' }] }).expect(201);
    expect(await stockQty()).toBe(92);
    expect(await bal('1-1300')).toBeCloseTo(222000 - 100000 - 44400, 2);
    await expectInventoryMatches();
  });

  it('jejak dokumen dari pesanan maupun faktur memuat seluruh rantai sampai jurnal', async () => {
    for (const url of [`/api/sales-orders/${orderId}/chain`, `/api/invoices/${invoiceId}/chain`]) {
      const c = (await get(url).expect(200)).body;
      expect(c.quotation.number).toMatch(/^SQ\//);
      expect(c.order.number).toMatch(/^SO\//);
      expect(c.deliveries).toHaveLength(1);
      expect(c.deliveries[0].number).toMatch(/^SJ\//);
      expect(c.invoice.number).toMatch(/^INV\//);
      expect(c.payments).toHaveLength(1);
      expect(c.returns).toHaveLength(1);
      expect(c.journals.map((j: { source_type: string }) => j.source_type).sort()).toEqual(['DELIVERY', 'INVOICE', 'PAYMENT', 'SALES_RETURN'].sort());
    }
  });

  it('batalkan surat jalan yang belum difakturkan: stok kembali, HPP dibalik, pesanan bisa dikirim ulang', async () => {
    const so = (await post('/api/sales-orders', { customerId, warehouseId, lines: [{ productId, qty: '5', price: '20000' }] }).expect(201)).body;
    await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    const before = { stock: await stockQty(), cogs: await bal('5-1000') };
    const d = (await post(`/api/sales-orders/${so.id}/deliver`).expect(201)).body;
    expect(await stockQty()).toBe(before.stock - 5);
    await post(`/api/deliveries/${d.id}/cancel`).expect(201);
    expect(await stockQty()).toBe(before.stock);
    expect(await bal('5-1000')).toBeCloseTo(before.cogs, 2);
    expect((await get(`/api/sales-orders/${so.id}`).expect(200)).body.status).toBe('CONFIRMED');
    await post(`/api/deliveries/${d.id}/cancel`).expect(400); // sudah dibatalkan
    await expectInventoryMatches();
    // kirim ulang dan faktur
    await post(`/api/sales-orders/${so.id}/deliver`).expect(201);
    await post('/api/invoices', { salesOrderId: so.id }).expect(201);
    await expectInventoryMatches();
  });

  it('langsung faktur tetap bisa: surat jalan dibuat otomatis dan terkait faktur', async () => {
    const so = (await post('/api/sales-orders', { customerId, warehouseId, lines: [{ productId, qty: '3', price: '20000' }] }).expect(201)).body;
    await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    const inv = (await post('/api/invoices', { salesOrderId: so.id }).expect(201)).body;
    const c = (await get(`/api/invoices/${inv.id}/chain`).expect(200)).body;
    expect(c.deliveries).toHaveLength(1);
    expect(c.deliveries[0].journal_id).toBeNull(); // jurnal HPP ada di faktur
    const list = (await get('/api/deliveries').expect(200)).body as { invoice: { id: string } | null }[];
    expect(list.filter((x) => x.invoice?.id === inv.id)).toHaveLength(1);
    await expectInventoryMatches();
    const health = (await get('/api/accounting/health').expect(200)).body.checks as { key: string; status: string }[];
    expect(health.filter((h) => h.status === 'ERROR')).toEqual([]);
  });
});
