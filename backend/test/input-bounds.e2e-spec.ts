/** Parameter tahun yang tidak masuk akal harus ditolak 400, tidak boleh membuat error server (500) */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('Batas masukan tahun (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  const stamp = Date.now();
  const as = () => ({ Authorization: `Bearer ${token}` });
  const BAD = ['94', '0', '-5', '1899', '2101', '99999', '123456789012', 'abc', '2026.5'];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (await http.post('/api/auth/register').send({ companyName: 'PT Batas', name: 'Pemilik', email: `batas-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    await http.post('/api/apps/hr/install').set(as()).send({});
    await http.post('/api/apps/payroll/install').set(as()).send({});
  });
  afterAll(() => app.close());

  const GET_PATH = ['/api/accounting/fiscal/', '/api/accounting/notes/', '/api/accounting/appendix/'];
  it.each(GET_PATH)('GET %s{tahun}: tahun tidak masuk akal → 400', async (base) => {
    const bad: string[] = [];
    for (const y of BAD) {
      const r = await http.get(base + y).set(as());
      if (r.status !== 400) bad.push(`${y} → ${r.status}`);
    }
    expect(bad).toEqual([]);
  });

  it('tulis (PUT/POST/DELETE) pada rute bertahun: tahun tidak masuk akal → 400', async () => {
    const bad: string[] = [];
    for (const y of BAD) {
      const calls: [string, string, object][] = [
        ['put', `/api/accounting/fiscal/${y}`, { lossCarryforward: '0' }],
        ['post', `/api/accounting/fiscal/${y}/adjustments`, { description: 'x', kind: 'POSITIVE', amount: '1' }],
        ['post', `/api/accounting/fiscal/${y}/journal`, {}],
        ['put', `/api/accounting/notes/${y}/general`, { content: 'x' }],
        ['delete', `/api/accounting/notes/${y}/general`, {}],
      ];
      for (const [m, url, body] of calls) {
        const r = await (http as any)[m](url).set(as()).send(body);
        if (r.status !== 400) bad.push(`${m.toUpperCase()} ${url} → ${r.status}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it.each(['/api/tax/reports/annual?year=', '/api/tax/payments?year=', '/api/payroll/reports/pph21?year='])('GET %s{nilai}: tidak sah → 400, kosong → bawaan', async (base) => {
    const bad: string[] = [];
    for (const y of BAD) {
      const r = await http.get(base + y).set(as());
      if (r.status !== 400) bad.push(`${y} → ${r.status}`);
    }
    expect(bad).toEqual([]);
    expect((await http.get(base).set(as())).status).toBe(200); // tanpa tahun = tahun berjalan
    expect((await http.get(`${base}2026`).set(as())).status).toBe(200);
  });

  it('periode bulanan yang tidak sah tidak pernah membuat error server', async () => {
    const bad: string[] = [];
    for (const y of [...BAD, '2026-13', '2026-00', '']) {
      const r = await http.get(`/api/tax/reports/withholding?period=${y}`).set(as());
      if (r.status >= 500) bad.push(`${y} → ${r.status}`);
    }
    expect(bad).toEqual([]);
  });

  it('tahun wajar tetap berfungsi', async () => {
    for (const url of ['/api/accounting/fiscal/2026', '/api/accounting/notes/2026', '/api/accounting/appendix/2026', '/api/tax/reports/annual?year=2026']) {
      expect((await http.get(url).set(as())).status).toBe(200);
    }
  });
});
