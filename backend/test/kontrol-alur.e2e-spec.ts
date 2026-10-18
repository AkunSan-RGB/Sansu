/**
 * Kontrol anti-fraud per alur: pola penjualan, kasir, kas, dan SDM yang patut diperiksa ditandai dengan rujukan dokumennya.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';

describe('Kontrol anti-fraud per alur (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  let owner: string; let tenantId: string; let hr: string;
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const flows = async () => (await get('/api/controls/flows').expect(200)).body as { key: string; flow: string; level: string; refs: string[]; title: string }[];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    const r = (await http.post('/api/auth/register').send({ companyName: 'PT Kontrol', name: 'P', email: `kf-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'DAGANG' }).expect(201)).body;
    owner = r.accessToken; tenantId = r.user.tenantId;
    await post('/api/users', { name: 'hr', email: `kf-hr-${stamp}@uji.id`, password: 'rahasia12345', role: 'HR' }).expect(201);
    hr = (await http.post('/api/auth/login').send({ email: `kf-hr-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken;
    await post('/api/apps/hr/install').expect(201);
  });
  afterAll(() => app.close());

  it('hanya Admin/Keuangan/Akuntan/Pemilik; HR ditolak', async () => {
    expect((await get('/api/controls/flows', hr)).status).toBe(403);
  });

  it('penjualan: diskon besar, di bawah harga pokok, retur besar, dan batas kredit terlampaui ditandai', async () => {
    const wh = (await get('/api/warehouses').expect(200)).body[0].id;
    const prod = (await post('/api/products', { sku: 'KF1', name: 'Barang', baseUom: 'PCS', sellPrice: '10000' }).expect(201)).body.id;
    const cust = (await post('/api/customers', { code: 'KF', name: 'Toko Curiga', creditLimit: '100000' }).expect(201)).body.id;
    await post('/api/inventory/adjustments', { warehouseId: wh, reason: 'OPENING', date: today, lines: [{ productId: prod, qty: '100', unitCost: '8000' }] }).expect(201);
    expect((await flows()).filter((f) => f.flow === 'PENJUALAN')).toHaveLength(0);
    const so = (await post('/api/sales-orders', { customerId: cust, warehouseId: wh, date: today, lines: [{ productId: prod, qty: '5', discountPct: '30' }] }).expect(201)).body;
    await post(`/api/sales-orders/${so.id}/confirm`).expect(201);
    const inv = (await post('/api/invoices', { salesOrderId: so.id, date: today }).expect(201)).body;
    const f = await flows();
    expect(f.find((x) => x.key === 'sales-discount-high')!.refs[0]).toContain(inv.number);
    expect(f.find((x) => x.key === 'sales-below-cost')!.refs[0]).toContain(inv.number); // 10.000 − 30% = 7.000 < HPP 8.000
    // piutang melebihi batas kredit: turunkan batas setelah faktur
    await http.patch(`/api/customers/${cust}`).set(as(owner)).send({ creditLimit: '1000' }).expect(200);
    expect((await flows()).find((x) => x.key === 'sales-credit-over')).toBeTruthy();
    void tenantId;
  });

  it('SDM: rekening bank ganda antar karyawan ditandai', async () => {
    const e = (code: string) => post('/api/hr/employees', { code, name: `Pegawai ${code}`, ptkp: 'TK/0', joinDate: `${today.slice(0, 4)}-01-02`, baseSalary: '3000000', bankAccount: '1234567890', bpjsKes: false, bpjsTk: false, bpjsJp: false }, hr);
    await e('G-1').then((r) => expect(r.status).toBe(201));
    // pembuatan kedua dengan rekening sama disimpan lewat SQL (pemeriksaan ganda API hanya untuk usaha jasa)
    const second = await e('G-2');
    if (second.status !== 201) {
      const id = (await post('/api/hr/employees', { code: 'G-2', name: 'Pegawai G-2', ptkp: 'TK/0', joinDate: `${today.slice(0, 4)}-01-02`, baseSalary: '3000000', bpjsKes: false, bpjsTk: false, bpjsJp: false }, hr).expect(201)).body.id;
      await db.execute(sql`UPDATE employees SET bank_account = '1234567890' WHERE id = ${id}`);
    }
    const f = (await flows()).find((x) => x.key === 'emp-shared-bank');
    expect(f).toBeTruthy();
    expect(f!.level).toBe('error');
    expect(f!.refs[0]).toContain('G-1');
  });

  it('kas: kas keluar berulang tepat di bawah batas persetujuan ditandai', async () => {
    await http.put('/api/approvals/policy').set(as(owner)).send({ cashOut: 1000000 }).expect(200);
    await post('/api/users', { name: 'fin', email: `kf-fin-${stamp}@uji.id`, password: 'rahasia12345', role: 'FINANCE' }).expect(201);
    const fin = (await http.post('/api/auth/login').send({ email: `kf-fin-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    const cashId = ((await get('/api/cash/accounts').expect(200)).body as { id: string; code: string }[]).find((a) => a.code === '1-1100')!.id;
    const counters = (await get('/api/cash/counter-accounts').expect(200)).body as { id: string; type: string; code: string }[];
    await post('/api/cash/transactions', { type: 'IN', cashAccountId: cashId, date: today, description: 'Modal', reference: 'M-KF', lines: [{ accountId: counters.find((a) => a.code === '3-1000')!.id, amount: '20000000' }] }).expect(201);
    const exp = counters.find((a) => a.type === 'EXPENSE')!.id;
    for (let i = 1; i <= 3; i++) await post('/api/cash/transactions', { type: 'OUT', cashAccountId: cashId, date: today, description: `Belanja ${i}`, reference: `KF-${stamp}-${i}`, lines: [{ accountId: exp, amount: '950000' }] }, fin).expect(201);
    const f = (await flows()).find((x) => x.key === 'cash-structuring');
    expect(f).toBeTruthy();
    expect(f!.level).toBe('error');
    expect(f!.refs[0]).toMatch(/3×/);
  });

  it('kasir: kueri kontrol kasir berjalan untuk usaha ritel (selisih kas berulang)', async () => {
    const t = (await http.post('/api/auth/register').send({ companyName: 'PT Toko Kasir', name: 'P', email: `kf-r-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'RITEL' }).expect(201)).body.accessToken as string;
    const r = (await http.get('/api/controls/flows').set(as(t)).expect(200)).body as { flow: string }[];
    expect(r.filter((x) => x.flow === 'KASIR')).toHaveLength(0);
  });
});
