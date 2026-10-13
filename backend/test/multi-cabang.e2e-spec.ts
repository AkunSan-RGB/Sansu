/**
 * Multi-cabang dalam satu perusahaan (e2e): cabang turun otomatis dari gudang/toko dan kas ke jurnal untuk semua sumber
 * (kasir, penjualan, pembelian, stok, kas, jurnal manual, jurnal balik); laba rugi per cabang; gabungan = laba rugi perusahaan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { todayJakarta } from '../src/common/utils/dates';
import { DB, Db } from '../src/db/db';

describe('Multi-cabang (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  let owner: string;
  let cashier: string;
  let tenantId: string;
  let W1: string;
  let W2: string;
  let B1: string;
  let B2: string;
  let P: string;
  let expenseId: string;
  let equityId: string;
  let cashId: string;
  const stamp = Date.now();
  const day = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  /** cabang yang menempel pada baris jurnal suatu jenis sumber */
  const branchesOf = async (source: string) => {
    const r = await db.execute<{ b: string | null }>(sql`
      SELECT DISTINCT l.branch_id::text AS b FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
      WHERE j.tenant_id = ${tenantId} AND j.source_type = ${source}`);
    return r.rows.map((x) => x.b);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    db = app.get<Db>(DB);
    http = request(app.getHttpServer());
    const reg = (await http.post('/api/auth/register').send({ companyName: 'PT Dua Cabang', name: 'Pemilik', email: `cb-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body;
    owner = reg.accessToken;
    tenantId = reg.user.tenantId;
    await post(owner, '/api/apps/pos/install').expect(201);
    await post(owner, '/api/users', { name: 'Kasir', email: `cb-k-${stamp}@uji.id`, password: 'kasir12345', role: 'CASHIER' }).expect(201);
    cashier = (await http.post('/api/auth/login').send({ email: `cb-k-${stamp}@uji.id`, password: 'kasir12345' }).expect(200)).body.accessToken;
    W1 = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    W2 = (await post(owner, '/api/warehouses', { code: 'TK-2', name: 'Toko 2' }).expect(201)).body.id;
    P = (await post(owner, '/api/products', { sku: 'CB-1', name: 'Barang Cabang', sellPrice: '10000' }).expect(201)).body.id;
    cashId = ((await get(owner, '/api/cash/accounts').expect(200)).body as { id: string; code: string }[]).find((a) => a.code === '1-1100')!.id;
    const counters = (await get(owner, '/api/cash/counter-accounts').expect(200)).body as { id: string; type: string; code: string }[];
    expenseId = counters.find((a) => a.type === 'EXPENSE')!.id;
    equityId = counters.find((a) => a.code === '3-1000')!.id;
    await post(owner, '/api/cash/transactions', { type: 'IN', cashAccountId: cashId, date: day, description: 'Modal', reference: 'M-1', lines: [{ accountId: equityId, amount: '100000000' }] }).expect(201);
  });
  afterAll(() => app.close());

  it('cabang: hanya Admin/Pemilik yang membuat; kode unik; gudang dipasangkan ke cabang', async () => {
    await post(cashier, '/api/branches', { code: 'C1', name: 'Cabang 1' }).expect(403);
    B1 = (await post(owner, '/api/branches', { code: 'c1', name: 'Cabang Utama' }).expect(201)).body.id;
    B2 = (await post(owner, '/api/branches', { code: 'C2', name: 'Cabang Dua' }).expect(201)).body.id;
    await post(owner, '/api/branches', { code: 'C1', name: 'Dobel' }).expect(400);
    await http.put(`/api/branches/warehouses/${W1}`).set(as(owner)).send({ branchId: B1 }).expect(200);
    await http.put(`/api/branches/warehouses/${W2}`).set(as(owner)).send({ branchId: B2 }).expect(200);
    const l = (await get(cashier, '/api/branches').expect(200)).body; // kasir boleh melihat daftar
    expect(l.branches).toHaveLength(2);
  });

  it('kasir, stok, kas, dan jurnal manual otomatis berlabel cabang dari toko/kas-nya', async () => {
    await post(owner, '/api/inventory/adjustments', { warehouseId: W1, reason: 'OPENING', date: day, lines: [{ productId: P, qty: '50', unitCost: '6000' }] }).expect(201);
    await post(owner, '/api/inventory/adjustments', { warehouseId: W2, reason: 'OPENING', date: day, lines: [{ productId: P, qty: '50', unitCost: '6000' }] }).expect(201);
    // owner membuka sesi di toko 1, jual 2; tutup; buka di toko 2, jual 5
    const s1 = (await post(owner, '/api/pos/sessions', { warehouseId: W1, openingCash: '0' }).expect(201)).body.id;
    await post(owner, '/api/pos/orders', { sessionId: s1, lines: [{ productId: P, qty: '2', price: '10000' }], payments: [{ method: 'CASH', amount: '100000' }] }).expect(201);
    await post(owner, `/api/pos/sessions/${s1}/close`, { countedCash: '20000' }).expect(201);
    const s2 = (await post(owner, '/api/pos/sessions', { warehouseId: W2, openingCash: '0' }).expect(201)).body.id;
    const o2 = (await post(owner, '/api/pos/orders', { sessionId: s2, lines: [{ productId: P, qty: '5', price: '10000' }], payments: [{ method: 'CASH', amount: '100000' }] }).expect(201)).body;
    expect(await branchesOf('POS')).toEqual(expect.arrayContaining([B1, B2]));
    expect(await branchesOf('POS')).toHaveLength(2);
    // retur kasir toko 2 → cabang 2
    await post(owner, `/api/pos/orders/${o2.id}/return`, { lines: [{ orderLineId: o2.lines[0].id, qty: '1' }], reason: 'barang cacat' }).expect(201);
    expect((await branchesOf('POS_RETURN'))).toEqual([B2]);
    expect((await branchesOf('STOCK_ADJUSTMENT')).sort()).toEqual([B1, B2].sort());
    // kas keluar dan jurnal manual dengan cabang eksplisit
    await post(owner, '/api/cash/transactions', { type: 'OUT', cashAccountId: cashId, date: day, description: 'Sewa cabang 2', reference: 'S-2', branchId: B2, lines: [{ accountId: expenseId, amount: '500000' }] }).expect(201);
    expect(await branchesOf('CASH_OUT')).toEqual([B2]);
    const mj = (await post(owner, '/api/accounting/journals', { date: day, description: 'Biaya cabang 1', branchId: B1, controlOverrideReason: undefined, lines: [{ accountId: expenseId, debit: '200000' }, { accountId: cashId, credit: '200000' }] }).expect(201)).body;
    // jurnal balik mewarisi cabang → biaya bersih cabang 1 nol
    await post(owner, `/api/accounting/journals/${mj.id}/reverse`).expect(201);
    expect((await branchesOf('REVERSAL'))).toEqual([B1]);
    await post(owner, '/api/cash/transactions', { type: 'OUT', cashAccountId: cashId, date: day, description: 'Cabang tak dikenal', reference: 'X', branchId: '00000000-0000-4000-8000-000000000000', lines: [{ accountId: expenseId, amount: '1000' }] }).expect(400);
  });

  it('penjualan & pembelian bergudang cabang 2 berlabel cabang 2 (faktur, bayar, penerimaan, faktur beli, bayar pemasok)', async () => {
    const cust = (await post(owner, '/api/customers', { code: 'C-CB', name: 'Pelanggan', paymentTermDays: 30 }).expect(201)).body.id;
    const so = (await post(owner, '/api/sales-orders', { customerId: cust, warehouseId: W2, lines: [{ productId: P, qty: '3', price: '10000' }] }).expect(201)).body;
    await post(owner, `/api/sales-orders/${so.id}/confirm`).expect(201);
    const inv = (await post(owner, '/api/invoices', { salesOrderId: so.id }).expect(201)).body;
    await post(owner, '/api/payments', { invoiceId: inv.id, amount: '10000', method: 'TRANSFER' }).expect(201);
    expect(await branchesOf('INVOICE')).toEqual([B2]);
    expect(await branchesOf('PAYMENT')).toEqual([B2]);
    const sup = (await post(owner, '/api/suppliers', { code: 'S-CB', name: 'Pemasok Cabang' }).expect(201)).body.id;
    const po = (await post(owner, '/api/purchase-orders', { supplierId: sup, warehouseId: W2, lines: [{ productId: P, qty: '10', price: '5000' }] }).expect(201)).body;
    await post(owner, `/api/purchase-orders/${po.id}/confirm`).expect(201);
    await post(owner, `/api/purchase-orders/${po.id}/receipts`, { lines: [{ orderLineId: po.lines[0].id, qty: '10' }] }).expect(201);
    expect(await branchesOf('GOODS_RECEIPT')).toEqual([B2]);
    const pi = (await post(owner, '/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: `CB-${stamp}` }).expect(201)).body;
    expect(await branchesOf('PURCHASE_INVOICE')).toEqual([B2]);
    await post(owner, '/api/purchase-invoices/payments', { purchaseInvoiceId: pi.id, amount: '10000', date: day }).expect(201);
    expect(await branchesOf('SUPPLIER_PAYMENT')).toEqual([B2]);
  });

  it('laba rugi per cabang; kolom gabungan = laba rugi perusahaan; temuan gudang tanpa cabang', async () => {
    const rep = (await get(owner, `/api/branches/report?from=${day.slice(0, 7)}-01&to=${day}`).expect(200)).body;
    const s1 = rep.summary[B1];
    const s2 = rep.summary[B2];
    expect(Number(s1.revenue)).toBeGreaterThan(0);
    expect(Number(s2.revenue)).toBeGreaterThan(0);
    // biaya sewa cabang 2 masuk cabang 2; biaya cabang 1 sudah dibalik (nol)
    const spend = (x: { costOfSales: string; operatingExpense: string }) => Number(x.costOfSales) + Number(x.operatingExpense);
    expect(spend(s2)).toBeGreaterThanOrEqual(500000);
    expect(spend(s1)).toBe(spend(s1) - 0); // HPP penjualan toko 1 saja; biaya manual 200.000 sudah dibalik
    expect(spend(s1)).toBe(2 * 6000); // hanya HPP 2 unit × 6.000
    // konsolidasi: jumlah semua cabang = laba rugi perusahaan
    const pl = (await get(owner, `/api/accounting/reports/profit-loss?from=${day.slice(0, 7)}-01&to=${day}`).expect(200)).body;
    expect(Number(rep.consolidated.netProfit)).toBeCloseTo(Number(pl.netIncome), 2);
    const sumNet = Object.values(rep.summary as Record<string, { netProfit: string }>).reduce((a, x) => a + Number(x.netProfit), 0);
    expect(sumNet).toBeCloseTo(Number(rep.consolidated.netProfit), 2);

    await post(owner, '/api/warehouses', { code: 'TK-3', name: 'Toko 3 tanpa cabang' }).expect(201);
    const c = (await get(owner, '/api/branches/controls').expect(200)).body as { items: { key: string }[] };
    expect(c.items.map((i) => i.key)).toContain('WAREHOUSE_NO_BRANCH');
    await get(cashier, '/api/branches/report').expect(403);
  });
});
