/** NPWP / NIK: format divalidasi di semua titik masuk (pelanggan, pemasok, perusahaan, karyawan) */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Validasi NPWP & NIK (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  const stamp = Date.now();
  const as = () => ({ Authorization: `Bearer ${token}` });
  const post = (url: string, body: object) => http.post(url).set(as()).send(body);
  const patch = (url: string, body: object) => http.patch(url).set(as()).send(body);
  const msg = (r: request.Response) => (Array.isArray(r.body.message) ? r.body.message.join(' ') : String(r.body.message));
  let n = 0;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (await http.post('/api/auth/register').send({ companyName: 'PT NPWP', name: 'Pemilik', email: `npwp-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await post('/api/apps/hr/install', {});
  });
  afterAll(() => app.close());

  it('pelanggan: format sah diterima, tidak sah ditolak dengan pesan jelas, kosong boleh', async () => {
    const mk = (npwp?: string) => post('/api/customers', { code: `C-${++n}`, name: `Pelanggan ${n}`, ...(npwp !== undefined ? { npwp } : {}) });
    await mk('0123456789012345').expect(201);
    await mk('012345678901234').expect(201);
    await mk('01.234.567.8-901.000').expect(201);
    await mk('').expect(201);
    await mk().expect(201);
    for (const bad of ['123', '01234567890123456', 'NPWP-ABCDEFGHIJ']) expect(msg(await mk(bad).expect(400))).toMatch(/NPWP harus 15 atau 16 digit/);
  });

  it('pemasok: sama, termasuk saat mengubah', async () => {
    const s = (await post('/api/suppliers', { code: 'SUP-N', name: 'Pemasok N', npwp: '0123456789012345' }).expect(201)).body;
    await post('/api/suppliers', { code: 'SUP-X', name: 'Pemasok X', npwp: '99' }).expect(400);
    expect(msg(await patch(`/api/suppliers/${s.id}`, { npwp: '1234' }).expect(400))).toMatch(/NPWP harus/);
    await patch(`/api/suppliers/${s.id}`, { npwp: '0987654321098765' }).expect(200);
    await patch(`/api/suppliers/${s.id}`, { name: 'Tanpa ubah NPWP' }).expect(200); // pembaruan sebagian tidak memicu validasi NPWP
  });

  it('perusahaan: NPWP di pengaturan divalidasi', async () => {
    expect(msg(await patch('/api/settings/company', { npwp: '12345' }).expect(400))).toMatch(/NPWP harus/);
    await patch('/api/settings/company', { npwp: '01.234.567.8-901.000' }).expect(200);
  });

  it('karyawan: NIK 16 digit dan NPWP 15/16 digit', async () => {
    const base = { name: 'Pegawai', ptkp: 'TK/0', joinDate: '2025-01-02', baseSalary: '5000000' };
    await post('/api/hr/employees', { ...base, code: 'E-1', nik: '3174012345678901', npwp: '0123456789012345' }).expect(201);
    await post('/api/hr/employees', { ...base, code: 'E-2' }).expect(201); // keduanya opsional
    expect(msg(await post('/api/hr/employees', { ...base, code: 'E-3', nik: '12345' }).expect(400))).toMatch(/NIK harus 16 digit/);
    expect(msg(await post('/api/hr/employees', { ...base, code: 'E-4', npwp: '12345' }).expect(400))).toMatch(/NPWP harus/);
  });
});
