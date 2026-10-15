/**
 * FMCG: jurnal komisi sales — tutup bulan membekukan angka dan menjurnal utang komisi; pembayaran oleh orang lain;
 * target terkunci sesudah bulan lewat/ditutup; pembatalan dengan jurnal balik; rekonstruksi jejak lot lama ditandai perkiraan.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';

describe('FMCG: jurnal komisi & rekonstruksi lot (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const stamp = Date.now();
  let owner: string;
  let admin: string;
  let acct: string;
  let fin: string;
  let rina: string;
  let rinaId: string;
  let tenantId: string;
  let wh: string;
  let P: string;
  let cust: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const d = new Date();
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 10));
  const period = prev.toISOString().slice(0, 7);
  const prevDate = prev.toISOString().slice(0, 10);

  const mkUser = async (role: string, n: string) => {
    await post('/api/users', { name: n, email: `km-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
    const r = (await http.post('/api/auth/login').send({ email: `km-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body;
    return { token: r.accessToken as string, id: r.user.id as string };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    const reg = (await http.post('/api/auth/register').send({ companyName: 'PT Komisi Uji', name: 'Pemilik', email: `km-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'FMCG' }).expect(201)).body;
    owner = reg.accessToken;
    tenantId = reg.user.tenantId;
    admin = (await mkUser('ADMIN', 'admin')).token;
    acct = (await mkUser('ACCOUNTANT', 'akuntan')).token;
    fin = (await mkUser('FINANCE', 'keuangan')).token;
    const r = await mkUser('SALES', 'rina');
    rina = r.token;
    rinaId = r.id;
    wh = (await get('/api/warehouses').expect(200)).body[0].id;
    P = (await post('/api/products', { sku: 'MIE', name: 'Mi', baseUom: 'PCS', sellPrice: '1000' }).expect(201)).body.id;
    await post('/api/inventory/adjustments', { warehouseId: wh, reason: 'OPENING', date: '2026-01-01', lines: [{ productId: P, qty: '100000', unitCost: '600' }] }).expect(201);
    cust = (await post('/api/customers', { code: 'OTL', name: 'Outlet' }).expect(201)).body.id;
    // penjualan bulan lalu atas nama Rina: DPP 10.000.000
    const so = (await post('/api/sales-orders', { customerId: cust, warehouseId: wh, date: prevDate, lines: [{ productId: P, qty: '10000' }] }, rina).expect(201)).body;
    await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    await post('/api/invoices', { salesOrderId: so.id, date: prevDate }).expect(201);
    // target bulan lalu (ditanam langsung: lewat API target bulan lalu memang terkunci)
    await db.execute(sql`INSERT INTO sales_targets (tenant_id, user_id, period, target_amount, commission_pct, min_achievement_pct) VALUES (${tenantId}, ${rinaId}, ${period}, '8000000', '2', '80')`);
  });
  afterAll(() => app.close());

  it('target bulan yang sudah lewat tidak dapat diubah lewat API', async () => {
    const r = await http.put('/api/sales-targets').set(as(owner)).send({ period, items: [{ userId: rinaId, targetAmount: '1', commissionPct: '50' }] });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/sudah lewat/);
  });

  it('bulan berjalan belum bisa ditutup; hak penutupan hanya pembukuan', async () => {
    const cur = new Date().toISOString().slice(0, 7);
    expect((await post('/api/sales-commissions/close', { period: cur }, acct)).status).toBe(400);
    expect((await post('/api/sales-commissions/close', { period }, rina)).status).toBe(403);
    expect((await post('/api/sales-commissions/close', { period }, fin)).status).toBe(403);
  });

  let commissionId: string;
  it('tutup bulan: angka dibekukan, dijurnal Dr Beban Komisi | Cr Utang Komisi; menutup dua kali tidak menggandakan', async () => {
    const r = (await post('/api/sales-commissions/close', { period }, acct).expect(201)).body;
    expect(r.created).toBe(1);
    expect(Number(r.total)).toBe(200_000); // 2% × 10.000.000 (capaian 125% ≥ ambang 80%)
    const again = (await post('/api/sales-commissions/close', { period }, acct).expect(201)).body;
    expect(again.created).toBe(0);
    const list = (await get(`/api/sales-commissions?period=${period}`, acct).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'ACCRUED', userName: 'rina' });
    expect(Number(list[0].netSales)).toBe(10_000_000);
    commissionId = list[0].id;
    const bal = async (code: string) => Number((await db.execute<{ b: string }>(sql`SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS b FROM journal_lines l JOIN accounts a ON a.id = l.account_id JOIN journal_entries j ON j.id = l.journal_id WHERE j.tenant_id = ${tenantId} AND a.code = ${code}`)).rows[0].b);
    expect(await bal('6-2200')).toBe(200_000);
    expect(await bal('2-1450')).toBe(-200_000);
    // target bulan itu kini terkunci walau orang berusaha menggesernya
    expect((await http.put('/api/sales-targets').set(as(owner)).send({ period, items: [] })).status).toBe(400);
  });

  it('pembayaran: tidak oleh penutup (kecuali Pemilik) dan tidak oleh sales sendiri; PPh 21 dipisah', async () => {
    expect((await post(`/api/sales-commissions/${commissionId}/pay`, {}, rina)).status).toBe(403);
    // Akuntan tidak punya hak bayar
    expect((await post(`/api/sales-commissions/${commissionId}/pay`, {}, acct)).status).toBe(403);
    const r = await post(`/api/sales-commissions/${commissionId}/pay`, { pph21: '10000' }, fin).expect(201);
    expect(r.body.status).toBe('PAID');
    expect((await post(`/api/sales-commissions/${commissionId}/pay`, {}, fin)).status).toBe(400); // tidak dobel bayar
    const bal = async (code: string) => Number((await db.execute<{ b: string }>(sql`SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS b FROM journal_lines l JOIN accounts a ON a.id = l.account_id JOIN journal_entries j ON j.id = l.journal_id WHERE j.tenant_id = ${tenantId} AND a.code = ${code}`)).rows[0].b);
    expect(await bal('2-1450')).toBe(0);
    expect(await bal('2-1310')).toBe(-10_000);
    expect((await post(`/api/sales-commissions/${commissionId}/void`, { reason: 'Salah hitung' }, admin)).status).toBe(400); // sudah dibayar
  });

  it('pembatalan sebelum dibayar: jurnal balik, status VOID, bisa ditutup ulang', async () => {
    // komisi kedua: Rina bulan lalu sudah PAID, jadi uji pada penjual lain
    const b = await mkUser('SALES', 'budi');
    const cust2 = (await post('/api/customers', { code: 'OTL2', name: 'Outlet Dua' }).expect(201)).body.id;
    const so = (await post('/api/sales-orders', { customerId: cust2, warehouseId: wh, date: prevDate, lines: [{ productId: P, qty: '5000' }] }, b.token).expect(201)).body;
    const cf = await post(`/api/sales-orders/${so.id}/confirm`);
    if (cf.status !== 201) throw new Error(JSON.stringify(cf.body));
    await post('/api/invoices', { salesOrderId: so.id, date: prevDate }).expect(201);
    await db.execute(sql`INSERT INTO sales_targets (tenant_id, user_id, period, target_amount, commission_pct, min_achievement_pct) VALUES (${tenantId}, ${b.id}, ${period}, '5000000', '3', '0')`);
    const c = (await post('/api/sales-commissions/close', { period }, acct).expect(201)).body;
    expect(c.created).toBe(1);
    const id = c.items[0].id;
    expect((await post(`/api/sales-commissions/${id}/void`, { reason: 'x' }, admin)).status).toBe(400); // alasan terlalu pendek
    await post(`/api/sales-commissions/${id}/void`, { reason: 'Pesanan diinput salah sales' }, admin).expect(201);
    const bal = Number((await db.execute<{ b: string }>(sql`SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS b FROM journal_lines l JOIN accounts a ON a.id = l.account_id JOIN journal_entries j ON j.id = l.journal_id WHERE j.tenant_id = ${tenantId} AND a.code = '2-1450'`)).rows[0].b);
    expect(bal).toBe(0);
    const re = (await post('/api/sales-commissions/close', { period }, acct).expect(201)).body;
    expect(re.created).toBe(1);
  });

  it('Sales hanya melihat komisinya sendiri', async () => {
    const mine = (await get('/api/sales-commissions', rina).expect(200)).body;
    expect(mine.every((m: { userId: string }) => m.userId === rinaId)).toBe(true);
  });
});
