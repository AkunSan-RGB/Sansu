/**
 * Laporan pendukung FMCG (e2e): penjualan per sales, komisi, rebate outlet, klaim prinsipal, tukar-guling, dan setoran kanvas
 * dicocokkan dengan buku besar.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';
import { todayJakarta } from '../src/common/utils/dates';

type Rec = { key: string; ok: boolean; diff: number; left: { value: number }; right: { value: number } };
type Rep = { conclusion: { status: string; summary: string; findings: { level: string; title: string; action?: string }[] }; reconciliation: Rec[]; sections: { key: string; tables: { rows: (string | number | null)[][]; total?: (string | number | null)[] }[] }[] };

describe('Laporan pendukung FMCG (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  let owner: string;
  let tenantId: string;
  let wh: string;
  let P: string;
  const tok: Record<string, { token: string; id: string }> = {};
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const d = new Date();
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 10));
  const period = prev.toISOString().slice(0, 7);
  const prevDate = prev.toISOString().slice(0, 10);
  const from = `${period}-01`;
  const day = todayJakarta();
  const mk = async (role: string, n: string) => {
    await post('/api/users', { name: n, email: `lf-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    const r = (await http.post('/api/auth/login').send({ email: `lf-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body;
    tok[n] = { token: r.accessToken, id: r.user.id };
  };
  const sell = async (customerId: string, qty: string, t = owner) => {
    const so = (await post('/api/sales-orders', { customerId, warehouseId: wh, date: prevDate, lines: [{ productId: P, qty }] }, t).expect(201)).body;
    await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    return (await post('/api/invoices', { salesOrderId: so.id, date: prevDate }).expect(201)).body;
  };
  const rec = (r: Rep, key: string) => r.reconciliation.find((x) => x.key === key)!;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    const reg = (await http.post('/api/auth/register').send({ companyName: 'PT Laporan FMCG', name: 'Pemilik', email: `lf-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FMCG' }).expect(201)).body;
    owner = reg.accessToken;
    tenantId = reg.user.tenantId;
    for (const [role, n] of [['ADMIN', 'adm'], ['ACCOUNTANT', 'akn'], ['FINANCE', 'fin'], ['SALES', 'sls'], ['WAREHOUSE', 'gdg']] as const) await mk(role, n);
    wh = (await get('/api/warehouses').expect(200)).body[0].id;
    P = (await post('/api/products', { sku: 'MIE', name: 'Mi', baseUom: 'PCS', sellPrice: '1000' }).expect(201)).body.id;
    await post('/api/inventory/adjustments', { warehouseId: wh, reason: 'OPENING', date: '2026-01-01', lines: [{ productId: P, qty: '100000', unitCost: '600' }] }).expect(201);

    // penjualan sales + target + komisi
    const outlet = (await post('/api/customers', { code: 'OTL', name: 'Outlet' }).expect(201)).body.id;
    await sell(outlet, '10000', tok.sls.token); // DPP 10.000.000 atas nama sales
    await db.execute(sql`INSERT INTO sales_targets (tenant_id, user_id, period, target_amount, commission_pct, min_achievement_pct) VALUES (${tenantId}, ${tok.sls.id}, ${period}, '8000000', '2', '80')`);
    await post('/api/sales-commissions/close', { period }, tok.akn.token).expect(201);

    // rebate outlet: 2% × 1.000.000 = 20.000, dibayar sebagian
    const giant = (await post('/api/customers', { code: 'GIANT', name: 'Hypermarket' }).expect(201)).body.id;
    await post('/api/trade-terms', { customerId: giant, name: 'Rebate', kind: 'PCT_SALES', value: '2' }, tok.adm.token).expect(201);
    await sell(giant, '1000');
    await post('/api/trade-accruals/accrue', { period }, tok.akn.token).expect(201);
    const acc = (await get(`/api/trade-accruals?period=${period}`, tok.fin.token).expect(200)).body[0];
    await post(`/api/trade-accruals/${acc.id}/settle`, { mode: 'PAY', amount: '5000' }, tok.fin.token).expect(201);

    // promo didanai prinsipal 50% → klaim 5.000, disetujui 4.000, belum cair
    const sup = (await post('/api/suppliers', { code: 'PRI', name: 'PT Prinsipal' }).expect(201)).body.id;
    await post('/api/promos', { name: 'Diskon 10% min 100', kind: 'DISCOUNT', productId: P, minQty: '100', discountPct: '10', fundedSupplierId: sup, fundedPct: '50' }).expect(201);
    const klm = (await post('/api/customers', { code: 'KLM', name: 'Outlet Klaim' }).expect(201)).body.id;
    await sell(klm, '100');
    const claim = (await post('/api/principal-claims/generate', { supplierId: sup, period }, tok.akn.token).expect(201)).body;
    await post(`/api/principal-claims/${claim.id}/submit`, {}, tok.akn.token).expect(201);
    await post(`/api/principal-claims/${claim.id}/decide`, { approvedAmount: '4000', principalRef: 'NK-1' }, tok.adm.token).expect(201);

    // tukar-guling hari ini: 10 × 600 = 6.000
    const baru = (await post('/api/customers', { code: 'BARU', name: 'Outlet Baru' }).expect(201)).body.id;
    const so = (await post('/api/sales-orders', { customerId: baru, warehouseId: wh, lines: [{ productId: P, qty: '100' }] }).expect(201)).body;
    await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    const inv = (await post('/api/invoices', { salesOrderId: so.id }).expect(201)).body;
    const lineId = (await get(`/api/invoices/${inv.id}`).expect(200)).body.lines[0].id;
    const swap = (await post('/api/goods-swaps', { invoiceId: inv.id, reason: 'EXPIRED', lines: [{ invoiceLineId: lineId, qty: '10' }] }, tok.sls.token).expect(201)).body.id;
    await post(`/api/goods-swaps/${swap}/approve`, {}, tok.fin.token).expect(201);

    // kanvas: sales menyetor 5.000 tetapi Keuangan hanya menerima 4.000 (kurang 1.000)
    const van = (await post('/api/canvass/vans', { userId: tok.sls.id }, tok.adm.token).expect(201)).body.id;
    await post(`/api/canvass/vans/${van}/load`, { warehouseId: wh, lines: [{ productId: P, qty: '100' }] }, tok.gdg.token).expect(201);
    await post('/api/canvass/sales', { customerId: baru, lines: [{ productId: P, qty: '10' }], collect: { amount: '5000', method: 'CASH' } }, tok.sls.token).expect(201);
    const col = (await get('/api/canvass/collections?status=PENDING').expect(200)).body[0];
    await post(`/api/canvass/collections/${col.id}/verify`, { receivedAmount: '4000' }, tok.fin.token).expect(201);
  });
  afterAll(() => app.close());

  it('semua pencocokan buku besar cocok dan angkanya sesuai transaksi', async () => {
    const r = (await get(`/api/accounting/support/fmcg?from=${from}&to=${day}`).expect(200)).body as Rep;
    expect(r.reconciliation.map((x) => x.key)).toEqual(['fmcg-commission', 'fmcg-commission-payable', 'fmcg-trade', 'fmcg-claim', 'fmcg-swap', 'fmcg-canvass']);
    for (const x of r.reconciliation) expect({ key: x.key, ok: x.ok, diff: x.diff }).toEqual({ key: x.key, ok: true, diff: 0 });
    expect(rec(r, 'fmcg-commission').left.value).toBe(200_000);
    expect(rec(r, 'fmcg-commission-payable').left.value).toBe(200_000);
    expect(rec(r, 'fmcg-trade').left.value).toBe(15_000);
    expect(rec(r, 'fmcg-claim').left.value).toBe(4_000);
    expect(rec(r, 'fmcg-swap').left.value).toBe(6_000);
    expect(rec(r, 'fmcg-canvass').left.value).toBe(1_000);
    const sales = r.sections.find((s) => s.key === 'fmcg-sales')!.tables[0].rows;
    expect(sales.find((x) => x[0] === 'sls')?.[2]).toBe(10_010_000); // termasuk penjualan kanvas 10.000
    expect(sales.find((x) => x[0] === 'Tanpa sales')).toBeDefined();
    const comm = r.sections.find((s) => s.key === 'fmcg-commission')!.tables[0].rows[0];
    expect(comm.slice(1, 3)).toEqual(['sls', period]);
    expect(comm[5]).toBe(125); // capaian 125%
    const cv = r.sections.find((s) => s.key === 'fmcg-canvass')!.tables[0].rows[0];
    expect(cv.slice(0, 5)).toEqual(['sls', 1, 5000, 4000, 1000]);
    const titles = r.conclusion.findings.map((f) => f.title).join('|');
    expect(titles).toContain('Kurang setor kanvas Rp1.000');
    expect(titles).toContain('klaim prinsipal disetujui belum cair');
    expect(r.conclusion.status).toBe('warning');
    expect(r.conclusion.findings.every((f) => f.level === 'ok' || f.level === 'info' || f.action)).toBe(true);
  });

  it('pencocokan saldo dihitung per tanggal akhir: sebelum komisi ditutup semuanya nol, dan tetap cocok', async () => {
    const early = (await get(`/api/accounting/support/fmcg?from=${period}-01&to=${period}-02`).expect(200)).body as Rep;
    for (const x of early.reconciliation.filter((y) => ['fmcg-commission-payable', 'fmcg-claim'].includes(y.key))) expect({ key: x.key, ok: x.ok, left: x.left.value, right: x.right.value }).toEqual({ key: x.key, ok: true, left: 0, right: 0 });
  });

  it('rebate outlet per tanggal akhir: sebelum pelunasan masih utang penuh, sesudahnya berkurang, keduanya cocok dengan buku besar', async () => {
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)).toISOString().slice(0, 10); // akhir bulan lalu (tanggal jurnal rebate)
    const before = (await get(`/api/accounting/support/fmcg?from=${period}-01&to=${lastDay}`).expect(200)).body as Rep;
    const t0 = before.reconciliation.find((x) => x.key === 'fmcg-trade')!;
    expect({ ok: t0.ok, left: t0.left.value, right: t0.right.value }).toEqual({ ok: true, left: 20_000, right: 20_000 }); // pelunasan 5.000 baru hari ini
    const now = (await get(`/api/accounting/support/fmcg?from=${period}-01&to=${day}`).expect(200)).body as Rep;
    const t1 = now.reconciliation.find((x) => x.key === 'fmcg-trade')!;
    expect({ ok: t1.ok, left: t1.left.value }).toEqual({ ok: true, left: 15_000 });
    const row = now.sections.find((s) => s.key === 'fmcg-trade')!.tables[0].rows[0];
    expect(row.slice(5, 9)).toEqual([20_000, 5_000, 15_000, 'Utang']);
    const rowBefore = before.sections.find((s) => s.key === 'fmcg-trade')!.tables[0].rows[0];
    expect(rowBefore.slice(5, 9)).toEqual([20_000, 0, 20_000, 'Utang']);
  });

  it('akses: sales tidak boleh membuka laporan', async () => {
    await get(`/api/accounting/support/fmcg?from=${from}&to=${day}`, tok.sls.token).expect(403);
  });
});
