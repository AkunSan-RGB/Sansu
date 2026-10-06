/**
 * Permintaan serentak pada data yang sama tidak boleh melanggar pembukuan:
 * pembayaran tidak melebihi tagihan, stok tidak negatif, nomor dokumen tidak ganda, setoran pajak tidak ganda.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Konkurensi (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let pool: Pool;
  let token: string;
  let tenantId: string;
  let warehouseId: string;
  let productId: string;
  let customerId: string;
  let supplierId: string;
  const stamp = Date.now();
  const as = () => ({ Authorization: `Bearer ${token}` });
  const get = (url: string) => http.get(url).set(as());
  const post = (url: string, body: object = {}) => http.post(url).set(as()).send(body);
  const q = async <T = any>(sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows as T[];
  const noServerErrors = (rs: { status: number; body: unknown }[]) => expect(rs.filter((r) => r.status >= 500).map((r) => JSON.stringify(r.body))).toEqual([]);
  let n = 0;

  const newInvoice = async (qty: string, price = '10000') => {
    const so = (await post('/api/sales-orders', { customerId, warehouseId, lines: [{ productId, qty, price }] }).expect(201)).body;
    await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    return so.id as string;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
    token = (await http.post('/api/auth/register').send({ companyName: 'PT Serentak', name: 'Pemilik', email: `conc-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    tenantId = (await get('/api/auth/me')).body.tenantId;
    warehouseId = (await get('/api/warehouses')).body[0].id;
    productId = (await post('/api/products', { sku: 'CC-1', name: 'Barang', sellPrice: '10000' }).expect(201)).body.id;
    customerId = (await post('/api/customers', { code: 'C-CC', name: 'Pelanggan', creditLimit: '100000000000' }).expect(201)).body.id;
    supplierId = (await post('/api/suppliers', { code: 'S-CC', name: 'Pemasok' }).expect(201)).body.id;
    await post('/api/inventory/adjustments', { warehouseId, reason: 'OPENING', lines: [{ productId, qty: '100', unitCost: '5000' }] }).expect(201);
  });
  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  it('pembayaran serentak untuk satu faktur: total terbayar tidak pernah melebihi tagihan', async () => {
    const soId = await newInvoice('10'); // 100.000 + PPN 11% = 111.000
    const inv = (await post('/api/invoices', { salesOrderId: soId }).expect(201)).body;
    const results = await Promise.all(Array.from({ length: 8 }, () => post('/api/payments', { invoiceId: inv.id, amount: '50000', method: 'TRANSFER' })));
    noServerErrors(results);
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(2); // 2 × 50.000 ≤ 111.000 < 3 × 50.000
    const row = (await q(`SELECT total, paid_amount, status FROM invoices WHERE id = $1`, [inv.id]))[0];
    expect(Number(row.paid_amount)).toBe(100000);
    expect(Number(row.paid_amount)).toBeLessThanOrEqual(Number(row.total));
    expect((await get('/api/accounting/reports/trial-balance')).body.balanced).toBe(true);
  });

  it('pelunasan serentak (jumlah penuh): hanya satu yang berhasil', async () => {
    const inv = (await post('/api/invoices', { salesOrderId: await newInvoice('4') }).expect(201)).body;
    const results = await Promise.all(Array.from({ length: 6 }, () => post('/api/payments', { invoiceId: inv.id, amount: inv.total, method: 'TRANSFER' })));
    noServerErrors(results);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await q(`SELECT status, paid_amount, total FROM invoices WHERE id = $1`, [inv.id]))[0]).toMatchObject({ status: 'PAID' });
  });

  it('faktur serentak dari satu pesanan: hanya satu faktur terbit', async () => {
    const soId = await newInvoice('3');
    const results = await Promise.all(Array.from({ length: 6 }, () => post('/api/invoices', { salesOrderId: soId })));
    noServerErrors(results);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await q(`SELECT COUNT(*)::int AS n FROM invoices WHERE sales_order_id = $1`, [soId]))[0].n).toBe(1);
  });

  it('penjualan serentak atas stok terbatas: stok tidak pernah negatif dan tidak terjual melebihi persediaan', async () => {
    const have = Number((await q(`SELECT qty FROM stock_balances WHERE tenant_id=$1 AND product_id=$2 AND warehouse_id=$3`, [tenantId, productId, warehouseId]))[0].qty);
    // pesanan dibuat dulu (konfirmasi tidak memotong stok), lalu semua difakturkan bersamaan
    const orders: string[] = [];
    for (let i = 0; i < 8; i++) orders.push(await newInvoice(String(Math.ceil(have / 3))));
    const results = await Promise.all(orders.map((id) => post('/api/invoices', { salesOrderId: id })));
    noServerErrors(results);
    const sold = results.filter((r) => r.status === 201).length * Math.ceil(have / 3);
    expect(sold).toBeLessThanOrEqual(have);
    const after = Number((await q(`SELECT qty FROM stock_balances WHERE tenant_id=$1 AND product_id=$2 AND warehouse_id=$3`, [tenantId, productId, warehouseId]))[0].qty);
    expect(after).toBeGreaterThanOrEqual(0);
    expect(after).toBeCloseTo(have - sold, 4);
    expect((await get('/api/accounting/reports/trial-balance')).body.balanced).toBe(true);
  });

  it('jurnal serentak: nomor jurnal tidak ganda dan semua jurnal seimbang', async () => {
    const acc = (await get('/api/accounting/accounts')).body as { id: string; code: string }[];
    const id = (c: string) => acc.find((a) => a.code === c)!.id;
    const today = new Date().toISOString().slice(0, 10);
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => post('/api/accounting/journals', { date: today, description: `Serentak ${i}`, lines: [{ accountId: id('6-6000'), debit: '1000' }, { accountId: id('1-1100'), credit: '1000' }] })),
    );
    noServerErrors(results);
    expect(results.filter((r) => r.status === 201)).toHaveLength(25);
    const numbers = results.map((r) => r.body.number as string);
    expect(new Set(numbers).size).toBe(25);
    const dup = await q(`SELECT number, COUNT(*)::int AS n FROM journal_entries WHERE tenant_id=$1 GROUP BY number HAVING COUNT(*) > 1`, [tenantId]);
    expect(dup).toEqual([]);
  });

  it('setoran pajak serentak untuk masa yang sama: tidak melebihi kewajiban', async () => {
    const acc = (await get('/api/accounting/accounts')).body as { id: string; code: string }[];
    const id = (c: string) => acc.find((a) => a.code === c)!.id;
    const period = `${new Date().getFullYear() - 1}-03`;
    // utang PPh 23 Rp100.000 pada masa itu (jurnal manual ke akun utang PPh 23)
    await post('/api/accounting/journals', { date: `${period}-10`, description: 'PPh 23 dipotong', lines: [{ accountId: id('6-7200'), debit: '100000' }, { accountId: id('2-1320'), credit: '100000' }] }).expect(201);
    const results = await Promise.all(Array.from({ length: 6 }, () => post('/api/tax/payments', { type: 'PPH23', period, date: new Date().toISOString().slice(0, 10) })));
    noServerErrors(results);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const paid = (await q(`SELECT COALESCE(SUM(amount),0) AS v FROM tax_payments WHERE tenant_id=$1 AND type='PPH23' AND period=$2`, [tenantId, period]))[0].v;
    expect(Number(paid)).toBe(100000);
  });

  it('pembelian dan retur serentak: tidak ada kelebihan retur', async () => {
    const po = (await post('/api/purchase-orders', { supplierId, warehouseId, lines: [{ productId, qty: '10', price: '4000' }] }).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    const pi = (await post('/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: `CC-${++n}` }).expect(201)).body;
    const full = (await get(`/api/purchase-invoices/${pi.id}`)).body;
    const line = full.lines[0];
    const results = await Promise.all(Array.from({ length: 6 }, () => post('/api/purchase-returns', { invoiceId: pi.id, reason: 'Uji', lines: [{ invoiceLineId: line.id, qty: '6' }] })));
    noServerErrors(results);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1); // 2 × 6 > 10
    const row = (await q(`SELECT total, returned_amount FROM purchase_invoices WHERE id=$1`, [pi.id]))[0];
    expect(Number(row.returned_amount)).toBeLessThanOrEqual(Number(row.total));
  });
});
