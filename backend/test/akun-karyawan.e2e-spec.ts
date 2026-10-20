/** Menghubungkan akun pengguna ke data karyawan (syarat lembar waktu, jadwal, cuti atas nama sendiri). */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { sql } from 'drizzle-orm';
import { DB, Db } from '../src/db/db';

describe('Hubungkan akun ke karyawan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  let owner = ''; let adm = ''; let admId = ''; let staff = ''; let staffId = ''; let staff2Id = ''; let acct = ''; let admin = '';
  let e1 = ''; let e2 = '';
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (t: string, u: string, b: object = {}) => http.post(u).set(as(t)).send(b);
  const put = (t: string, u: string, b: object = {}) => http.put(u).set(as(t)).send(b);
  const login = async (email: string) => (await http.post('/api/auth/login').send({ email, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
  const mk = async (role: string, n: string) => {
    const r = (await post(owner, '/api/users', { name: n, email: `ak-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201)).body;
    return { token: await login(`ak-${n}-${stamp}@uji.id`), id: r.id as string };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'Jasa Akun', name: 'Pemilik', email: `ak-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'JASA' }).expect(201)).body.accessToken;
    await post(owner, '/api/apps/hr/install').expect(201);
    const a = await mk('HR', 'hr'); adm = a.token; admId = a.id;
    const s = await mk('SALES', 'staf'); staff = s.token; staffId = s.id;
    staff2Id = (await mk('SALES', 'staf2')).id;
    acct = (await mk('ACCOUNTANT', 'akt')).token;
    admin = (await mk('ADMIN', 'adm')).token;
    const emp = async (code: string, name: string) => (await post(owner, '/api/hr/employees', { code, name, ptkp: 'TK/0', joinDate: '2025-01-02', baseSalary: '5000000' }).expect(201)).body.id as string;
    e1 = await emp('AK1', 'Dewi'); e2 = await emp('AK2', 'Eko');
  });
  afterAll(() => app.close());

  it('sebelum dihubungkan, staf tidak bisa mencatat waktu dan diberi petunjuk', async () => {
    const cust0 = (await post(owner, '/api/customers', { code: 'AK0', name: 'PT Klien Nol', paymentTermDays: 14 }).expect(201)).body.id;
    const r = await post(staff, '/api/timesheets/entries', { customerId: cust0, workDate: new Date().toISOString().slice(0, 10), hours: '1', description: 'rapat' });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('Hubungkan akun');
  });

  it('hanya HR dan Pemilik (Admin dan Akuntan ditolak); validasi akun; satu akun satu karyawan', async () => {
    expect((await put(admin, `/api/hr/employees/${e1}/account`, { userId: staffId })).status).toBe(403);
    expect((await put(acct, `/api/hr/employees/${e1}/account`, { userId: staffId })).status).toBe(403);
    expect((await put(owner, `/api/hr/employees/${e1}/account`, { userId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    expect((await put(owner, `/api/hr/employees/00000000-0000-4000-8000-000000000000/account`, { userId: staffId })).status).toBe(404);
    await put(adm, `/api/hr/employees/${e1}/account`, { userId: staffId }).expect(200);
    expect((await put(adm, `/api/hr/employees/${e2}/account`, { userId: staffId })).status).toBe(409);
    const list = (await http.get('/api/hr/employee-accounts').set(as(adm)).expect(200)).body as { id: string; employeeName: string | null }[];
    expect(list.find((x) => x.id === staffId)?.employeeName).toBe('Dewi');
  });

  it('akun sendiri hanya boleh Pemilik; ganti/lepas wajib alasan; tercatat di audit', async () => {
    const r = await put(adm, `/api/hr/employees/${e2}/account`, { userId: admId });
    expect(r.status).toBe(403);
    expect((await put(adm, `/api/hr/employees/${e1}/account`, { userId: staff2Id })).status).toBe(400); // tanpa alasan
    await put(adm, `/api/hr/employees/${e1}/account`, { userId: staff2Id, reason: 'salah orang' }).expect(200);
    expect((await put(adm, `/api/hr/employees/${e1}/account`, { userId: null })).status).toBe(400);
    await put(adm, `/api/hr/employees/${e1}/account`, { userId: null, reason: 'karyawan keluar' }).expect(200);
    await put(adm, `/api/hr/employees/${e1}/account`, { userId: staffId }).expect(200);
    await put(owner, `/api/hr/employees/${e2}/account`, { userId: staff2Id }).expect(200);
    const log = (await app.get<Db>(DB).execute(sql`SELECT data FROM audit_logs WHERE entity = 'EmployeeAccountLink' AND entity_id = ${e1}`)).rows;
    expect(JSON.stringify(log)).toContain('karyawan keluar');
    expect(log.length).toBe(4);
  });

  it('setelah dihubungkan, daftar lembar waktu staf tidak lagi menolak dan catatan atas nama sendiri bisa dibuat', async () => {
    const cust = (await post(owner, '/api/customers', { code: 'AK1', name: 'PT Klien', paymentTermDays: 14 }).expect(201)).body.id;
    const r = await post(staff, '/api/timesheets/entries', { customerId: cust, workDate: new Date().toISOString().slice(0, 10), hours: '2', description: 'rapat' });
    expect(r.status).toBe(201);
  });
});
