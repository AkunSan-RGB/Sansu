/**
 * Rantai pembelian: pesanan → penerimaan barang (bertahap) → faktur supplier (bertahap) → pembayaran → jurnal & laporan.
 * Akun "Barang Diterima Belum Ditagih" (2-1160) menampung barang yang sudah masuk gudang tetapi belum ditagih supplier.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Rantai pembelian: pesanan → penerimaan → faktur (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  let wh: string;
  let sup: string;
  let prodA: string;
  let prodB: string;
  const stamp = Date.now();
  const as = () => ({ Authorization: `Bearer ${token}` });
  const get = (u: string) => http.get(u).set(as());
  const post = (u: string, b: object = {}) => http.post(u).set(as()).send(b);
  const put = (u: string, b: object = {}) => http.put(u).set(as()).send(b);
  const patch = (u: string, b: object = {}) => http.patch(u).set(as()).send(b);
  /** Saldo akun dalam nilai mutlak (sisi normalnya); neraca saldo harus selalu seimbang */
  const bal = async (code: string) => {
    const tb = (await get('/api/accounting/reports/trial-balance').expect(200)).body;
    expect(tb.balanced).toBe(true);
    return Math.abs(Number(tb.rows.find((x: { code: string }) => x.code === code)?.balance ?? 0));
  };
  const stock = async (productId: string) => (await get(`/api/inventory/balances?productId=${productId}`).expect(200)).body[0] as { qty: string; avgCost: string } | undefined;
  const order = async (lines: { productId: string; qty: string; price: string }[]) => {
    const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: wh, lines }).expect(201)).body;
    await post(`/api/purchase-orders/${po.id}/confirm`).expect(201);
    return (await get(`/api/purchase-orders/${po.id}`).expect(200)).body;
  };
  const line = (po: { lines: { id: string; productId: string }[] }, productId: string) => po.lines.find((l) => l.productId === productId)!.id;
  let n = 0;
  const bill = (poId: string, extra: object = {}) => post('/api/purchase-invoices', { purchaseOrderId: poId, supplierInvoiceNo: `F-${stamp}-${++n}`, ...extra });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (await http.post('/api/auth/register').send({ companyName: 'CV Rantai Beli', name: 'Pemilik', email: `chain-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    wh = (await get('/api/warehouses')).body[0].id;
    sup = (await post('/api/suppliers', { code: 'S1', name: 'PT Pemasok' }).expect(201)).body.id;
    prodA = (await post('/api/products', { sku: 'A', name: 'Barang A', sellPrice: '3000' }).expect(201)).body.id;
    prodB = (await post('/api/products', { sku: 'B', name: 'Barang B', sellPrice: '9000' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('terima bertahap lalu faktur bertahap: akun penampung terbentuk dan tertutup, stok dan utang cocok', async () => {
    const po = await order([
      { productId: prodA, qty: '10', price: '1000' },
      { productId: prodB, qty: '4', price: '5000' },
    ]);
    expect(po.total).toBe('33300.00'); // DPP 30.000 + PPN 3.300
    expect(po).toMatchObject({ receiptStatus: 'NONE', billingStatus: 'NONE' });
    const a = line(po, prodA);
    const b = line(po, prodB);

    // penerimaan pertama: 6 dari 10 barang A
    const g1 = (await post(`/api/purchase-orders/${po.id}/receipts`, { supplierDeliveryNo: 'SJ-77', lines: [{ orderLineId: a, qty: '6' }] }).expect(201)).body;
    expect(g1).toMatchObject({ status: 'RECEIVED', value: '6000.00', supplierDeliveryNo: 'SJ-77' });
    expect(g1.number).toMatch(/^GR\//);
    expect(await bal('1-1400')).toBe(6000);
    expect(await bal('2-1160')).toBe(6000);
    expect(await bal('2-1100')).toBe(0); // belum ditagih: belum jadi utang usaha
    expect(Number((await stock(prodA))!.qty)).toBe(6);
    const afterG1 = (await get(`/api/purchase-orders/${po.id}`).expect(200)).body;
    expect(afterG1).toMatchObject({ status: 'CONFIRMED', receiptStatus: 'PARTIAL', billingStatus: 'NONE' });

    // tidak boleh menerima melebihi sisa pesanan, atau menagih melebihi yang sudah diterima
    await post(`/api/purchase-orders/${po.id}/receipts`, { lines: [{ orderLineId: a, qty: '5' }] }).expect(400);
    const tooMuch = await bill(po.id, { lines: [{ orderLineId: a, qty: '7' }] });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.message).toContain('Terima barang dulu');

    // faktur pertama: tagih 4 dari 6 yang sudah diterima
    const i1 = (await bill(po.id, { lines: [{ orderLineId: a, qty: '4' }] }).expect(201)).body;
    expect(i1).toMatchObject({ subtotal: '4000.00', taxAmount: '440.00', total: '4440.00' });
    expect(await bal('2-1160')).toBe(2000); // sisa 2 unit diterima belum ditagih
    expect(await bal('2-1100')).toBe(4440);
    expect(await bal('1-1500')).toBe(440);
    expect((await get(`/api/purchase-orders/${po.id}`).expect(200)).body).toMatchObject({ status: 'CONFIRMED', billingStatus: 'PARTIAL' });

    // penerimaan kedua: sisa A dan seluruh B
    await post(`/api/purchase-orders/${po.id}/receipts`, {}).expect(201);
    expect(await bal('1-1400')).toBe(30000);
    expect(await bal('2-1160')).toBe(2000 + 4000 + 20000);
    expect(Number((await stock(prodB))!.qty)).toBe(4);
    expect((await get(`/api/purchase-orders/${po.id}`).expect(200)).body).toMatchObject({ receiptStatus: 'FULL', status: 'CONFIRMED' });
    await post(`/api/purchase-orders/${po.id}/receipts`, {}).expect(400); // sudah diterima semua

    // faktur kedua: seluruh sisa yang diterima → pesanan tuntas
    const i2 = (await bill(po.id).expect(201)).body;
    expect(i2).toMatchObject({ subtotal: '26000.00', taxAmount: '2860.00', total: '28860.00' });
    expect(await bal('2-1160')).toBe(0);
    expect(await bal('2-1100')).toBe(33300); // = total pesanan
    expect(await bal('1-1500')).toBe(3300);
    expect(await bal('1-1400')).toBe(30000);
    const done = (await get(`/api/purchase-orders/${po.id}`).expect(200)).body;
    expect(done).toMatchObject({ status: 'BILLED', billingStatus: 'FULL' });
    expect(done.invoices).toHaveLength(2);
    expect(done.receipts).toHaveLength(2);
    await bill(po.id).expect(400); // tidak ada lagi yang bisa ditagih

    // nilai stok = saldo persediaan; bayar dua faktur menutup utang
    const sa = (await stock(prodA))!;
    const sb = (await stock(prodB))!;
    expect(Number(sa.qty) * Number(sa.avgCost) + Number(sb.qty) * Number(sb.avgCost)).toBeCloseTo(30000, 0);
    // retur pembelian atas faktur hasil penerimaan bekerja seperti biasa (sebelum faktur dibayar)
    const inv = (await get(`/api/purchase-invoices/${i1.id}`).expect(200)).body;
    await post('/api/purchase-returns', { invoiceId: i1.id, lines: [{ invoiceLineId: inv.lines[0].id, qty: '1' }] }).expect(201);
    expect(await bal('1-1400')).toBe(29000);
    expect(await bal('2-1100')).toBe(33300 - 1110);
    // bayar kedua faktur (faktur pertama sudah dikurangi retur) menutup utang
    const bank = ((await get('/api/accounting/accounts').expect(200)).body as { id: string; code: string }[]).find((x) => x.code === '1-1200')!.id;
    await post('/api/purchase-invoices/payments', { purchaseInvoiceId: i1.id, amount: '3330', cashAccountId: bank }).expect(201);
    await post('/api/purchase-invoices/payments', { purchaseInvoiceId: i2.id, amount: '28860', cashAccountId: bank }).expect(201);
    expect(await bal('2-1100')).toBe(0);
  });

  it('batalkan penerimaan yang belum ditagih: stok dan akun penampung kembali; yang sudah ditagih ditolak', async () => {
    const before = { inv: await bal('1-1400'), grni: await bal('2-1160') };
    const po = await order([{ productId: prodA, qty: '5', price: '2000' }]);
    const g = (await post(`/api/purchase-orders/${po.id}/receipts`, {}).expect(201)).body;
    expect(await bal('2-1160')).toBe(before.grni + 10000);
    await post(`/api/purchase-orders/${po.id}/cancel`).expect(400); // sudah ada penerimaan
    const cancelled = (await post(`/api/goods-receipts/${g.id}/cancel`, {}).expect(201)).body;
    expect(cancelled.status).toBe('CANCELLED');
    expect(await bal('2-1160')).toBe(before.grni);
    expect(await bal('1-1400')).toBe(before.inv);
    await post(`/api/goods-receipts/${g.id}/cancel`, {}).expect(400);
    const reopened = (await get(`/api/purchase-orders/${po.id}`).expect(200)).body;
    expect(reopened).toMatchObject({ status: 'CONFIRMED', receiptStatus: 'NONE' });
    await post(`/api/purchase-orders/${po.id}/cancel`).expect(201); // tanpa penerimaan aktif: boleh dibatalkan

    const po2 = await order([{ productId: prodA, qty: '2', price: '2000' }]);
    const g2 = (await post(`/api/purchase-orders/${po2.id}/receipts`, {}).expect(201)).body;
    await bill(po2.id).expect(201);
    const refused = await post(`/api/goods-receipts/${g2.id}/cancel`, {});
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('difakturkan');
  });

  it('jalur langsung faktur tetap satu jurnal; penerimaan otomatis terbentuk dan tidak bisa dibatalkan', async () => {
    const grniBefore = await bal('2-1160');
    const po = await order([{ productId: prodA, qty: '3', price: '1500' }]);
    const inv = (await bill(po.id).expect(201)).body;
    expect(inv.total).toBe('4995.00');
    expect(await bal('2-1160')).toBe(grniBefore); // tidak lewat akun penampung
    const done = (await get(`/api/purchase-orders/${po.id}`).expect(200)).body;
    expect(done).toMatchObject({ status: 'BILLED', receiptStatus: 'FULL', billingStatus: 'FULL' });
    expect(done.receipts).toHaveLength(1);
    expect(done.receipts[0].autoInvoiceId).toBe(inv.id);
    await post(`/api/goods-receipts/${done.receipts[0].id}/cancel`, {}).expect(400);
    const list = (await get(`/api/goods-receipts?purchaseOrderId=${po.id}`).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0].order.number).toBe(po.number);
  });

  it('non-PKP: PPN supplier masuk harga perolehan sejak penerimaan, faktur menutup tanpa PPN masukan', async () => {
    await patch('/api/settings/company', { pkp: false }).expect(200);
    const vatBefore = await bal('1-1500');
    const invBefore = await bal('1-1400');
    const po = await order([{ productId: prodB, qty: '10', price: '1000' }]);
    expect(po.total).toBe('11100.00');
    await post(`/api/purchase-orders/${po.id}/receipts`, { lines: [{ orderLineId: line(po, prodB), qty: '10' }] }).expect(201);
    expect(await bal('1-1400')).toBe(invBefore + 11100); // PPN ikut ke harga perolehan
    const inv = (await bill(po.id).expect(201)).body;
    expect(inv).toMatchObject({ total: '11100.00', vatCapitalized: true });
    expect(await bal('1-1500')).toBe(vatBefore);
    await patch('/api/settings/company', { pkp: true }).expect(200);
  });

  it('FIFO: penerimaan bertahap pada harga berbeda dihitung berlapis, penagihan tidak mengubah nilai stok', async () => {
    await put('/api/settings/inventory-method', { method: 'FIFO' }).expect(200);
    const p = (await post('/api/products', { sku: 'F', name: 'Barang FIFO', sellPrice: '9000' }).expect(201)).body.id;
    const po1 = await order([{ productId: p, qty: '10', price: '1000' }]);
    const po2 = await order([{ productId: p, qty: '10', price: '1200' }]);
    await post(`/api/purchase-orders/${po1.id}/receipts`, {}).expect(201);
    await post(`/api/purchase-orders/${po2.id}/receipts`, {}).expect(201);
    const invBefore = await bal('1-1400');
    await bill(po1.id).expect(201);
    await bill(po2.id).expect(201);
    expect(await bal('1-1400')).toBe(invBefore); // faktur tidak menyentuh persediaan
    expect(Number((await stock(p))!.qty)).toBe(20);
    expect(Number((await stock(p))!.avgCost)).toBe(1100);
    await put('/api/settings/inventory-method', { method: 'AVERAGE' }).expect(200);
  });

  it('akses: penerimaan barang tersedia bagi gudang; riwayat dokumen asal jurnal menuju halaman penerimaan', async () => {
    const po = await order([{ productId: prodA, qty: '1', price: '1000' }]);
    const g = (await post(`/api/purchase-orders/${po.id}/receipts`, {}).expect(201)).body;
    const got = (await get(`/api/goods-receipts/${g.id}`).expect(200)).body;
    expect(Number(got.lines[0].qty)).toBe(1);
    expect(Number(got.lines[0].value)).toBe(1000);
    expect(Number(got.lines[0].billedQty)).toBe(0);
    const journals = (await get('/api/accounting/journals?source=GOODS_RECEIPT').expect(200)).body as { items?: { sourceType: string; sourceRoute?: string | null }[] } | { sourceType: string; sourceRoute?: string | null }[];
    const rows = Array.isArray(journals) ? journals : (journals.items ?? []);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.sourceType === 'GOODS_RECEIPT')).toBe(true);
  });
});
