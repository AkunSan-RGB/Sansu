/**
 * Evaluasi menu vs hak akses: peran yang melihat menu harus bisa membuka datanya.
 * Admin yang memposting gaji bisa melihat penggajian; Admin menjalankan CRM; daftar nama pegawai untuk jadwal/upah tanpa data gaji.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Akses menu per peran (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  let owner: string; let adm: string; let wh: string; let hr: string;
  const get = (url: string, t = owner) => http.get(url).set(as(t));
  const post = (url: string, body: object = {}, t = owner) => http.post(url).set(as(t)).send(body);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Akses', name: 'P', email: `am-${stamp}@uji.id`, password: 'rahasia123', businessModel: 'RITEL' }).expect(201)).body.accessToken;
    const mk = async (role: string, n: string) => {
      await post('/api/users', { name: n, email: `am-${n}-${stamp}@uji.id`, password: 'rahasia12345', role }).expect(201);
      return (await http.post('/api/auth/login').send({ email: `am-${n}-${stamp}@uji.id`, password: 'rahasia12345' }).expect(200)).body.accessToken as string;
    };
    adm = await mk('ADMIN', 'adm');
    wh = await mk('WAREHOUSE', 'gudang');
    hr = await mk('HR', 'sdm');
    for (const a of ['crm', 'payroll']) await post(`/api/apps/${a}/install`).expect(201);
    await post('/api/hr/employees', { code: 'E1', name: 'Rina', baseSalary: '5000000', joinDate: '2026-01-01' }, hr).catch(() => undefined);
  });
  afterAll(() => app.close());

  it('Admin yang boleh memposting gaji juga boleh melihat daftar penggajian', async () => {
    expect((await get('/api/payroll/runs', adm)).status).toBe(200);
    expect((await get('/api/payroll/reports/pph21?year=2026', adm)).status).not.toBe(403);
    expect((await get('/api/payroll/runs', wh)).status).toBe(403); // peran lain tetap tertutup
  });

  it('Admin boleh menjalankan CRM (sebelumnya hanya Sales), Gudang tidak', async () => {
    expect((await get('/api/crm/pipeline', adm)).status).toBe(200);
    expect((await get('/api/crm/pipeline', wh)).status).toBe(403);
  });

  it('daftar nama pegawai untuk jadwal shift dan upah kerja tidak membuka data gaji', async () => {
    for (const url of ['/api/shifts/staff', '/api/payroll/service/staff']) {
      const r = await get(url, adm);
      expect(r.status).toBe(200);
      const text = JSON.stringify(r.body);
      expect(text).not.toMatch(/salary|bank|npwp|account/i);
    }
    expect((await get('/api/hr/employees', adm)).status).toBe(403); // data lengkap karyawan tetap bukan untuk Admin
    expect((await get('/api/shifts/staff', wh)).status).toBe(403);
  });

  it('Gudang tidak membuka faktur dan piutang (menu disembunyikan, API menolak)', async () => {
    expect((await get('/api/invoices', wh)).status).toBe(403);
  });
});
