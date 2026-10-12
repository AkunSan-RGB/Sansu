/** Kop surat (logo, kontak, rekening): validasi gambar, hak akses, dan detail faktur untuk dicetak (e2e) */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

// PNG 1×1 transparan
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('Kop surat & dokumen (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let owner: string;
  let cashier: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    const stamp = Date.now();
    owner = (await http.post('/api/auth/register').send({ companyName: 'PT Kop Surat', name: 'P', email: `kop-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await http.post('/api/users').set(as(owner)).send({ name: 'Kasir', email: `kop-k-${stamp}@uji.id`, password: 'kasir1234', role: 'CASHIER' }).expect(201);
    cashier = (await http.post('/api/auth/login').send({ email: `kop-k-${stamp}@uji.id`, password: 'kasir1234' }).expect(200)).body.accessToken;
  });
  afterAll(() => app.close());

  it('simpan logo & rekening; semua peran bisa membaca kop surat, hanya admin yang mengubah', async () => {
    await http.patch('/api/settings/branding').set(as(owner)).send({ logo: 'data:image/svg+xml;base64,PHN2Zz4=' }).expect(400);
    await http.patch('/api/settings/branding').set(as(owner)).send({ logo: 'javascript:alert(1)' }).expect(400);
    const r = await http
      .patch('/api/settings/branding')
      .set(as(owner))
      .send({ logo: PNG, phone: '021-5551234', bankInfo: 'BCA 123 a.n. PT Kop Surat', invoiceNote: 'Terima kasih' })
      .expect(200);
    expect(r.body).toMatchObject({ name: 'PT Kop Surat', logo: PNG, bankInfo: 'BCA 123 a.n. PT Kop Surat' });

    const lh = (await http.get('/api/settings/letterhead').set(as(cashier)).expect(200)).body;
    expect(lh).toMatchObject({ name: 'PT Kop Surat', phone: '021-5551234', logo: PNG });
    await http.patch('/api/settings/branding').set(as(cashier)).send({ phone: 'x' }).expect(403);

    // ubah sebagian tidak menghapus isian lain; logo bisa dihapus
    await http.patch('/api/settings/branding').set(as(owner)).send({ email: 'a@b.id' }).expect(200);
    const after = (await http.patch('/api/settings/branding').set(as(owner)).send({ logo: '' }).expect(200)).body;
    expect(after).toMatchObject({ logo: null, phone: '021-5551234', email: 'a@b.id', bankInfo: 'BCA 123 a.n. PT Kop Surat' });
    // pengaturan perusahaan ikut memuat kop surat
    expect((await http.get('/api/settings/company').set(as(owner)).expect(200)).body.branding.email).toBe('a@b.id');
  });
});
