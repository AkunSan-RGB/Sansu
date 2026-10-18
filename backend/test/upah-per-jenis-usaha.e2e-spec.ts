/**
 * Upah kerja per jenis usaha: satuan sesuai jenis usaha (shift untuk toko/kafe/pabrik, per hasil untuk pabrik/gudang),
 * batas wajar, hasil per perintah produksi dibatasi keluarannya, persetujuan orang lain, dan masuk slip gaji.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { WORK_UNITS_BY_MODEL } from '@sansu/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Upah kerja per jenis usaha (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const period = today.slice(0, 7);
  let seq = 0;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  const setup = async (model: string, tag: string) => {
    const owner = (await http.post('/api/auth/register').send({ companyName: `PT ${tag}`, name: 'Pemilik', email: `upj-${tag}-${stamp}@uji.id`, password: 'rahasia123', businessModel: model }).expect(201)).body.accessToken as string;
    const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);
    const get = (url: string, t = owner) => http.get(url).set(as(t));
    const mk = async (role: string) => {
      const n = `${role.toLowerCase()}${++seq}`;
      await post('/api/users', { name: n, email: `upj-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      return (await http.post('/api/auth/login').send({ email: `upj-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    };
    await post('/api/apps/payroll/install').expect(201);
    const hr = await mk('HR');
    const fin = await mk('FINANCE');
    const acct = await mk('ACCOUNTANT');
    const emp = (await post('/api/hr/employees', { code: 'K-1', name: 'Pegawai Satu', ptkp: 'TK/0', joinDate: `${today.slice(0, 4)}-01-02`, baseSalary: '3000000', bpjsKes: false, bpjsTk: false, bpjsJp: false }).expect(201)).body.id as string;
    return { owner, post, get, hr, fin, acct, emp };
  };

  it('profil: satuan yang tersedia mengikuti jenis usaha; satuan jenis lain ditolak', async () => {
    for (const model of ['RITEL', 'MANUFAKTUR', 'FMCG'] as const) {
      const c = await setup(model, `prof-${model.toLowerCase()}`);
      const prof = (await c.get('/api/payroll/service/profile').expect(200)).body;
      expect(prof.units.map((u: { key: string }) => u.key).sort()).toEqual([...WORK_UNITS_BY_MODEL[model]].sort());
      const bad = ['HOUR', 'SESSION', 'PERCENT'].find((u) => !WORK_UNITS_BY_MODEL[model].includes(u as never))!;
      expect((await c.post('/api/payroll/service/rates', { name: 'Salah', unit: bad, rate: '10' }, c.fin)).status).toBe(400);
    }
    const jasa = await setup('JASA', 'prof-jasa');
    expect((await jasa.post('/api/payroll/service/rates', { name: 'Shift', unit: 'SHIFT', rate: '50000' }, jasa.fin)).status).toBe(400);
  });

  it('Ritel: premi shift maksimal 2 per hari, disetujui orang lain, masuk slip gaji', async () => {
    const c = await setup('RITEL', 'shift');
    const rate = (await c.post('/api/payroll/service/rates', { name: 'Premi shift malam', unit: 'SHIFT', rate: '75000' }, c.fin).expect(201)).body.id;
    const entry = (qty: string, extra: object = {}) => c.post('/api/payroll/service/entries', { employeeId: c.emp, rateId: rate, quantity: qty, workDate: today, ...extra }, c.hr);
    expect((await entry('1.5')).status).toBe(400); // bukan bilangan bulat
    const e1 = (await entry('1').expect(201)).body;
    expect(e1.amount).toBe('75000.00');
    expect((await entry('1')).status).toBe(400); // kembar persis
    expect((await entry('2')).status).toBe(400); // total hari ini 3 shift > 2
    // pembuat tidak boleh menyetujui; Keuangan boleh
    expect((await c.post(`/api/payroll/service/entries/${e1.id}/approve`, {}, c.hr)).status).toBe(403);
    await c.post(`/api/payroll/service/entries/${e1.id}/approve`, {}, c.fin).expect(201);
    const run = (await c.post('/api/payroll/runs', { period }, c.hr).expect(201)).body;
    const slip = (await c.get(`/api/payroll/runs/${run.id}`).expect(200)).body.payslips.find((p: { employeeId: string }) => p.employeeId === c.emp);
    expect(Number(slip.serviceIncome)).toBe(75000);
    // upah kerja jadi bagian penghasilan bruto di atas gaji pokok
    expect(Number(slip.grossPay)).toBeGreaterThanOrEqual(3075000);
  });

  it('Manufaktur: upah per hasil dibatasi keluaran perintah produksi', async () => {
    const c = await setup('MANUFAKTUR', 'piece');
    const wh = (await c.get('/api/warehouses').expect(200)).body[0].id;
    const kain = (await c.post('/api/products', { sku: 'KN', name: 'Kain', baseUom: 'M', sellPrice: '0' }).expect(201)).body.id;
    const baju = (await c.post('/api/products', { sku: 'BJ', name: 'Baju', baseUom: 'PCS', sellPrice: '90000' }).expect(201)).body.id;
    await c.post('/api/inventory/adjustments', { warehouseId: wh, reason: 'OPENING', date: today, lines: [{ productId: kain, qty: '200', unitCost: '10000' }] }).expect(201);
    const bom = (await c.post('/api/production/boms', { name: 'Baju', productId: baju, outputQty: '10', laborCost: '0', overheadCost: '0', lines: [{ productId: kain, qty: '15' }] }).expect(201)).body;
    const po = (await c.post('/api/production/orders', { bomId: bom.id, warehouseId: wh, batches: '1', date: today }).expect(201)).body;
    const rate = (await c.post('/api/payroll/service/rates', { name: 'Jahit per potong', unit: 'PIECE', rate: '4000' }, c.fin).expect(201)).body.id;
    const entry = (qty: string, extra: object = {}) => c.post('/api/payroll/service/entries', { employeeId: c.emp, rateId: rate, quantity: qty, workDate: today, ...extra }, c.hr);
    // perintah belum berjalan → hasil per perintah ditolak; tanpa perintah boleh
    expect((await entry('5', { productionOrderId: po.id })).status).toBe(400);
    await c.post(`/api/production/orders/${po.id}/start`, { date: today }).expect(201);
    const ok = (await entry('6', { productionOrderId: po.id }).expect(201)).body;
    expect(ok.amount).toBe('24000.00');
    expect((await entry('5', { productionOrderId: po.id, description: 'lagi' })).status).toBe(400); // 6 + 5 > rencana 10
    await entry('4', { productionOrderId: po.id, description: 'sisanya' }).expect(201);
    // tarif per jam tidak boleh dikaitkan ke perintah produksi
    const job = (await c.post('/api/payroll/service/rates', { name: 'Borongan', unit: 'JOB', rate: '100000' }, c.fin).expect(201)).body.id;
    expect((await c.post('/api/payroll/service/entries', { employeeId: c.emp, rateId: job, quantity: '1', workDate: today, productionOrderId: po.id }, c.hr)).status).toBe(400);
  });

  it('Dagang & F&B: satuan borongan/shift tersedia, komisi faktur jasa tidak', async () => {
    const d = await setup('DAGANG', 'dag');
    const job = (await d.post('/api/payroll/service/rates', { name: 'Bongkar kontainer', unit: 'JOB', rate: '300000' }, d.fin).expect(201)).body.id;
    const e = (await d.post('/api/payroll/service/entries', { employeeId: d.emp, rateId: job, quantity: '1', workDate: today }, d.hr).expect(201)).body;
    await d.post(`/api/payroll/service/entries/${e.id}/approve`, {}, d.owner).expect(201);
    const f = await setup('FNB', 'fnb');
    await f.post('/api/payroll/service/rates', { name: 'Shift malam', unit: 'SHIFT', rate: '50000' }, f.fin).expect(201);
    expect((await f.post('/api/payroll/service/rates', { name: 'Komisi', unit: 'PERCENT', rate: '5' }, f.fin)).status).toBe(400);
    const warn = (await f.get(`/api/payroll/service/anomalies?period=${period}`).expect(200)).body;
    expect(Array.isArray(warn)).toBe(true);
  });
});
