/**
 * Keamanan layanan online (e2e):
 *  1. Isolasi data antar perusahaan — perusahaan B mencoba membaca & mengubah data perusahaan A
 *     lewat SEMUA rute API yang memakai parameter ID (disapu otomatis dari router), lewat semua
 *     daftar/laporan, dan lewat referensi ID asing di isi permintaan.
 *  2. Sesi: token dicabut saat pengguna dinonaktifkan / ganti sandi / keluar dari semua perangkat.
 *  3. Penguncian akun setelah tebak sandi berulang & kebijakan kata sandi.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';

const MARK = 'RAHASIA_A_7f3c';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

type Route = { method: string; path: string };

describe('Keamanan & isolasi tenant (e2e)', () => {
  let app: INestApplication;
  let db: Db;
  let http: ReturnType<typeof request>;
  let tokenA: string;
  let tokenB: string;
  let tenantB: string;
  const A: Record<string, string> = {};
  const B: Record<string, string> = {};
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** Semua rute terdaftar di Express (Nest 11 / Express 5) */
  const routes = (): Route[] => {
    const inst = app.getHttpAdapter().getInstance();
    const stack = (inst.router ?? inst._router).stack as { route?: { path: string; methods: Record<string, boolean> } }[];
    return stack
      .filter((l) => l.route)
      .flatMap((l) => Object.keys(l.route!.methods).map((m) => ({ method: m.toUpperCase(), path: l.route!.path })));
  };

  /** ID baris milik perusahaan lain (bukan B) dari setiap tabel ber-tenant */
  const foreignIds = async (): Promise<string[]> => {
    const tables = (
      await db.execute<{ t: string }>(sql`
        SELECT c.table_name AS t FROM information_schema.columns c
        JOIN information_schema.columns i ON i.table_name = c.table_name AND i.table_schema = c.table_schema AND i.column_name = 'id'
        JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema AND tb.table_type = 'BASE TABLE'
        WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND c.table_name <> 'tenants'`)
    ).rows.map((r) => r.t);
    const ids: string[] = [];
    for (const t of tables) {
      const rows = await db.execute<{ id: string }>(
        sql`SELECT id::text AS id FROM ${sql.identifier(t)} WHERE tenant_id <> ${tenantB} ORDER BY random() LIMIT 2`,
      );
      ids.push(...rows.rows.map((r) => r.id));
    }
    // baris anak tanpa tenant_id (mis. baris jurnal / baris faktur) juga diuji
    for (const t of ['journal_lines', 'sales_order_lines', 'invoice_lines', 'purchase_order_lines']) {
      const ok = (await db.execute(sql`SELECT 1 FROM information_schema.tables WHERE table_name = ${t}`)).rows.length;
      if (ok) ids.push(...(await db.execute<{ id: string }>(sql`SELECT id::text AS id FROM ${sql.identifier(t)} ORDER BY random() LIMIT 2`)).rows.map((r) => r.id));
    }
    return [...new Set(ids)];
  };

  /** Jumlah baris per tabel milik tenant selain B — untuk memastikan tidak ada yang berubah/terhapus */
  const fingerprint = async () =>
    (
      await db.execute<{ n: string }>(sql`
        SELECT md5(string_agg(t || ':' || n, ',' ORDER BY t)) AS n FROM (
          SELECT 'customers' t, count(*) || '/' || md5(string_agg(name || coalesce(phone,''), '' ORDER BY id)) n FROM customers WHERE tenant_id <> ${tenantB}
          UNION ALL SELECT 'products', count(*) || '/' || md5(string_agg(name || sell_price, '' ORDER BY id)) FROM products WHERE tenant_id <> ${tenantB}
          UNION ALL SELECT 'journals', count(*) || '/' || md5(string_agg(description || coalesce(reversal_of_id::text,''), '' ORDER BY id)) FROM journal_entries WHERE tenant_id <> ${tenantB}
          UNION ALL SELECT 'users', count(*) || '/' || md5(string_agg(email || is_active || role || token_version, '' ORDER BY id)) FROM users WHERE tenant_id <> ${tenantB}
          UNION ALL SELECT 'suppliers', count(*) || '/' || md5(string_agg(name, '' ORDER BY id)) FROM suppliers WHERE tenant_id <> ${tenantB}
          UNION ALL SELECT 'accounts', count(*) || '/' || md5(string_agg(name || is_active, '' ORDER BY id)) FROM accounts WHERE tenant_id <> ${tenantB}
          UNION ALL SELECT 'sales_orders', count(*) || '/' || md5(string_agg(status::text, '' ORDER BY id)) FROM sales_orders WHERE tenant_id <> ${tenantB}
        ) x`)
    ).rows[0].n;

  const leaks = (text: string, ids: Set<string>) => {
    if (text.includes(MARK)) return MARK;
    for (const m of text.match(UUID_RE) ?? []) if (ids.has(m)) return m;
    return null;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    db = app.get<Db>(DB);
    http = request(app.getHttpServer());
    const stamp = Date.now();
    tokenA = (
      await http.post('/api/auth/register').send({ companyName: `PT ${MARK}`, name: `Pemilik ${MARK}`, email: `a-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)
    ).body.accessToken;
    const regB = await http.post('/api/auth/register').send({ companyName: 'PT Penyusup', name: 'Penyusup', email: `b-${stamp}@uji.id`, password: 'rahasia123' }).expect(201);
    tokenB = regB.body.accessToken;
    tenantB = regB.body.user.tenantId;

    const pa = (url: string, body: object) => http.post(url).set(as(tokenA)).send(body);
    const pb = (url: string, body: object) => http.post(url).set(as(tokenB)).send(body);
    A.customer = (await pa('/api/customers', { code: 'C-A', name: `Pelanggan ${MARK}`, phone: '0811' }).expect(201)).body.id;
    A.product = (await pa('/api/products', { sku: 'SKU-A', name: `Produk ${MARK}`, sellPrice: '10000' }).expect(201)).body.id;
    A.supplier = (await pa('/api/suppliers', { code: 'S-A', name: `Supplier ${MARK}` }).expect(201)).body.id;
    A.warehouse = (await http.get('/api/warehouses').set(as(tokenA))).body[0].id;
    const accA = (await http.get('/api/accounting/accounts').set(as(tokenA))).body as { id: string; code: string }[];
    A.cash = accA.find((a) => a.code === '1-1100')!.id;
    A.equity = accA.find((a) => a.code === '3-1000')!.id;
    A.journal = (
      await pa('/api/accounting/journals', {
        date: '2026-02-01',
        description: `Jurnal ${MARK}`,
        lines: [
          { accountId: A.cash, debit: '1000', credit: '0' },
          { accountId: A.equity, debit: '0', credit: '1000' },
        ],
      }).expect(201)
    ).body.id;
    await pa('/api/inventory/adjustments', { warehouseId: A.warehouse, reason: 'OPENING', date: '2026-01-01', lines: [{ productId: A.product, qty: '10', unitCost: '5000' }] }).expect(201);
    A.salesOrder = (
      await pa('/api/sales-orders', { customerId: A.customer, warehouseId: A.warehouse, date: '2026-02-02', notes: MARK, lines: [{ productId: A.product, qty: '1', price: '10000' }] }).expect(201)
    ).body.id;

    B.customer = (await pb('/api/customers', { code: 'C-B', name: 'Pelanggan B' }).expect(201)).body.id;
    B.product = (await pb('/api/products', { sku: 'SKU-B', name: 'Produk B', sellPrice: '10000' }).expect(201)).body.id;
    B.supplier = (await pb('/api/suppliers', { code: 'S-B', name: 'Supplier B' }).expect(201)).body.id;
    B.warehouse = (await http.get('/api/warehouses').set(as(tokenB))).body[0].id;
    const accB = (await http.get('/api/accounting/accounts').set(as(tokenB))).body as { id: string; code: string }[];
    B.cash = accB.find((a) => a.code === '1-1100')!.id;
    B.equity = accB.find((a) => a.code === '3-1000')!.id;
  });
  afterAll(() => app.close());

  it('B tidak bisa membaca data perusahaan lain lewat rute ber-ID maupun daftar/laporan', async () => {
    const ids = await foreignIds();
    expect(ids.length).toBeGreaterThan(10);
    const idSet = new Set(ids);
    const sample = [...Object.values(A), ...ids.slice(0, 40)];
    const found: string[] = [];
    const gets = routes().filter((r) => r.method === 'GET' && r.path.startsWith('/api/'));
    expect(gets.length).toBeGreaterThan(50);
    for (const r of gets) {
      const params = r.path.match(/:\w+/g) ?? [];
      if (!params.length) {
        const q = '?from=2026-01-01&to=2026-12-31&asOf=2026-12-31&period=2026-02&year=2026';
        const res = await http.get(r.path + q).set(as(tokenB));
        const leak = leaks(res.text, idSet);
        if (leak) found.push(`${r.path} → ${leak}`);
        continue;
      }
      for (const id of sample) {
        const res = await http.get(r.path.replace(/:\w+/g, id)).set(as(tokenB));
        const leak = res.status < 300 ? leaks(res.text, idSet) : res.status >= 500 ? 'error 500' : null;
        if (leak) found.push(`${r.path} [${id}] → ${res.status} ${leak}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('B tidak bisa mengubah / menghapus data perusahaan lain lewat rute ber-ID', async () => {
    const before = await fingerprint();
    const ids = [...Object.values(A), ...(await foreignIds()).slice(0, 30)];
    // Rute yang parameternya bukan ID data, melainkan kunci di dalam perusahaan sendiri (mis. reset catatan CALK ke bawaan)
    const tenantScopedKeys = ['/api/accounting/notes/:year/:key'];
    const writes = routes().filter(
      (r) => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(r.method) && /:\w+/.test(r.path) && !tenantScopedKeys.includes(r.path),
    );
    expect(writes.length).toBeGreaterThan(20);
    const ok: string[] = [];
    for (const r of writes) {
      for (const id of ids) {
        const res = await http[r.method.toLowerCase() as 'post'](r.path.replace(/:\w+/g, id)).set(as(tokenB)).send({});
        if (res.status < 300 || res.status >= 500) ok.push(`${r.method} ${r.path} [${id}] → ${res.status}`);
      }
    }
    expect(ok).toEqual([]);
    expect(await fingerprint()).toBe(before);
  }, 180_000);

  it('B tidak bisa memakai ID milik perusahaan lain di isi permintaan', async () => {
    const pb = (url: string, body: object) => http.post(url).set(as(tokenB)).send(body);
    const rejected = async (url: string, body: object) => {
      const res = await pb(url, body);
      return res.status >= 400 && res.status < 500 ? true : `${url} → ${res.status} ${res.text.slice(0, 120)}`;
    };
    const results = [
      await rejected('/api/sales-orders', { customerId: A.customer, warehouseId: B.warehouse, lines: [{ productId: B.product, qty: '1', price: '1' }] }),
      await rejected('/api/sales-orders', { customerId: B.customer, warehouseId: A.warehouse, lines: [{ productId: B.product, qty: '1', price: '1' }] }),
      await rejected('/api/sales-orders', { customerId: B.customer, warehouseId: B.warehouse, lines: [{ productId: A.product, qty: '1', price: '1' }] }),
      await rejected('/api/quotations', { customerId: A.customer, warehouseId: B.warehouse, lines: [{ productId: B.product, qty: '1', price: '1' }] }),
      await rejected('/api/quotations', { customerId: B.customer, warehouseId: B.warehouse, lines: [{ productId: A.product, qty: '1', price: '1' }] }),
      await rejected('/api/purchase-orders', { supplierId: A.supplier, warehouseId: B.warehouse, lines: [{ productId: B.product, qty: '1', price: '1' }] }),
      await rejected('/api/purchase-orders', { supplierId: B.supplier, warehouseId: B.warehouse, lines: [{ productId: A.product, qty: '1', price: '1' }] }),
      await rejected('/api/accounting/journals', { description: 'x', lines: [{ accountId: A.cash, debit: '1' }, { accountId: B.equity, credit: '1' }] }),
      await rejected('/api/accounting/recurring', { name: 'x', description: 'x', frequency: 'MONTHLY', nextDate: '2026-12-31', lines: [{ accountId: A.cash, debit: '1' }, { accountId: B.equity, credit: '1' }] }),
      await rejected('/api/accounting/opening-balances', { date: '2025-12-31', lines: [{ accountId: A.cash, debit: '1' }, { accountId: B.equity, credit: '1' }] }),
      await rejected('/api/inventory/adjustments', { warehouseId: B.warehouse, reason: 'OPENING', lines: [{ productId: A.product, qty: '1', unitCost: '1' }] }),
      await rejected('/api/inventory/adjustments', { warehouseId: A.warehouse, reason: 'OPENING', lines: [{ productId: B.product, qty: '1', unitCost: '1' }] }),
    ];
    expect(results.filter((r) => r !== true)).toEqual([]);
    // data A tetap utuh & tidak terlihat dari B
    const so = await http.get(`/api/sales-orders/${A.salesOrder}`).set(as(tokenA)).expect(200);
    expect(JSON.stringify(so.body)).toContain(MARK);
  });

  it('sesi dicabut saat pengguna dinonaktifkan, ganti sandi, atau keluar dari semua perangkat', async () => {
    const email = `kasir-${Date.now()}@uji.id`;
    const u = (await http.post('/api/users').set(as(tokenB)).send({ name: 'Kasir', email, password: 'kasir1234', role: 'CASHIER' }).expect(201)).body;
    const login = async (pw = 'kasir1234') => (await http.post('/api/auth/login').send({ email, password: pw }).expect(200)).body.accessToken as string;

    // nonaktif → token lama langsung ditolak
    let t = await login();
    await http.get('/api/auth/me').set(as(t)).expect(200);
    await http.patch(`/api/users/${u.id}`).set(as(tokenB)).send({ isActive: false }).expect(200);
    await http.get('/api/auth/me').set(as(t)).expect(401);
    await http.post('/api/auth/login').send({ email, password: 'kasir1234' }).expect(401);
    await http.patch(`/api/users/${u.id}`).set(as(tokenB)).send({ isActive: true }).expect(200);

    // ganti peran → token lama tidak berlaku
    t = await login();
    await http.patch(`/api/users/${u.id}`).set(as(tokenB)).send({ role: 'SALES' }).expect(200);
    await http.get('/api/auth/me').set(as(t)).expect(401);

    // ganti sandi sendiri → sesi lain keluar, sesi ini dapat token baru
    const t1 = await login();
    const t2 = await login();
    await http.post('/api/auth/change-password').set(as(t1)).send({ currentPassword: 'salah123', newPassword: 'baru12345' }).expect(400);
    await http.post('/api/auth/change-password').set(as(t1)).send({ currentPassword: 'kasir1234', newPassword: 'pendek' }).expect(400);
    const fresh = (await http.post('/api/auth/change-password').set(as(t1)).send({ currentPassword: 'kasir1234', newPassword: 'baru12345' }).expect(200)).body.accessToken;
    await http.get('/api/auth/me').set(as(t1)).expect(401);
    await http.get('/api/auth/me').set(as(t2)).expect(401);
    await http.get('/api/auth/me').set(as(fresh)).expect(200);

    // keluar dari semua perangkat
    await http.post('/api/auth/logout-all').set(as(fresh)).expect(200);
    await http.get('/api/auth/me').set(as(fresh)).expect(401);
    await login('baru12345');
  });

  it('akun dikunci sementara setelah tebak sandi berulang; sandi lemah ditolak', async () => {
    const email = `kunci-${Date.now()}@uji.id`;
    await http.post('/api/users').set(as(tokenB)).send({ name: 'Kunci', email, password: 'lemah' }).expect(400);
    await http.post('/api/users').set(as(tokenB)).send({ name: 'Kunci', email, password: 'hurufsaja' }).expect(400);
    await http.post('/api/users').set(as(tokenB)).send({ name: 'Kunci', email, password: 'benar1234' }).expect(201);
    for (let i = 0; i < 8; i++) await http.post('/api/auth/login').send({ email, password: `salah${i}` }).expect(401);
    const locked = await http.post('/api/auth/login').send({ email, password: 'benar1234' }).expect(429);
    expect(locked.body.message).toMatch(/menit/);
    // email yang tidak terdaftar tetap dijawab sama (tidak membocorkan keberadaan akun)
    const ghost = await http.post('/api/auth/login').send({ email: `tidakada-${Date.now()}@uji.id`, password: 'x' }).expect(401);
    expect(ghost.body.message).toBe('Email atau kata sandi salah');
  });
});
