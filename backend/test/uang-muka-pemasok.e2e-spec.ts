/**
 * Uang muka pemasok (DP pembelian): dibayar sebelum barang datang, diperhitungkan ke faktur, bisa dikembalikan/dibatalkan.
 * Pembukuan: Dr Uang Muka Pembelian (1-1720) | Cr Kas/Bank; pakai: Dr Hutang | Cr Uang Muka; kembali: Dr Kas | Cr Uang Muka.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { sql } from 'drizzle-orm';
import { addDays, todayJakarta } from '../src/common/utils/dates';
import { DB, Db } from '../src/db/db';

describe('Uang muka pemasok (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  let owner = ''; let fin = ''; let akt = ''; let wh = ''; let sls = ''; let buy = '';
  let sup = ''; let sup2 = ''; let prod = ''; let whId = ''; let expenseId = '';
  const day = todayJakarta();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, u: string) => http.get(u).set(as(t));
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const mk = async (role: string, n: string) => {
    await post(owner, '/api/users', { name: n, email: `ump-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    return (await http.post('/api/auth/login').send({ email: `ump-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
  };
  let nb = 0;
  const bill = async (supplierId: string, price = '300000') =>
    (await post(owner, '/api/purchase-invoices/bills', { supplierId, supplierInvoiceNo: `UMP-${stamp}-${++nb}`, withVat: false, lines: [{ type: 'EXPENSE', description: 'Jasa', accountId: expenseId, price }] }).expect(201)).body as { id: string; number: string; total: string };
  const advance = (t: string, body: object) => post(t, '/api/supplier-advances', { date: day, ...body });
  const balance1720 = async () => {
    const tb = (await get(owner, '/api/accounting/reports/trial-balance').expect(200)).body as { balanced: boolean; rows: { code: string; debit: string; credit: string }[] };
    expect(tb.balanced).toBe(true);
    const r = tb.rows.find((x) => x.code === '1-1720');
    return r ? Number(r.debit) - Number(r.credit) : 0;
  };
  const newPo = async (qty = '100') => {
    const po = (await post(buy, '/api/purchase-orders', { supplierId: sup, warehouseId: whId, lines: [{ productId: prod, qty, price: '5000' }] }).expect(201)).body;
    await post(buy, `/api/purchase-orders/${po.id}/confirm`).expect(201);
    return po as { id: string; number: string; total: string };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Uang Muka Beli', name: 'Pemilik', email: `ump-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await http.put('/api/cash/settings').set({ Authorization: `Bearer ${owner}` }).send({ blockNegative: false }).expect(200); // perusahaan uji belum punya saldo kas
    fin = await mk('FINANCE', 'fin'); akt = await mk('ACCOUNTANT', 'akt'); wh = await mk('WAREHOUSE', 'wh'); sls = await mk('SALES', 'sls'); buy = await mk('PURCHASING', 'buy');
    expenseId = ((await get(owner, '/api/cash/counter-accounts').expect(200)).body as { id: string; type: string }[]).find((a) => a.type === 'EXPENSE')!.id;
    whId = (await get(owner, '/api/warehouses').expect(200)).body[0].id;
    prod = (await post(owner, '/api/products', { sku: 'UMP-1', name: 'Barang DP', sellPrice: '10000' }).expect(201)).body.id;
    sup = (await post(owner, '/api/suppliers', { code: 'UMP-S1', name: 'Pemasok DP Satu' }).expect(201)).body.id;
    sup2 = (await post(owner, '/api/suppliers', { code: 'UMP-S2', name: 'Pemasok DP Dua' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('hak akses dan validasi', async () => {
    expect((await get(sls, '/api/supplier-advances')).status).toBe(403);
    expect((await get(wh, '/api/supplier-advances')).status).toBe(403);
    expect((await get(akt, '/api/supplier-advances')).status).toBe(200);
    expect((await get(buy, '/api/supplier-advances')).status).toBe(200); // pembelian melihat status DP pemasoknya
    expect((await advance(akt, { supplierId: sup, amount: '1000' })).status).toBe(403);
    expect((await advance(buy, { supplierId: sup, amount: '1000' })).status).toBe(403);
    expect((await advance(owner, { supplierId: sup, amount: '0' })).status).toBe(400);
    expect((await advance(owner, { supplierId: sup, amount: '1000', date: addDays(day, 3) })).status).toBe(400);
    expect((await advance(owner, { supplierId: '00000000-0000-4000-8000-000000000000', amount: '1000' })).status).toBe(400);
    // PO yang belum dikonfirmasi (draf) belum boleh diberi DP
    const draft = (await post(buy, '/api/purchase-orders', { supplierId: sup, warehouseId: whId, lines: [{ productId: prod, qty: '10', price: '5000' }] }).expect(201)).body;
    expect((await advance(owner, { supplierId: sup, amount: '1000', purchaseOrderId: draft.id })).status).toBe(400);
    // PO milik pemasok lain
    const po = await newPo();
    expect((await advance(owner, { supplierId: sup2, amount: '1000', purchaseOrderId: po.id })).status).toBe(400);
  });

  it('DP tanpa PO oleh Pemilik: jurnal seimbang, saldo 1-1720 naik; staf menunggu persetujuan', async () => {
    const before = await balance1720();
    const a = (await advance(owner, { supplierId: sup, amount: '1000000', description: 'DP proyek A' }).expect(201)).body;
    expect(a.number).toMatch(/^UMP/);
    expect((await balance1720()) - before).toBe(1000000);
    // staf tanpa PO → persetujuan
    const r = await advance(fin, { supplierId: sup, amount: '500000' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('APPROVAL_REQUIRED');
    expect((await get(owner, '/api/supplier-advances')).body.filter((x: { supplierId: string }) => x.supplierId === sup)).toHaveLength(1);
    await post(owner, `/api/approvals/${r.body.requestId}/approve`, {}).expect(201);
    const list = (await get(owner, '/api/supplier-advances').expect(200)).body as { supplierId: string; amount: string; remaining: string }[];
    expect(list.filter((x) => x.supplierId === sup)).toHaveLength(2);
    expect((await balance1720()) - before).toBe(1500000);
    const sum = (await get(fin, '/api/supplier-advances/summary').expect(200)).body as { total: string; suppliers: { supplierCode: string; open: string }[] };
    expect(sum.suppliers.find((s) => s.supplierCode === 'UMP-S1')!.open).toBe('1500000.00');
  });

  it('DP untuk PO: batas 30% untuk staf, tidak boleh melebihi nilai PO', async () => {
    const po = await newPo('100'); // 100 x 5.000 (+PPN bila ada)
    const total = Number(po.total);
    const dp = (pct: number) => String(Math.floor((total * pct) / 100));
    expect((await advance(fin, { supplierId: sup, purchaseOrderId: po.id, amount: dp(20) })).status).toBe(201); // ≤ 30%
    const over = await advance(fin, { supplierId: sup, purchaseOrderId: po.id, amount: dp(20) }); // total 40% > 30%
    expect(over.status).toBe(409);
    expect(over.body.code).toBe('APPROVAL_REQUIRED');
    await advance(owner, { supplierId: sup, purchaseOrderId: po.id, amount: dp(20) }).expect(201); // Pemilik tidak dibatasi persentase
    expect((await advance(owner, { supplierId: sup, purchaseOrderId: po.id, amount: dp(70) })).status).toBe(400); // melebihi nilai PO
  });

  it('pakai ke faktur: sebagian, tidak melebihi sisa/hutang, pemasok sama; DP untuk PO hanya ke faktur PO itu', async () => {
    const b = await bill(sup, '300000');
    const free = ((await get(owner, '/api/supplier-advances?supplierId=' + sup).expect(200)).body as { id: string; purchaseOrderId: string | null; amount: string }[]).find((x) => !x.purchaseOrderId && x.amount === '1000000.00')!;
    const before = await balance1720();
    // pemasok lain, melebihi hutang, melebihi sisa
    const b2 = await bill(sup2, '100000');
    expect((await post(fin, `/api/supplier-advances/${free.id}/apply`, { purchaseInvoiceId: b2.id, amount: '50000', date: day })).status).toBe(400);
    expect((await post(fin, `/api/supplier-advances/${free.id}/apply`, { purchaseInvoiceId: b.id, amount: '400000', date: day })).status).toBe(400);
    expect((await post(sls, `/api/supplier-advances/${free.id}/apply`, { purchaseInvoiceId: b.id, amount: '1000' })).status).toBe(403);
    const ok = (await post(fin, `/api/supplier-advances/${free.id}/apply`, { purchaseInvoiceId: b.id, amount: '200000', date: day }).expect(201)).body;
    expect(ok.remaining).toBe('800000.00');
    expect(before - (await balance1720())).toBe(200000);
    const inv = (await get(owner, `/api/purchase-invoices/${b.id}`).expect(200)).body;
    expect(Number(inv.paidAmount)).toBe(200000);
    expect(inv.status).toBe('PARTIAL');
    // lunasi sisa faktur dari DP yang sama
    await post(fin, `/api/supplier-advances/${free.id}/apply`, { purchaseInvoiceId: b.id, amount: '100000', date: day }).expect(201);
    expect((await get(owner, `/api/purchase-invoices/${b.id}`).expect(200)).body.status).toBe('PAID');
    expect((await post(fin, `/api/supplier-advances/${free.id}/apply`, { purchaseInvoiceId: b.id, amount: '1', date: day })).status).toBe(400); // faktur sudah lunas

    // DP milik PO: ke faktur tanpa PO ditolak; ke faktur dari PO itu diterima dan melunasi sebagian
    const pos = ((await get(owner, '/api/supplier-advances?supplierId=' + sup).expect(200)).body as { id: string; purchaseOrderId: string | null; purchaseOrderNumber: string }[]).filter((x) => x.purchaseOrderId);
    const bound = pos[0];
    const b3 = await bill(sup, '100000');
    expect((await post(fin, `/api/supplier-advances/${bound.id}/apply`, { purchaseInvoiceId: b3.id, amount: '1000', date: day })).status).toBe(400);
    const poId = bound.purchaseOrderId!;
    await post(wh, `/api/purchase-orders/${poId}/receipts`, {}).expect(201);
    const inv2 = (await post(fin, '/api/purchase-invoices', { purchaseOrderId: poId, supplierInvoiceNo: `UMP-PO-${stamp}`, date: day }).expect(201)).body;
    const r = await post(fin, `/api/supplier-advances/${bound.id}/apply`, { purchaseInvoiceId: inv2.id, amount: '1000', date: day }).expect(201);
    expect(r.body.invoice).toBe(inv2.number);
    // DP lain milik PO yang sama kini terkena kontrol "PO sudah difakturkan"
    const ctrl = (await get(akt, '/api/supplier-advances/controls').expect(200)).body as { key: string; items: { number: string }[] }[];
    expect(ctrl.find((c) => c.key === 'PO_BILLED')!.items.length).toBeGreaterThanOrEqual(1);
    expect(ctrl.find((c) => c.key === 'NO_PO')!.items.length).toBeGreaterThanOrEqual(1);
  });

  it('pengembalian oleh pemasok: wajib catatan, tidak melebihi sisa, jurnal kas masuk', async () => {
    const a = (await advance(owner, { supplierId: sup2, amount: '600000' }).expect(201)).body as { id: string };
    const before = await balance1720();
    expect((await post(fin, `/api/supplier-advances/${a.id}/refund`, { amount: '100000', note: 'x' })).status).toBe(400);
    expect((await post(fin, `/api/supplier-advances/${a.id}/refund`, { amount: '700000', note: 'Pesanan batal sebagian', date: day })).status).toBe(400);
    const r = (await post(fin, `/api/supplier-advances/${a.id}/refund`, { amount: '250000', note: 'Pesanan batal sebagian', date: day }).expect(201)).body;
    expect(r.remaining).toBe('350000.00');
    expect(before - (await balance1720())).toBe(250000);
    const d = (await get(fin, `/api/supplier-advances/${a.id}`).expect(200)).body;
    expect(d.movements).toHaveLength(1);
    expect(d.movements[0].kind).toBe('REFUND');
    // sisa dipakai ke faktur → ditutup
    const b = await bill(sup2, '350000');
    await post(fin, `/api/supplier-advances/${a.id}/apply`, { purchaseInvoiceId: b.id, amount: '350000', date: day }).expect(201);
    expect((await get(fin, `/api/supplier-advances/${a.id}`).expect(200)).body.status).toBe('CLOSED');
    expect((await post(fin, `/api/supplier-advances/${a.id}/refund`, { amount: '1', note: 'sudah habis' })).status).toBe(400);
  });

  it('batal: hanya Admin/Pemilik, hanya bila belum dipakai; jurnal dibalik; tidak bisa dipakai lagi', async () => {
    const a = (await advance(owner, { supplierId: sup2, amount: '123000' }).expect(201)).body as { id: string };
    const before = await balance1720();
    expect((await post(fin, `/api/supplier-advances/${a.id}/void`, { reason: 'salah catat' })).status).toBe(403);
    expect((await post(owner, `/api/supplier-advances/${a.id}/void`, { reason: 'x' })).status).toBe(400);
    await post(owner, `/api/supplier-advances/${a.id}/void`, { reason: 'salah catat nominal' }).expect(201);
    expect(before - (await balance1720())).toBe(123000);
    expect((await post(owner, `/api/supplier-advances/${a.id}/void`, { reason: 'dua kali' })).status).toBe(400);
    const b = await bill(sup2, '123000');
    expect((await post(fin, `/api/supplier-advances/${a.id}/apply`, { purchaseInvoiceId: b.id, amount: '1000', date: day })).status).toBe(400);
    // yang sudah dipakai tidak bisa dibatalkan
    const used = (await advance(owner, { supplierId: sup2, amount: '50000' }).expect(201)).body as { id: string };
    await post(fin, `/api/supplier-advances/${used.id}/apply`, { purchaseInvoiceId: b.id, amount: '50000', date: day }).expect(201);
    expect((await post(owner, `/api/supplier-advances/${used.id}/void`, { reason: 'sudah terpakai' })).status).toBe(400);
  });

  it('jejak audit, dokumen sumber jurnal, dan isolasi antar perusahaan', async () => {
    const a = ((await get(owner, '/api/supplier-advances?supplierId=' + sup).expect(200)).body as { id: string }[])[0];
    // dokumen sumber jurnal bisa dibuka (buku besar → dokumen) untuk ketiga jenis jurnal
    const db = app.get<Db>(DB);
    const tenantId = (await get(owner, '/api/auth/me').expect(200)).body.tenantId;
    for (const [src, title] of [['SUPPLIER_ADVANCE', 'Uang muka pemasok'], ['SUPPLIER_ADVANCE_APPLY', 'Pemakaian uang muka pemasok'], ['SUPPLIER_ADVANCE_REFUND', 'Pengembalian uang muka pemasok']] as const) {
      const j = (await db.execute<{ id: string }>(sql`SELECT id FROM journal_entries WHERE tenant_id = ${tenantId} AND source_type = ${src} LIMIT 1`)).rows[0];
      expect(j).toBeTruthy();
      const doc = (await get(owner, `/api/accounting/journals/${j.id}/document`).expect(200)).body;
      expect(doc.document.title).toBe(title);
      expect(doc.journal.docRoute).toBeTruthy();
    }
    // jejak audit lengkap: dibuat, dipakai, dikembalikan, dibatalkan
    const acts = (await db.execute<{ action: string }>(sql`SELECT DISTINCT action FROM audit_logs WHERE tenant_id = ${tenantId} AND entity = 'SupplierAdvance'`)).rows.map((r) => r.action).sort();
    expect(acts).toEqual(['APPLY', 'CREATE', 'REFUND', 'VOID']);
    const other = (await http.post('/api/auth/register').send({ companyName: 'PT Lain DP', name: 'Lain', email: `ump-x-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    expect((await get(other, '/api/supplier-advances').expect(200)).body).toHaveLength(0);
    expect((await get(other, `/api/supplier-advances/${a.id}`)).status).toBe(404);
    expect((await post(other, `/api/supplier-advances/${a.id}/void`, { reason: 'coba tembus tenant' })).status).toBe(404);
    expect((await post(other, `/api/supplier-advances/${a.id}/refund`, { amount: '1', note: 'coba tembus tenant' })).status).toBe(404);
  });
});
