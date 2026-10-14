/**
 * Regresi: PATCH sebagian pada pengaturan pelaporan / penggajian tidak boleh menghapus field lain
 * (dulu field yang tidak dikirim tertimpa undefined dan kembali ke nilai bawaan).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('PATCH pengaturan sebagian (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  const stamp = Date.now();
  const as = () => ({ Authorization: `Bearer ${token}` });
  const patch = (url: string, body: object) => http.patch(url).set(as()).send(body);
  const company = async () => (await http.get('/api/settings/company').set(as()).expect(200)).body;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (await http.post('/api/auth/register').send({ companyName: 'PT Patch', name: 'Pemilik', email: `patch-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
  });
  afterAll(() => app.close());

  it('pelaporan: mengubah satu field mempertahankan semua field lain', async () => {
    const full = {
      framework: 'SAK_EMKM',
      legalForm: 'UD',
      businessActivity: 'toko bangunan',
      establishedYear: 2015,
      city: 'Bekasi',
      directorName: 'Budi Santoso',
      directorTitle: 'Pemilik',
      taxScheme: 'GENERAL',
      taxRegisteredYear: 2016,
      capitalizationThreshold: 2_000_000,
    };
    await patch('/api/settings/reporting', full).expect(200);
    expect((await company()).reporting).toEqual(full);

    for (const one of [{ taxScheme: 'FINAL_UMKM' }, { city: 'Jakarta' }, { capitalizationThreshold: 3_000_000 }, { framework: 'SAK_EP' }]) {
      const before = (await company()).reporting;
      await patch('/api/settings/reporting', one).expect(200);
      expect((await company()).reporting).toEqual({ ...before, ...one });
    }
  });

  it('nilai nol dan string kosong yang sengaja dikirim tetap diterapkan', async () => {
    await patch('/api/settings/reporting', { capitalizationThreshold: 0, city: '' }).expect(200);
    expect((await company()).reporting).toMatchObject({ capitalizationThreshold: 0, city: '', legalForm: 'UD', directorName: 'Budi Santoso' });
  });

  it('badan kosong tidak mengubah apa pun', async () => {
    const before = (await company()).reporting;
    await patch('/api/settings/reporting', {}).expect(200);
    expect((await company()).reporting).toEqual(before);
  });

  it('penggajian: mengubah satu field mempertahankan field lain', async () => {
    await patch('/api/settings/payroll', { workDaysPerWeek: 5, bpjsKesCap: 11_000_000, jpCap: 10_000_000, jkkRate: 0.3, jkmRate: 0.3, overtimeDivisor: 173 }).expect(200);
    await patch('/api/settings/payroll', { jkkRate: 0.89 }).expect(200);
    expect((await company()).payroll).toEqual({ workDaysPerWeek: 5, bpjsKesCap: 11_000_000, jpCap: 10_000_000, jkkRate: 0.89, jkmRate: 0.3, overtimeDivisor: 173 });
  });

  it('profil pajak: mengubah satu pilihan mempertahankan yang lain', async () => {
    await patch('/api/settings/company', { pkp: false, posPricesIncludeVat: true, salesPricesIncludeVat: true }).expect(200);
    await patch('/api/settings/company', { salesPricesIncludeVat: false }).expect(200);
    expect((await company()).taxProfile).toEqual({ pkp: false, posPricesIncludeVat: true, salesPricesIncludeVat: false, vatRounding: 'NONE', localTaxEnabled: false, localTaxRate: '10' });
  });
});
