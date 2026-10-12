/**
 * Masukan sembarang ke SEMUA rute (parameter jalur, query, isi permintaan) tidak boleh pernah membuat error server (5xx).
 * Penolakan 4xx wajar. Daftar rute diambil otomatis, jadi rute baru ikut teruji tanpa perlu menulis tes.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

type Route = { method: string; path: string };

describe('Masukan sembarang tidak membuat error server (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;
  const stamp = Date.now();
  const as = () => ({ Authorization: `Bearer ${token}` });

  const routes = (): Route[] => {
    const inst = app.getHttpAdapter().getInstance();
    const stack = (inst.router ?? inst._router).stack as { route?: { path: string; methods: Record<string, boolean> } }[];
    return stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route!.methods).map((m) => ({ method: m.toUpperCase(), path: l.route!.path })));
  };

  const PARAMS = ['not-a-uuid', '00000000-0000-0000-0000-000000000000', '0', '-1', '94', '99999999999999999999', "' OR 1=1 --", '%00', '..%2f..%2fetc', 'A'.repeat(300), '2026-13-45', '2026-02-30'];
  const QUERIES = [
    '?from=abc&to=9999-99-99&asOf=2026-02-30&period=zzz&year=-1&month=13&limit=-5&page=0&offset=-1&q=%27&framework=XX&status=NOPE&type=NOPE',
    '?from=2026-12-31&to=2026-01-01&asOf=0000-00-00&period=2026-13&year=99999999999&limit=99999999999999999999&page=abc&costToSellPct=abc&costToSellPct=-5',
    '?from=&to=&asOf=&period=&year=&limit=&q=&warehouseId=&productId=&customerId=&supplierId=&accountId=x&search=%00',
    '?date=2026-02-30&dueDate=x&startDate=abc&endDate=9999-12-31&month=2026-13&day=32&minQty=abc&threshold=-1&costToSellPct=1e999&sort=;drop&order=sideways',
    `?from=2026-01-01&to=2026-12-31&limit=${'9'.repeat(40)}&offset=${'9'.repeat(40)}&q=${'%F0%9F%98%80'.repeat(50)}&warehouseId=${'a'.repeat(200)}`,
    '?period=2026-02&year=2026&from=2026-02-10&to=2026-02-01&month=2&framework=SAK_EMKM&customerId=not-uuid&supplierId=00000000-0000-0000-0000-000000000000',
  ];
  const BODIES: unknown[] = [
    {},
    { amount: 'abc', qty: '-1', price: '1e999', date: '31-02-2026', description: 'x'.repeat(5000) },
    { lines: 'x', items: 5, accountId: 'nope', productId: null },
    { lines: [], payments: [{}], batches: 'x' },
    { lines: [{ productId: '00000000-0000-0000-0000-000000000000', qty: '1' }], period: '2026-13', year: -1, from: 'x' },
    [1, 2, 3],
    {
      date: '2026-02-30', dueDate: 'abc', startDate: '9999-99-99', until: 'x', from: '2026-02-31', to: '0000-00-00',
      amount: '1e999', qty: '9'.repeat(40), price: '-0', discount: 'NaN', rate: '1e-999', percent: '101',
      period: '2026-13', year: 2026.5, month: 13, type: 'X', status: 'Y', method: 'Z', reason: 'x'.repeat(3000),
      withholdingType: 'PPH99', withholdingRate: '-1', cashAccountId: 'x', accountId: '\u0000', supplierId: 'x', customerId: {},
      lines: [{ productId: 'x', qty: 'abc', price: 'abc', accountId: 1, type: 'ASSET' }, null, 5],
      payments: [{ method: 'CASH', amount: '1e999' }], batches: '0', outputQty: '-1', countedQty: 'x',
    },
    { name: '\u0000', code: 'x'.repeat(500), email: 'bukan-email', password: '1', sku: '', sellPrice: '-5', creditLimit: '9'.repeat(40), paymentTermDays: -1, ptkp: 'XX/9', baseSalary: 'abc', joinDate: '2026-13-01' },
  ];
  // Rute yang akan mencabut sesi uji atau mengubah akun pemilik; sisanya disisir penuh
  const SKIP = [/^\/api\/auth\/(logout|logout-all|password|change-password|delete|2fa)/, /^\/api\/account/, /^\/api\/users\/.*\/(deactivate|reset)/];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    token = (await http.post('/api/auth/register').send({ companyName: 'PT Sembarang', name: 'Pemilik', email: `garb-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body.accessToken;
    for (const a of ['pos', 'crm', 'hr', 'payroll']) await http.post(`/api/apps/${a}/install`).set(as()).send({});
    // sedikit data agar rute laporan menyentuh jalur berisi, bukan hanya jalur kosong
    const wh = (await http.get('/api/warehouses').set(as())).body[0].id;
    const p = (await http.post('/api/products').set(as()).send({ sku: 'GB-1', name: 'Barang', sellPrice: '1000' })).body.id;
    await http.post('/api/inventory/adjustments').set(as()).send({ warehouseId: wh, reason: 'OPENING', lines: [{ productId: p, qty: '10', unitCost: '500' }] });
  });
  afterAll(() => app.close());

  it('semua rute: tidak ada respons 5xx untuk parameter, query, dan isi permintaan sembarang', async () => {
    const all = routes().filter((r) => r.path.startsWith('/api/') && !SKIP.some((s) => s.test(r.path)));
    expect(all.length).toBeGreaterThan(200);
    const failures = new Map<string, string>();
    const hit = async (r: Route, path: string, qs: string, body?: unknown) => {
      const call = (http as any)[r.method.toLowerCase()](path + qs).set(as());
      const res = await (body === undefined ? call : call.send(body as object));
      if (res.status >= 500) {
        const key = `${r.method} ${r.path}`;
        if (!failures.has(key)) failures.set(key, `${res.status} ${path}${qs.slice(0, 60)} ${body === undefined ? '' : JSON.stringify(body).slice(0, 70)} → ${JSON.stringify(res.body).slice(0, 120)}`);
      }
    };
    for (const r of all) {
      const params = r.path.match(/:\w+/g) ?? [];
      const write = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method);
      if (!params.length) {
        if (!write) for (const q of QUERIES) await hit(r, r.path, q);
        else for (const b of BODIES) await hit(r, r.path, '', b);
      } else {
        for (const v of PARAMS) {
          const path = r.path.replace(/:\w+/g, v);
          if (!write) { await hit(r, path, QUERIES[0]); await hit(r, path, QUERIES[3]); }
          else for (const b of [BODIES[0], BODIES[1], BODIES[6]]) await hit(r, path, '', b);
        }
      }
    }
    expect([...failures.entries()].map(([k, v]) => `${k}: ${v}`)).toEqual([]);
  }, 600_000);
});
