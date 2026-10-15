/**
 * FMCG: kanvas / van sales — stok mobil, penjualan tanpa kendali harga oleh sales, setoran tagihan yang diverifikasi Keuangan
 * (kekurangan tercatat), rute & kunjungan berkoordinat, ringkasan harian.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';
import { haversineM } from '../src/modules/sales/canvass/canvass';

describe('FMCG: kanvas (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const stamp = Date.now();
  let owner: string;
  let tenantId: string;
  let wh: string;
  let P: string;
  let cust: string;
  let van: string;
  const tok: Record<string, { token: string; id: string }> = {};
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const mk = async (role: string, n: string) => {
    await post('/api/users', { name: n, email: `kv-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    const r = (await http.post('/api/auth/login').send({ email: `kv-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body;
    tok[n] = { token: r.accessToken, id: r.user.id };
  };
  const bal = async (code: string) => Number((await db.execute<{ b: string }>(sql`SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS b FROM journal_lines l JOIN accounts a ON a.id = l.account_id JOIN journal_entries j ON j.id = l.journal_id WHERE j.tenant_id = ${tenantId} AND a.code = ${code}`)).rows[0].b);
  const qtyAt = async (w: string) => Number((await db.execute<{ q: string }>(sql`SELECT COALESCE(SUM(qty), 0)::text AS q FROM stock_balances WHERE tenant_id = ${tenantId} AND warehouse_id = ${w}`)).rows[0].q);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    const reg = (await http.post('/api/auth/register').send({ companyName: 'PT Kanvas Uji', name: 'Pemilik', email: `kv-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FMCG' }).expect(201)).body;
    owner = reg.accessToken;
    tenantId = reg.user.tenantId;
    for (const [role, n] of [['SALES', 'sls'], ['SALES', 'sls2'], ['WAREHOUSE', 'gdg'], ['FINANCE', 'fin'], ['ADMIN', 'adm']] as const) await mk(role, n);
    wh = (await get('/api/warehouses').expect(200)).body[0].id;
    P = (await post('/api/products', { sku: 'MIE', name: 'Mi', baseUom: 'PCS', sellPrice: '1000' }).expect(201)).body.id;
    await post('/api/inventory/adjustments', { warehouseId: wh, reason: 'OPENING', date: '2026-01-01', lines: [{ productId: P, qty: '1000', unitCost: '600' }] }).expect(201);
    // outlet dengan daftar harga Grosir (950/pcs) dan koordinat tetap
    const list = (await post('/api/price-lists', { name: 'Grosir' }).expect(201)).body.id;
    await http.put(`/api/price-lists/${list}/items`).set(as(owner)).send({ items: [{ productId: P, minQty: '1', price: '950' }] }).expect(200);
    cust = (await post('/api/customers', { code: 'WRG', name: 'Warung Bu Sari', priceListId: list, geoLat: -6.2, geoLng: 106.8 }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('rumus jarak: ±1,1 km untuk selisih 0,01° lintang', () => {
    expect(haversineM(-6.2, 106.8, -6.21, 106.8)).toBeGreaterThan(1100);
    expect(haversineM(-6.2, 106.8, -6.21, 106.8)).toBeLessThan(1120);
    expect(haversineM(-6.2, 106.8, -6.2, 106.8)).toBe(0);
  });

  it('mobil: hanya Admin membuat untuk Sales; satu mobil per sales; gudang memuat stok', async () => {
    expect((await post('/api/canvass/vans', { userId: tok.sls.id }, tok.gdg.token)).status).toBe(403);
    expect((await post('/api/canvass/vans', { userId: tok.gdg.id }, tok.adm.token)).status).toBe(400); // bukan Sales
    van = (await post('/api/canvass/vans', { userId: tok.sls.id }, tok.adm.token).expect(201)).body.id;
    expect((await post('/api/canvass/vans', { userId: tok.sls.id }, tok.adm.token)).status).toBe(400);
    const before = await qtyAt(wh);
    await post(`/api/canvass/vans/${van}/load`, { warehouseId: wh, lines: [{ productId: P, qty: '100' }] }, tok.gdg.token).expect(201);
    expect(await qtyAt(wh)).toBe(before - 100);
    expect(await qtyAt(van)).toBe(100);
    expect((await post(`/api/canvass/vans/${van}/load`, { warehouseId: wh, lines: [{ productId: P, qty: '1' }] }, tok.sls.token)).status).toBe(403);
  });

  it('mobil orang lain tidak dapat dipakai; sales tanpa mobil ditolak', async () => {
    const so = await post('/api/sales-orders', { customerId: cust, warehouseId: van, lines: [{ productId: P, qty: '1' }] }, tok.sls2.token);
    expect(so.status).toBe(400);
    expect(JSON.stringify(so.body)).toMatch(/mobil sales lain/);
    const r = await post('/api/canvass/sales', { customerId: cust, lines: [{ productId: P, qty: '1' }] }, tok.sls2.token);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/belum punya mobil/);
  });

  let invoiceId: string;
  let colId: string;
  it('penjualan kanvas: harga mengikuti daftar harga outlet walau sales mencoba menimpa; stok mobil berkurang; setoran menunggu', async () => {
    const r = await post('/api/canvass/sales', { customerId: cust, lines: [{ productId: P, qty: '10' }], collect: { amount: '5000', method: 'CASH' } }, tok.sls.token);
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    invoiceId = r.body.invoiceId;
    const inv = (await get(`/api/invoices/${invoiceId}`).expect(200)).body;
    expect(Number(inv.lines[0].price)).toBe(950);
    expect(Number(inv.paidAmount)).toBe(0); // uang belum dianggap diterima
    expect(await qtyAt(van)).toBe(90);
    const cols = (await get('/api/canvass/collections?status=PENDING').expect(200)).body;
    expect(cols).toHaveLength(1);
    colId = cols[0].id;
    expect(Number(cols[0].amount)).toBe(5000);
    // harga/potongan tidak bisa dikirim sales
    const tamper = await post('/api/canvass/sales', { customerId: cust, lines: [{ productId: P, qty: '1', price: '1', discountPct: '90' }] }, tok.sls.token);
    if (tamper.status === 201) {
      const t = (await get(`/api/invoices/${tamper.body.invoiceId}`).expect(200)).body;
      expect(Number(t.lines[0].price)).toBe(950);
      expect(Number(t.lines[0].discountPct)).toBe(0);
    } else expect(tamper.status).toBe(400);
  });

  it('setoran: sales lain tidak bisa menagih faktur ini; tidak melebihi sisa tagihan; verifikasi Keuangan → pelunasan hanya sebesar uang diterima, kekurangan tercatat', async () => {
    expect((await post('/api/canvass/collections', { invoiceId, amount: '100' }, tok.sls2.token)).status).toBe(403);
    expect((await post('/api/canvass/collections', { invoiceId, amount: '99999999' }, tok.sls.token)).status).toBe(400);
    expect((await post(`/api/canvass/collections/${colId}/verify`, { receivedAmount: '5000' }, tok.sls.token)).status).toBe(403); // peran
    expect((await post(`/api/canvass/collections/${colId}/verify`, { receivedAmount: '6000' }, tok.fin.token)).status).toBe(400); // lebih dari klaim
    const v = (await post(`/api/canvass/collections/${colId}/verify`, { receivedAmount: '4000' }, tok.fin.token).expect(201)).body;
    expect(Number(v.shortage)).toBe(1000);
    // outlet memang sudah membayar Rp 5.000 ke sales → faktur lunas sebesar itu; kurang setor Rp 1.000 menjadi piutang karyawan (tercatat di pembukuan)
    expect(Number((await get(`/api/invoices/${invoiceId}`).expect(200)).body.paidAmount)).toBe(5000);
    expect(await bal('1-1600')).toBe(1000);
    expect((await post(`/api/canvass/collections/${colId}/verify`, { receivedAmount: '4000' }, tok.fin.token)).status).toBe(400); // tidak dobel
  });

  it('setoran yang ditolak dicatat sebagai kekurangan penuh dan tidak melunasi faktur', async () => {
    const c = (await post('/api/canvass/collections', { invoiceId, amount: '2000' }, tok.sls.token).expect(201)).body;
    await post(`/api/canvass/collections/${c.id}/reject`, { reason: 'Uang tidak disetor' }, tok.fin.token).expect(201);
    expect(Number((await get(`/api/invoices/${invoiceId}`).expect(200)).body.paidAmount)).toBe(5000);
    const rej = (await get('/api/canvass/collections?status=REJECTED').expect(200)).body;
    expect(Number(rej[0].shortage)).toBe(2000);
  });

  it('penjualan dari mobil lewat pesanan biasa dengan harga/potongan sendiri ditolak; Sales tidak bisa mengalihkan pesanan atau memberi syarat komersial outlet', async () => {
    const free = await post('/api/sales-orders', { customerId: cust, warehouseId: van, lines: [{ productId: P, qty: '1', price: '1' }] }, tok.sls.token);
    expect(free.status).toBe(400);
    expect(JSON.stringify(free.body)).toMatch(/Kanvas/);
    const alih = await post('/api/sales-orders', { customerId: cust, warehouseId: wh, salespersonId: tok.sls2.id, lines: [{ productId: P, qty: '1' }] }, tok.sls.token);
    expect(alih.status).toBe(400);
    expect((await post('/api/customers', { code: 'BARU', name: 'Outlet Baru', priceListId: (await get('/api/price-lists').expect(200)).body[0].id }, tok.sls.token)).status).toBe(403);
    expect((await post('/api/customers', { code: 'BARU2', name: 'Outlet Baru 2', creditLimit: '99999999' }, tok.sls.token)).status).toBe(403);
    await post('/api/customers', { code: 'BARU3', name: 'Outlet Baru 3' }, tok.sls.token).expect(201); // tanpa syarat komersial: boleh
  });

  it('pemisahan fungsi setoran: Admin yang membuat setoran atas nama sales tidak dapat memverifikasinya sendiri; HPP mobil tidak terlihat Sales', async () => {
    const r = await post('/api/canvass/sales', { customerId: cust, vanId: van, lines: [{ productId: P, qty: '1' }], collect: { amount: '500' } }, tok.adm.token);
    expect(r.status).toBe(201);
    const col = (await get('/api/canvass/collections?status=PENDING', tok.fin.token).expect(200)).body.find((c: { amount: string }) => Number(c.amount) === 500);
    expect((await post(`/api/canvass/collections/${col.id}/verify`, { receivedAmount: '500' }, tok.adm.token)).status).toBe(403);
    await post(`/api/canvass/collections/${col.id}/verify`, { receivedAmount: '500' }, tok.fin.token).expect(201);
    const vans = (await get('/api/canvass/vans', tok.sls.token).expect(200)).body;
    expect(Number(vans[0].value)).toBe(0);
    expect(Number((await get('/api/canvass/vans').expect(200)).body[0].value)).toBeGreaterThan(0);
  });

  it('gudang mobil tidak dapat dipakai lewat jalur lain (transfer biasa, kasir, pembelian, penyesuaian stok)', async () => {
    expect((await post('/api/inventory/transfers', { fromWarehouseId: van, toWarehouseId: wh, mode: 'DIRECT', lines: [{ productId: P, qty: '1' }] })).status).toBe(400);
    await post('/api/apps/pos/install', {}).expect(201);
    expect((await post('/api/pos/sessions', { warehouseId: van, openingCash: '0' })).status).toBe(400);
    expect((await post('/api/inventory/adjustments', { warehouseId: van, reason: 'DAMAGED', lines: [{ productId: P, qty: '-1' }] })).status).toBe(400);
    const sup = (await post('/api/suppliers', { code: 'S1', name: 'Pemasok' }).expect(201)).body.id;
    expect((await post('/api/purchase-orders', { supplierId: sup, warehouseId: van, lines: [{ productId: P, qty: '1', price: '100' }] })).status).toBe(400);
  });

  it('rute & kunjungan: jadwal hari ini, kunjungan sekali per outlet per hari, jarak dari koordinat outlet menandai kunjungan jauh', async () => {
    const weekday = ((new Date().getUTCDay() + 6) % 7) + 1;
    expect((await post('/api/canvass/routes', { name: 'Rute Depok', salespersonId: tok.sls.id, weekday, customerIds: [cust] }, tok.sls.token)).status).toBe(403);
    await post('/api/canvass/routes', { name: 'Rute Depok', salespersonId: tok.sls.id, weekday, customerIds: [cust] }, tok.adm.token).expect(201);
    expect((await post('/api/canvass/routes', { name: 'rute depok', salespersonId: tok.sls.id, customerIds: [] }, tok.adm.token)).status).toBe(400); // nama kembar
    const v = (await post('/api/canvass/visits', { customerId: cust, result: 'ORDER', lat: -6.21, lng: 106.8 }, tok.sls.token).expect(201)).body;
    expect(v.farFromOutlet).toBe(true);
    expect(v.distanceM).toBeGreaterThan(1000);
    expect((await post('/api/canvass/visits', { customerId: cust, result: 'NO_ORDER' }, tok.sls.token)).status).toBe(400); // sekali per hari
    expect((await post('/api/canvass/visits', { customerId: cust, result: 'ORDER' }, tok.adm.token)).status).toBe(403); // hanya Sales
    const s = (await get('/api/canvass/summary', tok.fin.token).expect(200)).body;
    const row = s.rows.find((r: { userId: string }) => r.userId === tok.sls.id);
    expect(row.plannedStops).toBe(1);
    expect(row.visits).toBe(1);
    expect(row.effectiveCalls).toBe(1);
    expect(row.farVisits).toBe(1);
    expect(row.invoices).toBeGreaterThanOrEqual(1);
    expect(Number(row.shortage)).toBe(3000); // 1.000 kurang setor + 2.000 ditolak
    expect(Number(row.vanQty)).toBeLessThan(100);
    // Sales hanya melihat dirinya
    const mine = (await get('/api/canvass/summary', tok.sls.token).expect(200)).body;
    expect(mine.rows.map((r: { userId: string }) => r.userId)).toEqual([tok.sls.id]);
  });

  it('bongkar mobil mengembalikan sisa stok ke gudang', async () => {
    const left = await qtyAt(van);
    const before = await qtyAt(wh);
    await post(`/api/canvass/vans/${van}/unload`, { warehouseId: wh, lines: [{ productId: P, qty: String(left) }] }, tok.gdg.token).expect(201);
    expect(await qtyAt(van)).toBe(0);
    expect(await qtyAt(wh)).toBe(before + left);
  });
});
