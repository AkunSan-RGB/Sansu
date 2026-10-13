import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { serveWeb } from './serve-web';

@Controller('ping')
class PingController {
  @Get()
  ping() {
    return { pong: true };
  }
}
@Module({ controllers: [PingController] })
class PingModule {}

describe('serveWeb (mode satu layanan)', () => {
  let app: INestApplication;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sansu-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>SANSU</title><div id="root"></div>');
    writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
    const mod = await Test.createTestingModule({ imports: [PingModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    expect(serveWeb(app, dir)).toBe(true);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('beranda dan rute SPA (/login, /invoices/123) mengembalikan index.html tanpa cache', async () => {
    for (const path of ['/', '/login', '/invoices/123?x=1']) {
      const r = await request(app.getHttpServer()).get(path).set('Accept', 'text/html');
      expect(r.status).toBe(200);
      expect(r.text).toContain('<div id="root">');
      expect(r.headers['cache-control']).toBe('no-cache');
    }
  });

  it('aset ber-hash disajikan dengan cache panjang', async () => {
    const r = await request(app.getHttpServer()).get('/assets/app-abc123.js');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toContain('immutable');
  });

  it('API tetap API: data JSON, dan rute API yang tidak ada = 404 (bukan index.html)', async () => {
    const ok = await request(app.getHttpServer()).get('/api/ping').set('Accept', 'text/html');
    expect(ok.body).toEqual({ pong: true });
    const missing = await request(app.getHttpServer()).get('/api/tidak-ada').set('Accept', 'text/html');
    expect(missing.status).toBe(404);
    expect(missing.text).not.toContain('<div id="root">');
  });

  it('berkas yang hilang = 404, dan metode selain GET tidak dialihkan', async () => {
    expect((await request(app.getHttpServer()).get('/assets/hilang.js').set('Accept', '*/*')).status).toBe(404);
    expect((await request(app.getHttpServer()).get('/gambar.png').set('Accept', 'image/png')).status).toBe(404);
    expect((await request(app.getHttpServer()).post('/login')).status).toBe(404);
  });

  it('tanpa folder tampilan: tidak memasang apa pun', async () => {
    const mod = await Test.createTestingModule({ imports: [PingModule] }).compile();
    const a = mod.createNestApplication();
    expect(serveWeb(a, undefined)).toBe(false);
    await a.close();
  });
});
