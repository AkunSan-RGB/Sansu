/**
 * Anti-fraud selisih harga faktur: alasan wajib, toleransi, pembanding harga pasar (rata-rata 90 hari), persetujuan pemilik/admin,
 * pemisahan tugas, dan laporan untuk ditinjau.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Pengendalian selisih harga faktur (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let finance: string;
  let gudang: string;
  let wh: string;
  let sup: string;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const login = async (email: string, password: string) => (await http.post('/api/auth/login').send({ email, password }).expect(200)).body.accessToken as string;
  let n = 0;
  const bal = async (code: string) => {
    const tb = (await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body;
    expect(tb.balanced).toBe(true);
    return Number(tb.rows.find((x: { code: string }) => x.code === code)?.balance ?? 0);
  };
  /** Produk baru dengan riwayat harga beli 1.000 (membentuk harga pasar) */
  const product = async (sku: string) => {
    const id = (await post(owner, '/api/products', { sku, name: `Barang ${sku}`, sellPrice: '5000' }).expect(201)).body.id as string;
    const po = (await post(owner, '/api/purchase-orders', { supplierId: sup, warehouseId: wh, lines: [{ productId: id, qty: '10', price: '1000' }] }).expect(201)).body;
    await post(owner, `/api/purchase-orders/${po.id}/confirm`).expect(201);
    await post(owner, '/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: `H-${stamp}-${++n}` }).expect(201);
    return id;
  };
  const order = async (as_: string, productId: string, price: string) => {
    const po = (await post(as_, '/api/purchase-orders', { supplierId: sup, warehouseId: wh, lines: [{ productId, qty: '10', price }] }).expect(201)).body;
    await post(as_, `/api/purchase-orders/${po.id}/confirm`).expect(201);
    await post(gudang, `/api/purchase-orders/${po.id}/receipts`, {}).expect(201); // tagihan hanya atas barang yang sudah diterima Gudang
    return (await get(as_, `/api/purchase-orders/${po.id}`).expect(200)).body;
  };
  const bill = (t: string, po: { id: string; lines: { id: string }[] }, price: string, extra: object = {}) =>
    post(t, '/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: `F-${stamp}-${++n}`, prices: [{ orderLineId: po.lines[0].id, price }], varianceReason: 'MARKET_VOLATILITY', ...extra });
  const report = async () => (await get(owner, '/api/purchase-invoices/reports/price-variances').expect(200)).body;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Anti Fraud', name: 'Pemilik', email: `pc-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body.accessToken;
    await post(owner, '/api/users', { name: 'Keuangan', email: `pc-f-${stamp}@uji.id`, password: 'keuangan123', role: 'FINANCE' }).expect(201);
    await post(owner, '/api/users', { name: 'Gudang', email: `pc-g-${stamp}@uji.id`, password: 'gudang12345', role: 'WAREHOUSE' }).expect(201);
    finance = await login(`pc-f-${stamp}@uji.id`, 'keuangan123');
    gudang = await login(`pc-g-${stamp}@uji.id`, 'gudang12345');
    wh = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    sup = (await post(owner, '/api/suppliers', { code: 'S1', name: 'PT Pemasok' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('selisih harga wajib beralasan; alasan "lainnya" wajib dijelaskan', async () => {
    const p = await product('K1');
    const po = await order(finance, p, '1000');
    const noReason = await post(finance, '/api/purchase-invoices', { purchaseOrderId: po.id, supplierInvoiceNo: `X-${++n}`, prices: [{ orderLineId: po.lines[0].id, price: '1030' }] });
    expect(noReason.status).toBe(400);
    expect(noReason.body.message).toContain('alasan');
    const other = await bill(finance, po, '1030', { varianceReason: 'OTHER', varianceNote: 'ok' });
    expect(other.status).toBe(400);
    const bad = await bill(finance, po, '1030', { varianceReason: 'ASAL' });
    expect(bad.status).toBe(400);
    const ok = await bill(finance, po, '1030', { varianceReason: 'OTHER', varianceNote: 'Supplier menaikkan harga hari ini' }).expect(201);
    expect(ok.body.priceVariance).toBe('300.00');
  });

  it('dalam toleransi: langsung tercatat dan muncul di laporan dengan pembuatnya', async () => {
    const p = await product('K2');
    const po = await order(finance, p, '1000');
    const inv = (await bill(finance, po, '1040').expect(201)).body; // +4%, di bawah harga pasar +10%
    const row = (await report()).rows.find((r: { invoiceId: string }) => r.invoiceId === inv.id);
    expect(row).toMatchObject({ createdBy: 'Keuangan', reason: 'MARKET_VOLATILITY', pct: 4, approvedBy: null });
    expect(row.flags).toContain('SAME_USER'); // PO dibuat dan ditagih orang yang sama
    expect(row.flags).not.toContain('ABOVE_MARKET');
  });

  it('di atas toleransi: faktur tidak tercatat sampai disetujui; setelah disetujui tercatat atas nama pemohon', async () => {
    const p = await product('K3');
    const po = await order(finance, p, '1000');
    const apBefore = await bal('2-1100');
    const r1 = await bill(finance, po, '1200', { supplierInvoiceNo: 'FAKTUR-MAHAL' });
    expect(r1.status).toBe(409);
    expect(r1.body.code).toBe('APPROVAL_REQUIRED');
    const dup = await bill(finance, po, '1200', { supplierInvoiceNo: 'FAKTUR-MAHAL' });
    expect(dup.status).toBe(409);
    expect(dup.body.requestId).toBe(r1.body.requestId); // tidak membuat permintaan ganda
    expect(await bal('2-1100')).toBe(apBefore); // belum ada utang baru
    const pend = (await get(owner, '/api/approvals?status=PENDING').expect(200)).body as { id: string; kind: string; kindLabel: string; title: string }[];
    const mine = pend.find((x) => x.id === r1.body.requestId)!;
    expect(mine.kind).toBe('PURCHASE_INVOICE_PRICE');
    expect(mine.title).toContain('+20.0%');
    await post(finance, `/api/approvals/${mine.id}/approve`).expect(403); // pembuat tidak bisa menyetujui
    await post(owner, `/api/approvals/${mine.id}/approve`).expect(201);
    expect(await bal('2-1100')).toBeGreaterThan(apBefore);
    const row = (await report()).rows.find((r: { supplierInvoiceNo: string }) => r.supplierInvoiceNo === 'FAKTUR-MAHAL');
    expect(row).toMatchObject({ createdBy: 'Keuangan', approvedBy: 'Pemilik', pct: 20 });
    expect(row.flags).toContain('ABOVE_MARKET');
    expect(row.flags).not.toContain('NO_APPROVAL');
  });

  it('permintaan ditolak: faktur tidak pernah tercatat', async () => {
    const p = await product('K4');
    const po = await order(finance, p, '1000');
    const r = await bill(finance, po, '1500', { supplierInvoiceNo: 'FAKTUR-DITOLAK' });
    expect(r.status).toBe(409);
    await post(owner, `/api/approvals/${r.body.requestId}/reject`, { note: 'Harga tidak wajar' }).expect(201);
    expect((await report()).rows.some((x: { supplierInvoiceNo: string }) => x.supplierInvoiceNo === 'FAKTUR-DITOLAK')).toBe(false);
    const list = (await get(owner, '/api/purchase-invoices').expect(200)).body as { supplierInvoiceNo: string }[];
    expect(list.some((x) => x.supplierInvoiceNo === 'FAKTUR-DITOLAK')).toBe(false);
  });

  it('PO sudah mahal tetapi faktur hampir sama: tetap dicegat karena jauh di atas harga pasar', async () => {
    const p = await product('K5'); // pasar 1.000
    const po = await order(finance, p, '1400'); // PO sudah digelembungkan
    const r = await bill(finance, po, '1430', { supplierInvoiceNo: 'FAKTUR-PASAR' }); // +2,1% dari PO, +43% dari pasar
    expect(r.status).toBe(409);
  });

  it('pemilik tidak dibatasi tetapi penandanya tercatat (di atas pasar, pembuat PO = pembuat faktur)', async () => {
    const p = await product('K6');
    const po = await order(owner, p, '1000');
    const inv = (await bill(owner, po, '1600').expect(201)).body;
    const row = (await report()).rows.find((r: { invoiceId: string }) => r.invoiceId === inv.id);
    expect(row.flags).toEqual(expect.arrayContaining(['ABOVE_MARKET', 'SAME_USER', 'NO_APPROVAL']));
    const rep = await report();
    expect(rep.totals.flagged).toBeGreaterThan(0);
    expect(rep.bySupplier[0]).toMatchObject({ name: 'PT Pemasok' });
  });

  it('kebijakan: hanya admin yang mengubah; nilai tak sah ditolak; bila dimatikan tidak ada persetujuan', async () => {
    await http.put('/api/approvals/policy').set(as(finance)).send({ priceControl: false }).expect(403);
    await http.put('/api/approvals/policy').set(as(owner)).send({ priceTolerancePct: -1 }).expect(400);
    await http.put('/api/approvals/policy').set(as(owner)).send({ priceBenchmarkPct: 99999 }).expect(400);
    const p = await product('K7');
    await http.put('/api/approvals/policy').set(as(owner)).send({ priceTolerancePct: 30, priceBenchmarkPct: 100 }).expect(200);
    const po = await order(finance, p, '1000');
    await bill(finance, po, '1250').expect(201); // +25% masih dalam toleransi 30%
    await http.put('/api/approvals/policy').set(as(owner)).send({ priceControl: false }).expect(200);
    const p2 = await product('K8');
    const po2 = await order(finance, p2, '1000');
    await bill(finance, po2, '3000').expect(201); // pengendalian dimatikan; alasan tetap wajib dan tercatat
    await http.put('/api/approvals/policy').set(as(owner)).send({ priceControl: true, priceTolerancePct: 5, priceBenchmarkPct: 10 }).expect(200);
  });

  it('laporan hanya untuk admin/keuangan dan terisolasi per tenant', async () => {
    await get(gudang, '/api/purchase-invoices/reports/price-variances').expect(403);
    const lain = (await http.post('/api/auth/register').send({ companyName: 'PT Lain', name: 'X', email: `pc-o-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    expect((await get(lain, '/api/purchase-invoices/reports/price-variances').expect(200)).body.rows).toEqual([]);
    expect((await get(owner, '/api/purchase-invoices/reports/price-variances?from=bukan-tanggal')).status).toBe(400);
  });
});
