/**
 * Token yang masih sah tetapi penggunanya sudah tidak ada (data dihapus/database direset) harus dijawab 401,
 * bukan 500 yang berulang di log setiap kali klien memuat profil.
 */
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Sesi milik pengguna yang sudah hilang (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    const reg = await http
      .post('/api/auth/register')
      .send({ companyName: 'PT Sesi Hilang', name: 'Pemilik', email: `sesi-${Date.now()}@uji.id`, password: 'rahasia123' })
      .expect(201);
    token = reg.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('profil pengguna yang ada dijawab 200', async () => {
    await http.get('/api/auth/me').set({ Authorization: `Bearer ${token}` }).expect(200);
  });

  it('token sah untuk pengguna yang tidak ada dijawab 401, bukan 500', async () => {
    const jwt = app.get(JwtService);
    const payload = jwt.decode(token) as Record<string, unknown>;
    delete payload.iat;
    delete payload.exp;
    const ghost = await jwt.signAsync({ ...payload, sub: randomUUID() });
    await http.get('/api/auth/me').set({ Authorization: `Bearer ${ghost}` }).expect(401);
  });
});
