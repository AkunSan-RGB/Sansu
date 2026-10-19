/**
 * Header keamanan: CSP ketat (sama dengan Caddy), anti-iframe, dan dokumentasi API dikecualikan dari CSP.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Header keamanan (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  it('respons API memuat CSP ketat dan tidak boleh dibingkai', async () => {
    const r = await http.get('/api/health'); // status bergantung database; header selalu ada
    const csp = String(r.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });

  it('jalur /api/docs tidak memakai CSP agar Swagger berfungsi (hanya aktif bila diizinkan)', async () => {
    const r = await http.get('/api/docs');
    expect(r.headers['content-security-policy']).toBeUndefined();
  });
});
