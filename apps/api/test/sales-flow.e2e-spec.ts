/**
 * Test end-to-end alur inti: saldo awal → sales order → faktur → pembayaran → laporan.
 * Berjalan terhadap PostgreSQL sungguhan (database akurata_test), bukan mock.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Alur penjualan distributor (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let warehouseId: string;
  let productId: string;
  let customerId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const get = (url: string, t = token) => http.get(url).set({ Authorization: `Bearer ${t}` });
  const post = (url: string, body: object = {}, t = token) =>
    http.post(url).set({ Authorization: `Bearer ${t}` }).send(body);

  const stockOf = async (pid = productId) => {
    const res = await get(`/api/inventory/balances?productId=${pid}`).expect(200);
    return res.body[0];
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());

    const reg = await http
      .post('/api/auth/register')
      .send({ companyName: 'PT Uji Distribusi', name: 'Pemilik', email: `owner-${Date.now()}@uji.id`, password: 'rahasia123' })
      .expect(201);
    token = reg.body.accessToken;

    const whs = await get('/api/warehouses').expect(200);
    warehouseId = whs.body[0].id;

    const prod = await post('/api/products', {
      sku: 'uji-001',
      name: 'Produk Uji',
      sellPrice: '7000',
      uoms: [{ uom: 'DUS', factor: '24' }],
    }).expect(201);
    productId = prod.body.id;
    expect(prod.body.sku).toBe('UJI-001');

    const cust = await post('/api/customers', {
      code: 'TK-UJI',
      name: 'Toko Uji',
      creditLimit: '1000000',
      paymentTermDays: 30,
    }).expect(201);
    customerId = cust.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('menolak request tanpa token', async () => {
    await http.get('/api/products').expect(401);
  });

  it('saldo awal stok membuat kartu stok dan jurnal persediaan', async () => {
    const res = await post('/api/inventory/adjustments', {
      warehouseId,
      reason: 'OPENING',
      lines: [{ productId, qty: '100', unitCost: '5000' }],
    }).expect(201);
    expect(res.body.valueIn).toBe('500000.00');
    expect(res.body.journalNumber).toMatch(/^JU\/\d{4}\/\d{2}\/0001$/);

    const bal = await stockOf();
    expect(Number(bal.qty)).toBe(100);
    expect(Number(bal.avgCost)).toBe(5000);
  });

  let orderId: string;
  it('sales order: harga per DUS otomatis dari master x faktor, PPN 11%', async () => {
    const res = await post('/api/sales-orders', {
      customerId,
      warehouseId,
      lines: [{ productId, uom: 'DUS', qty: '2' }],
    }).expect(201);
    orderId = res.body.id;
    expect(res.body.status).toBe('DRAFT');
    expect(Number(res.body.lines[0].price)).toBe(168000); // 7.000 x 24
    expect(res.body.subtotal).toBe('336000.00');
    expect(res.body.taxAmount).toBe('36960.00');
    expect(res.body.total).toBe('372960.00');
  });

  it('order DRAFT tidak bisa difakturkan', async () => {
    await post('/api/invoices', { salesOrderId: orderId }).expect(400);
  });

  let invoiceId: string;
  it('konfirmasi lalu faktur: stok berkurang, HPP & jurnal terbentuk', async () => {
    await post(`/api/sales-orders/${orderId}/confirm`).expect(201);
    const inv = await post('/api/invoices', { salesOrderId: orderId }).expect(201);
    invoiceId = inv.body.id;
    expect(inv.body.number).toMatch(/^INV\/\d{4}\/\d{2}\/0001$/);
    expect(inv.body.cogsAmount).toBe('240000.00'); // 48 pcs x 5.000
    expect(inv.body.status).toBe('UNPAID');

    const bal = await stockOf();
    expect(Number(bal.qty)).toBe(52);

    const so = await get(`/api/sales-orders/${orderId}`).expect(200);
    expect(so.body.status).toBe('INVOICED');
  });

  it('faktur kedua untuk order yang sama ditolak', async () => {
    await post('/api/invoices', { salesOrderId: orderId }).expect(400);
  });

  it('neraca saldo & neraca seimbang', async () => {
    const tb = await get('/api/accounting/reports/trial-balance').expect(200);
    expect(tb.body.balanced).toBe(true);
    expect(tb.body.totalDebit).toBe(tb.body.totalCredit);

    const bs = await get('/api/accounting/reports/balance-sheet').expect(200);
    expect(bs.body.balanced).toBe(true);
    const inventory = bs.body.assets.find((a: any) => a.code === '1-1400');
    expect(inventory.balance).toBe('260000');

    const pl = await get('/api/accounting/reports/profit-loss').expect(200);
    expect(pl.body.totalRevenue).toBe('336000');
    expect(pl.body.netIncome).toBe('96000'); // 336.000 - 240.000
  });

  it('pembayaran sebagian lalu pelunasan; kelebihan bayar ditolak', async () => {
    await post('/api/payments', { invoiceId, amount: '100000', method: 'TRANSFER' }).expect(201);
    let inv = await get(`/api/invoices/${invoiceId}`).expect(200);
    expect(inv.body.status).toBe('PARTIAL');
    expect(inv.body.paidAmount).toBe('100000.00');

    await post('/api/payments', { invoiceId, amount: '999999' }).expect(400);

    await post('/api/payments', { invoiceId, amount: '272960' }).expect(201);
    inv = await get(`/api/invoices/${invoiceId}`).expect(200);
    expect(inv.body.status).toBe('PAID');
  });

  it('stok kurang: faktur gagal dan TIDAK ada data setengah jadi (atomik, nomor tanpa celah)', async () => {
    const so = await post('/api/sales-orders', {
      customerId,
      warehouseId,
      lines: [{ productId, uom: 'DUS', qty: '3' }], // 72 pcs > 52
    }).expect(201);
    await post(`/api/sales-orders/${so.body.id}/confirm`).expect(201);
    const fail = await post('/api/invoices', { salesOrderId: so.body.id }).expect(400);
    expect(fail.body.message).toContain('tidak cukup');

    expect(Number((await stockOf()).qty)).toBe(52);
    expect((await get(`/api/sales-orders/${so.body.id}`)).body.status).toBe('CONFIRMED');

    // Tambah stok, faktur berhasil dengan nomor 0002 (nomor yang gagal tidak terpakai)
    await post('/api/inventory/adjustments', {
      warehouseId,
      reason: 'OTHER',
      lines: [{ productId, qty: '48', unitCost: '6000' }],
    }).expect(201);
    const bal = await stockOf();
    expect(Number(bal.qty)).toBe(100);
    expect(Number(bal.avgCost)).toBe(5480); // (52 x 5.000 + 48 x 6.000) / 100

    const ok = await post('/api/invoices', { salesOrderId: so.body.id }).expect(201);
    expect(ok.body.number).toMatch(/0002$/);
  });

  it('limit kredit memblokir order yang melebihi batas', async () => {
    const so = await post('/api/sales-orders', {
      customerId,
      warehouseId,
      lines: [{ productId, uom: 'DUS', qty: '10' }],
    }).expect(201);
    const res = await post(`/api/sales-orders/${so.body.id}/confirm`).expect(400);
    expect(res.body.message).toContain('limit kredit');
  });

  it('dua faktur bersamaan untuk order yang sama: hanya satu yang berhasil', async () => {
    const cust = await post('/api/customers', { code: 'TK-PARALEL', name: 'Toko Paralel' }).expect(201);
    const so = await post('/api/sales-orders', {
      customerId: cust.body.id,
      warehouseId,
      lines: [{ productId, qty: '5' }],
    }).expect(201);
    await post(`/api/sales-orders/${so.body.id}/confirm`).expect(201);
    const before = Number((await stockOf()).qty);

    const results = await Promise.all([
      post('/api/invoices', { salesOrderId: so.body.id }),
      post('/api/invoices', { salesOrderId: so.body.id }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(Number((await stockOf()).qty)).toBe(before - 5);
  });

  it('jurnal manual & pembalikan; jurnal tidak seimbang ditolak', async () => {
    const accounts = (await get('/api/accounting/accounts').expect(200)).body;
    const rent = accounts.find((a: any) => a.code === '6-3000');
    const cash = accounts.find((a: any) => a.code === '1-1100');

    await post('/api/accounting/journals', {
      description: 'Tidak seimbang',
      lines: [
        { accountId: rent.id, debit: '100' },
        { accountId: cash.id, credit: '90' },
      ],
    }).expect(400);

    const j = await post('/api/accounting/journals', {
      description: 'Sewa gudang',
      lines: [
        { accountId: rent.id, debit: '2000000' },
        { accountId: cash.id, credit: '2000000' },
      ],
    }).expect(201);
    const rev = await post(`/api/accounting/journals/${j.body.id}/reverse`).expect(201);
    expect(rev.body.lines.find((l: any) => l.accountId === rent.id).credit).toBe('2000000.00');
    await post(`/api/accounting/journals/${j.body.id}/reverse`).expect(400);

    const tb = await get('/api/accounting/reports/trial-balance').expect(200);
    expect(tb.body.balanced).toBe(true);
  });

  it('isolasi tenant: perusahaan lain tidak bisa melihat data', async () => {
    const other = await http
      .post('/api/auth/register')
      .send({ companyName: 'PT Lain', name: 'Lain', email: `lain-${Date.now()}@uji.id`, password: 'rahasia123' })
      .expect(201);
    await get(`/api/products/${productId}`, other.body.accessToken).expect(404);
    const list = await get('/api/products', other.body.accessToken).expect(200);
    expect(list.body).toHaveLength(0);
    await post('/api/sales-orders', { customerId, warehouseId, lines: [{ productId, qty: '1' }] }, other.body.accessToken).expect(400);
  });

  it('hak akses: peran SALES tidak bisa mencatat pembayaran', async () => {
    const email = `sales-${Date.now()}@uji.id`;
    await post('/api/users', { name: 'Salesman', email, password: 'rahasia123', role: 'SALES' }).expect(201);
    const login = await http.post('/api/auth/login').send({ email, password: 'rahasia123' }).expect(200);
    await post('/api/payments', { invoiceId, amount: '1' }, login.body.accessToken).expect(403);
    await get('/api/products', login.body.accessToken).expect(200);
  });

  it('dashboard menampilkan ringkasan', async () => {
    const res = await http.get('/api/dashboard').set(auth()).expect(200);
    expect(Number(res.body.salesMonth)).toBeGreaterThan(0);
    expect(Number(res.body.stockValue)).toBeGreaterThan(0);
  });
});
