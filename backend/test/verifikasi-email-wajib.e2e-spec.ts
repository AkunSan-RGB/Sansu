/**
 * Email wajib diverifikasi (e2e): pendaftar belum bisa masuk sebelum klik tautan di email;
 * email verifikasi dikirim otomatis saat daftar dan saat mencoba masuk; kirim ulang dari layar masuk.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { MailService } from '../src/common/mail/mail.service';

describe('Verifikasi email wajib (e2e)', () => {
  let app: INestApplication;
  let mail: MailService;
  let http: ReturnType<typeof request>;
  const stamp = Date.now();
  const email = `verif-${stamp}@uji.id`;
  const password = 'rahasia123';
  const links = () => mail.outbox.filter((x) => x.to === email && x.action?.url.includes('/verify-email'));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    mail = app.get(MailService);
    // anggap email sudah diatur; pengiriman ditangkap di outbox
    jest.spyOn(mail, 'configured', 'get').mockReturnValue(true);
    jest.spyOn(mail, 'send').mockImplementation(async (m) => {
      mail.outbox.push({ ...m, at: new Date() });
      return true;
    });
  });
  afterAll(() => app.close());

  it('daftar: email verifikasi terkirim, belum ada sesi, belum bisa masuk', async () => {
    const r = await http.post('/api/auth/register').send({ companyName: 'PT Verifikasi', name: 'Pemilik', email, password }).expect(201);
    expect(r.body.accessToken).toBeUndefined();
    expect(r.body).toMatchObject({ verificationRequired: true, email });
    expect(links()).toHaveLength(1);
    const res = await http.post('/api/auth/login').send({ email, password }).expect(403);
    expect(res.body.code).toBe('EMAIL_UNVERIFIED');
    // sandi salah tetap 401 (tidak membocorkan status verifikasi)
    await http.post('/api/auth/login').send({ email, password: 'salah-salah1' }).expect(401);
  });

  it('kirim ulang dari layar masuk: jawaban sama untuk email tak dikenal, dibatasi 1 per menit', async () => {
    const before = mail.outbox.length;
    await http.post('/api/auth/resend-verification-public').send({ email: `tidak-ada-${stamp}@uji.id` }).expect(200);
    expect(mail.outbox.length).toBe(before);
    // baru saja dikirim saat daftar → tidak dikirim lagi
    await http.post('/api/auth/resend-verification-public').send({ email }).expect(200);
    expect(links()).toHaveLength(1);
  });

  it('setelah klik tautan verifikasi, bisa masuk', async () => {
    const token = new URL(links()[0].action!.url).searchParams.get('token')!;
    await http.post('/api/auth/verify-email').send({ token }).expect(200);
    const r = await http.post('/api/auth/login').send({ email, password }).expect(200);
    expect(r.body.accessToken).toBeTruthy();
  });
});
