/**
 * Kotak tugas: setiap pengguna hanya melihat proses yang menunggu TINDAKANNYA menurut pemisahan fungsi
 * (pembuat tidak melihat tugas persetujuan buatannya sendiri; penyetuju lain tidak melihat yang ditujukan ke orang lain).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Kotak tugas menurut pemisahan fungsi (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  let owner: string; let hr: string; let fin: string; let acct: string; let admin: string;
  let finId: string;
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const tasks = async (t: string) => (await get('/api/tasks/mine', t).expect(200)).body as { key: string; count: number; link: string }[];
  const has = (list: { key: string }[], key: string) => list.find((x) => x.key === key);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Tugas', name: 'Pemilik', email: `kt-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'JASA' }).expect(201)).body.accessToken;
    const mk = async (role: string, n: string) => {
      await post('/api/users', { name: n, email: `kt-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      const l = (await http.post('/api/auth/login').send({ email: `kt-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body;
      return { token: l.accessToken as string, id: l.user.id as string };
    };
    hr = (await mk('HR', 'hr')).token;
    const f = await mk('FINANCE', 'fin'); fin = f.token; finId = f.id;
    acct = (await mk('ACCOUNTANT', 'akuntan')).token;
    admin = (await mk('ADMIN', 'admin')).token;
    await post('/api/apps/payroll/install').expect(201);
  });
  afterAll(() => app.close());

  it('catatan upah kerja dari HR: tampil untuk Keuangan/Admin/Pemilik, tidak untuk pembuatnya atau Akuntan', async () => {
    const emp = (await post('/api/hr/employees', { code: 'T-1', name: 'Tenaga', ptkp: 'TK/0', joinDate: `${today.slice(0, 4)}-01-02`, baseSalary: '0', employmentType: 'TENAGA_LEPAS', bpjsKes: false, bpjsTk: false, bpjsJp: false }).expect(201)).body.id;
    const rate = (await post('/api/payroll/service/rates', { name: 'Per jam', unit: 'HOUR', rate: '100000' }, fin).expect(201)).body.id;
    await post('/api/payroll/service/entries', { employeeId: emp, rateId: rate, quantity: '2', workDate: today }, hr).expect(201);
    expect(has(await tasks(fin), 'work-entries')).toMatchObject({ count: 1, link: '/payroll/jasa' });
    expect(has(await tasks(admin), 'work-entries')).toBeTruthy();
    expect(has(await tasks(owner), 'work-entries')).toBeTruthy();
    expect(has(await tasks(hr), 'work-entries')).toBeUndefined(); // pembuat tidak memutuskan sendiri
    expect(has(await tasks(acct), 'work-entries')).toBeUndefined();
  });

  it('persetujuan yang ditujukan ke penyetuju tertentu tidak tampil di antrean penyetuju lain', async () => {
    await http.put('/api/approvals/policy').set(as(owner)).send({ purchaseOrder: 1000 }).expect(200);
    const mk = async (role: string, n: string) => {
      await post('/api/users', { name: n, email: `kt-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      const l = (await http.post('/api/auth/login').send({ email: `kt-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body;
      return { token: l.accessToken as string, id: l.user.id as string };
    };
    const buyer = await mk('PURCHASING', 'beli');
    const admin2 = await mk('ADMIN', 'admin2');
    const adminId = (await http.post('/api/auth/login').send({ email: `kt-admin-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.user.id as string;
    const wh = (await get('/api/warehouses').expect(200)).body[0].id;
    const prod = (await post('/api/products', { sku: 'KT1', name: 'Barang', baseUom: 'PCS', sellPrice: '10000' }).expect(201)).body.id;
    const sup = (await post('/api/suppliers', { code: 'KTS', name: 'Pemasok Tugas' }).expect(201)).body.id;
    const po = (await post('/api/purchase-orders', { supplierId: sup, warehouseId: wh, lines: [{ productId: prod, qty: '10', price: '5000' }] }, buyer.token).expect(201)).body;
    const res = await post(`/api/purchase-orders/${po.id}/confirm`, {}, buyer.token);
    expect(res.status).toBe(409);
    expect(has(await tasks(admin), 'approvals')).toBeTruthy(); // belum ditujukan: semua penyetuju melihatnya
    expect(has(await tasks(admin2.token), 'approvals')).toBeTruthy();
    expect(has(await tasks(buyer.token), 'approvals')).toBeUndefined(); // pemohon tidak memutuskan sendiri
    await post(`/api/approvals/${res.body.requestId}/assign`, { approverId: adminId }, buyer.token).expect(201);
    expect(has(await tasks(admin), 'approvals')).toBeTruthy();
    expect(has(await tasks(admin2.token), 'approvals')).toBeUndefined(); // sudah ditujukan ke Admin lain
    expect(has(await tasks(owner), 'approvals')).toBeTruthy(); // Pemilik tetap berwenang
    expect(has(await tasks(fin), 'approvals')).toBeUndefined(); // Keuangan bukan penyetuju
  });

  it('penggajian DRAFT menunggu Akuntan memposting', async () => {
    const emp = (await post('/api/hr/employees', { code: 'T-2', name: 'Tetap', ptkp: 'TK/0', joinDate: `${today.slice(0, 4)}-01-02`, baseSalary: '5000000', bpjsKes: false, bpjsTk: false, bpjsJp: false }).expect(201)).body.id;
    void emp;
    await post('/api/payroll/runs', { period: today.slice(0, 7) }, hr).expect(201);
    expect(has(await tasks(acct), 'payroll-post')).toMatchObject({ count: 1 });
    expect(has(await tasks(hr), 'payroll-post')).toBeUndefined();
  });
});
