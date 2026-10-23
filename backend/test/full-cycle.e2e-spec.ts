/**
 * Siklus akuntansi lengkap (e2e, PostgreSQL sungguhan):
 * beli → bayar hutang → retur beli → jual → retur jual → terima piutang → kas & bank
 * → buku besar, arus kas, PPN → kunci periode → tutup buku tahunan.
 * Setelah setiap tahap, neraca saldo dan neraca harus tetap seimbang.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta, addDays } from '../src/common/utils/dates';
import { closeYearLater } from './close-year-helper';

describe('Siklus akuntansi lengkap (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let warehouseId: string;
  let productId: string;
  let supplierId: string;
  let customerId: string;
  let accounts: { id: string; code: string; systemKey: string | null; isCashAccount: boolean }[];
  const acc = (code: string) => accounts.find((a) => a.code === code)!.id;
  const today = todayJakarta();

  const get = (url: string) => http.get(url).set({ Authorization: `Bearer ${token}` });
  const post = (url: string, body: object = {}) => http.post(url).set({ Authorization: `Bearer ${token}` }).send(body);
  const stockQty = async () => Number((await get(`/api/inventory/balances?productId=${productId}`)).body[0].qty);
  const expectBalanced = async () => {
    const tb = await get('/api/accounting/reports/trial-balance').expect(200);
    expect(tb.body.balanced).toBe(true);
    const bs = await get('/api/accounting/reports/balance-sheet').expect(200);
    expect(bs.body.balanced).toBe(true);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());

    const reg = await http
      .post('/api/auth/register')
      .send({ companyName: 'PT Siklus Lengkap', name: 'Pemilik', email: `siklus-${Date.now()}@uji.id`, password: 'rahasia123' })
      .expect(201);
    token = reg.body.accessToken;
    warehouseId = (await get('/api/warehouses')).body[0].id;
    accounts = (await get('/api/accounting/accounts')).body;
    productId = (
      await post('/api/products', { sku: 'SKL-01', name: 'Produk Siklus', sellPrice: '7000', uoms: [{ uom: 'DUS', factor: '24' }] }).expect(201)
    ).body.id;
    supplierId = (await post('/api/suppliers', { code: 'SUP-01', name: 'PT Pemasok', paymentTermDays: 30 }).expect(201)).body.id;
    customerId = (await post('/api/customers', { code: 'TK-01', name: 'Toko Satu', paymentTermDays: 30 }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('akun Kas & Bank otomatis bertanda akun kas', () => {
    expect(accounts.filter((a) => a.isCashAccount).map((a) => a.code).sort()).toEqual(['1-1100', '1-1110', '1-1200']);
  });

  let purchaseInvoiceId: string;
  let piLineId: string;
  it('PO → konfirmasi → faktur pembelian: stok masuk, HPP, jurnal hutang + PPN masukan', async () => {
    const po = await post('/api/purchase-orders', {
      supplierId,
      warehouseId,
      lines: [{ productId, uom: 'DUS', qty: '10', price: '120000' }],
    }).expect(201);
    expect(po.body.total).toBe('1332000.00');
    await post('/api/purchase-invoices', { purchaseOrderId: po.body.id, supplierInvoiceNo: 'X-1' }).expect(400); // belum konfirmasi
    await post(`/api/purchase-orders/${po.body.id}/confirm`).expect(201);

    const pi = await post('/api/purchase-invoices', { purchaseOrderId: po.body.id, supplierInvoiceNo: 'SPP/001' }).expect(201);
    purchaseInvoiceId = pi.body.id;
    piLineId = pi.body.lines[0].id;
    expect(pi.body.number).toMatch(/^FB\//);
    expect(pi.body.dueDate).toBe(addDays(today, 30));
    expect(await stockQty()).toBe(240);
    const bal = (await get(`/api/inventory/balances?productId=${productId}`)).body[0];
    expect(Number(bal.avgCost)).toBe(5000);

    await post('/api/purchase-invoices', { purchaseOrderId: po.body.id, supplierInvoiceNo: 'SPP/002' }).expect(400);
    const sup = await get(`/api/suppliers/${supplierId}`).expect(200);
    expect(sup.body.outstanding).toBe('1332000.00');
    await expectBalanced();
  });

  it('bayar hutang sebagian dari Bank; kelebihan bayar ditolak', async () => {
    const pay = await post('/api/purchase-invoices/payments', { purchaseInvoiceId, amount: '500000' }).expect(201);
    expect(pay.body.number).toMatch(/^BH\//);
    await post('/api/purchase-invoices/payments', { purchaseInvoiceId, amount: '900000' }).expect(400);
    const pi = await get(`/api/purchase-invoices/${purchaseInvoiceId}`).expect(200);
    expect(pi.body.status).toBe('PARTIAL');
    await expectBalanced();
  });

  it('retur pembelian 1 DUS: stok keluar, hutang & PPN masukan berkurang', async () => {
    const ret = await post('/api/purchase-returns', {
      invoiceId: purchaseInvoiceId,
      reason: 'Kemasan rusak',
      lines: [{ invoiceLineId: piLineId, qty: '1' }],
    }).expect(201);
    expect(ret.body.total).toBe('133200.00');
    expect(await stockQty()).toBe(216);
    await post('/api/purchase-returns', { invoiceId: purchaseInvoiceId, lines: [{ invoiceLineId: piLineId, qty: '10' }] }).expect(400);
    const sup = await get(`/api/suppliers/${supplierId}`).expect(200);
    expect(sup.body.outstanding).toBe('698800.00'); // 1.332.000 - 500.000 - 133.200
    await expectBalanced();
  });

  let invoiceId: string;
  let invLineId: string;
  it('jual 5 DUS lalu retur 1 DUS: stok kembali, piutang & PPN keluaran berkurang', async () => {
    const so = await post('/api/sales-orders', { customerId, warehouseId, lines: [{ productId, uom: 'DUS', qty: '5' }] }).expect(201);
    await post(`/api/sales-orders/${so.body.id}/confirm`).expect(201);
    const inv = await post('/api/invoices', { salesOrderId: so.body.id }).expect(201);
    invoiceId = inv.body.id;
    invLineId = inv.body.lines[0].id;
    expect(inv.body.total).toBe('932400.00'); // 840.000 + 92.400
    expect(await stockQty()).toBe(96);

    const ret = await post('/api/sales-returns', { invoiceId, lines: [{ invoiceLineId: invLineId, qty: '1' }] }).expect(201);
    expect(ret.body.total).toBe('186480.00');
    expect(await stockQty()).toBe(120);
    await post('/api/sales-returns', { invoiceId, lines: [{ invoiceLineId: invLineId, qty: '5' }] }).expect(400);

    const after = await get(`/api/invoices/${invoiceId}`).expect(200);
    expect(after.body.returnedAmount).toBe('186480.00');
    const cust = await get(`/api/customers/${customerId}`).expect(200);
    expect(cust.body.outstanding).toBe('745920.00');

    const pl = await get('/api/accounting/reports/profit-loss').expect(200);
    const salesReturn = pl.body.revenue.find((r: any) => r.code === '4-1100');
    expect(Number(salesReturn.balance)).toBe(-168000);
    await expectBalanced();
  });

  let bankId: string;
  it('kas & bank: setoran modal, bayar listrik, transfer, terima piutang ke Bank', async () => {
    const kasId = acc('1-1100');
    bankId = acc('1-1200');
    await post('/api/cash/transactions', {
      type: 'IN',
      cashAccountId: kasId,
      description: 'Setoran modal awal',
      lines: [{ accountId: acc('3-1000'), amount: '10000000' }],
    }).expect(201);
    await post('/api/cash/transactions', {
      type: 'OUT',
      cashAccountId: kasId,
      description: 'Bayar listrik gudang',
      lines: [{ accountId: acc('6-4000'), amount: '350000' }],
    }).expect(201);
    await post('/api/cash/transactions', {
      type: 'TRANSFER',
      cashAccountId: kasId,
      toCashAccountId: bankId,
      amount: '2000000',
      description: 'Setor ke bank',
    }).expect(201);
    // Piutang tidak boleh lewat kas umum
    await post('/api/cash/transactions', {
      type: 'IN',
      cashAccountId: kasId,
      description: 'salah',
      lines: [{ accountId: acc('1-1300'), amount: '1' }],
    }).expect(400);

    await post('/api/payments', { invoiceId, amount: '745920', cashAccountId: bankId }).expect(201);
    expect((await get(`/api/invoices/${invoiceId}`)).body.status).toBe('PAID');

    const cash = (await get('/api/cash/accounts').expect(200)).body;
    const kas = cash.find((c: any) => c.code === '1-1100');
    const bank = cash.find((c: any) => c.code === '1-1200');
    expect(kas.balance).toBe('7650000.00'); // 10.000.000 - 350.000 - 2.000.000
    expect(bank.balance).toBe('2245920.00'); // 2.000.000 + 745.920 - 500.000
    await expectBalanced();
  });

  it('buku besar Bank: saldo berjalan sama dengan saldo akun', async () => {
    const led = await get(`/api/accounting/reports/ledger?accountId=${bankId}`).expect(200);
    expect(led.body.rows).toHaveLength(3);
    expect(led.body.closing).toBe('2245920.00');
    expect(led.body.rows.at(-1).balance).toBe('2245920.00');
  });

  it('arus kas: saldo akhir = total kas & bank; modal masuk sebagai pendanaan', async () => {
    const cf = await get('/api/accounting/reports/cash-flow').expect(200);
    expect(cf.body.closing).toBe('9895920.00');
    expect(cf.body.financing.total).toBe('10000000.00');
    expect(cf.body.operating.total).toBe('-104080.00'); // 745.920 - 500.000 - 350.000
  });

  it('laporan PPN: keluaran - masukan setelah retur', async () => {
    const vat = await get('/api/accounting/reports/vat').expect(200);
    expect(vat.body.vatOut).toBe('73920.00'); // 92.400 - 18.480
    expect(vat.body.vatIn).toBe('118800.00'); // 132.000 - 13.200
    expect(vat.body.net).toBe('-44880.00');
    expect(vat.body.status).toBe('LEBIH_BAYAR');
    expect(vat.body.documents).toHaveLength(4);
  });

  it('saldo awal akun: diseimbangkan ke Ekuitas Saldo Awal; persediaan ditolak', async () => {
    await post('/api/accounting/opening-balances', {
      date: addDays(today, -1),
      lines: [{ accountId: acc('1-1400'), debit: '1000' }],
    }).expect(400);
    const ob = await post('/api/accounting/opening-balances', {
      date: addDays(today, -1),
      lines: [{ accountId: acc('1-2100'), debit: '50000000' }],
    }).expect(201);
    expect(ob.body.lines).toHaveLength(2);
    await expectBalanced();
  });

  it('kunci periode menolak transaksi; hanya Pemilik bisa membuka', async () => {
    await post('/api/accounting/period/lock', { until: today }).expect(201);
    const blocked = await post('/api/cash/transactions', {
      type: 'OUT',
      cashAccountId: acc('1-1100'),
      description: 'Setelah dikunci',
      lines: [{ accountId: acc('6-9000'), amount: '1000' }],
    }).expect(400);
    expect(blocked.body.message).toContain('sudah ditutup');

    const email = `fin-${Date.now()}@uji.id`;
    await post('/api/users', { name: 'Keuangan', email, password: 'rahasia123', role: 'FINANCE' }).expect(201);
    const fin = (await http.post('/api/auth/login').send({ email, password: 'rahasia123' }).expect(200)).body.accessToken;
    await http
      .post('/api/accounting/period/lock')
      .set({ Authorization: `Bearer ${fin}` })
      .send({ until: addDays(today, -1) })
      .expect(403);

    await post('/api/accounting/period/lock', { until: addDays(today, -1) }).expect(201);
  });

  it('tutup buku tahunan: laba ke Laba Ditahan, laba rugi tetap terbaca, neraca seimbang', async () => {
    const year = Number(today.slice(0, 4));
    const before = await get(`/api/accounting/reports/profit-loss?from=${year}-01-01&to=${year}-12-31`).expect(200);

    const res = await closeYearLater(app, token, year);
    expect(res.status).toBe(201);
    // tahun berjalan belum berakhir: ditolak lewat API
    expect((await post('/api/accounting/period/close-year', { year }).expect(400)).body.message).toContain('belum berakhir');
    expect(Number(res.body.netIncome)).toBe(Number(before.body.netIncome));
    expect(Number(res.body.netIncome)).toBe(-158000); // 672.000 penjualan bersih - 480.000 HPP - 350.000 listrik
    expect(res.body.lockedUntil).toBe(`${year}-12-31`);

    const after = await get(`/api/accounting/reports/profit-loss?from=${year}-01-01&to=${year}-12-31`).expect(200);
    expect(Number(after.body.netIncome)).toBe(Number(before.body.netIncome));

    const bs = await get('/api/accounting/reports/balance-sheet').expect(200);
    expect(bs.body.balanced).toBe(true);
    expect(Number(bs.body.currentEarnings)).toBe(0);
    const retained = bs.body.equity.find((e: any) => e.code === '3-2000');
    expect(Number(retained.balance)).toBe(Number(before.body.netIncome));

    expect((await closeYearLater(app, token, year)).status).toBe(400);
    await expectBalanced();
  });
});
