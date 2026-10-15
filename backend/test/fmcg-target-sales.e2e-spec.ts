/**
 * FMCG: target & komisi sales — omzet neto (DPP faktur − DPP retur) per sales, komisi bersyarat ambang pencapaian,
 * hanya Pemilik/Admin yang mengatur target, Sales hanya melihat angkanya sendiri.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('FMCG: target & komisi sales (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  let owner: string;
  let rina: string;
  let andi: string;
  let rinaId: string;
  let andiId: string;
  let wh: string;
  let ownerId: string;
  let P: string;
  let cust: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const month = new Date().toISOString().slice(0, 7);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    const reg = (await http.post('/api/auth/register').send({ companyName: 'PT Target Uji', name: 'Pemilik', email: `tg-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FMCG' }).expect(201)).body;
    owner = reg.accessToken;
    ownerId = reg.user.id;
    for (const n of ['rina', 'andi']) await post('/api/users', { name: n, email: `tg-${n}-${stamp}@uji.id`, password: 'sales12345', role: 'SALES' }).expect(201);
    const login = async (n: string) => (await http.post('/api/auth/login').send({ email: `tg-${n}-${stamp}@uji.id`, password: 'sales12345' }).expect(200)).body;
    const r = await login('rina');
    const a = await login('andi');
    rina = r.accessToken;
    andi = a.accessToken;
    rinaId = r.user.id;
    andiId = a.user.id;
    wh = (await get('/api/warehouses').expect(200)).body[0].id;
    P = (await post('/api/products', { sku: 'MIE', name: 'Mi', baseUom: 'PCS', sellPrice: '1000' }).expect(201)).body.id;
    await post('/api/inventory/adjustments', { warehouseId: wh, reason: 'OPENING', date: '2026-01-01', lines: [{ productId: P, qty: '100000', unitCost: '600' }] }).expect(201);
    cust = (await post('/api/customers', { code: 'OTL', name: 'Outlet' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  const sellAs = async (t: string, qty: string, extra: object = {}) => {
    const so = (await post('/api/sales-orders', { customerId: cust, warehouseId: wh, lines: [{ productId: P, qty }], ...extra }, t).expect(201)).body;
    await post(`/api/sales-orders/${so.id}/confirm`, {}, owner).expect(201);
    return (await post('/api/invoices', { salesOrderId: so.id }).expect(201)).body;
  };

  it('Sales membuat pesanan → otomatis dikaitkan ke dirinya; Admin bisa menunjuk sales; non-Sales ditolak', async () => {
    await sellAs(rina, '10000'); // 10.000.000 DPP
    await sellAs(andi, '4000'); // 4.000.000
    await sellAs(owner, '1000', { salespersonId: andiId }); // pemilik menunjuk Andi: +1.000.000
    await sellAs(owner, '500'); // tanpa sales: tidak dihitung ke siapa pun
    expect((await post('/api/sales-orders', { customerId: cust, warehouseId: wh, salespersonId: ownerId, lines: [{ productId: P, qty: '1' }] })).status).toBe(400);
  });

  it('target & komisi: omzet neto, ambang pencapaian, komisi dibulatkan; angka bulan lain kosong', async () => {
    await http.put('/api/sales-targets').set(as(owner)).send({ period: month, items: [
      { userId: rinaId, targetAmount: '10000000', commissionPct: '2', minAchievementPct: '80' },
      { userId: andiId, targetAmount: '10000000', commissionPct: '2', minAchievementPct: '80' },
    ] }).expect(200);
    const r = (await get(`/api/sales-targets?month=${month}`).expect(200)).body;
    const rina_ = r.rows.find((x: { userId: string }) => x.userId === rinaId);
    const andi_ = r.rows.find((x: { userId: string }) => x.userId === andiId);
    expect(Number(rina_.net)).toBe(10_000_000);
    expect(Number(rina_.achievementPct)).toBe(100);
    expect(Number(rina_.commission)).toBe(200_000);
    expect(Number(andi_.net)).toBe(5_000_000);
    expect(Number(andi_.achievementPct)).toBe(50);
    expect(Number(andi_.commission)).toBe(0); // di bawah ambang 80%
    expect(andi_.commissionNote).toMatch(/di bawah ambang/);
    expect(Number(r.totals.commission)).toBe(200_000);
    const other = (await get('/api/sales-targets?month=2020-01').expect(200)).body;
    expect(other.rows.every((x: { net: string }) => Number(x.net) === 0)).toBe(true);
  });

  it('retur penjualan mengurangi omzet neto sales', async () => {
    const inv = await sellAs(rina, '2000'); // +2.000.000 → 12.000.000
    const full = (await get(`/api/invoices/${inv.id}`).expect(200)).body;
    await post('/api/sales-returns', { invoiceId: inv.id, reason: 'Rusak', lines: [{ invoiceLineId: full.lines[0].id, qty: '1000' }] }).expect(201);
    const r = (await get(`/api/sales-targets?month=${month}`).expect(200)).body.rows.find((x: { userId: string }) => x.userId === rinaId);
    expect(Number(r.gross)).toBe(12_000_000);
    expect(Number(r.returns)).toBe(1_000_000);
    expect(Number(r.net)).toBe(11_000_000);
    expect(Number(r.commission)).toBe(220_000);
  });

  it('hak: hanya Admin/Pemilik mengatur target; Sales hanya melihat dirinya; validasi isi', async () => {
    expect((await http.put('/api/sales-targets').set(as(rina)).send({ period: month, items: [] })).status).toBe(403);
    const mine = (await get(`/api/sales-targets?month=${month}`, rina).expect(200)).body;
    expect(mine.rows).toHaveLength(1);
    expect(mine.rows[0].userId).toBe(rinaId);
    const put = (items: object[]) => http.put('/api/sales-targets').set(as(owner)).send({ period: month, items });
    expect((await put([{ userId: rinaId, targetAmount: '-1', commissionPct: '1' }])).status).toBe(400);
    expect((await put([{ userId: rinaId, targetAmount: '1', commissionPct: '150' }])).status).toBe(400);
    expect((await put([{ userId: rinaId, targetAmount: '1', commissionPct: '1' }, { userId: rinaId, targetAmount: '2', commissionPct: '1' }])).status).toBe(400);
    expect((await put([{ userId: ownerId, targetAmount: '1', commissionPct: '1' }])).status).toBe(400); // bukan Sales
    expect((await http.put('/api/sales-targets').set(as(owner)).send({ period: '2026-13', items: [] })).status).toBe(400);
  });
});
