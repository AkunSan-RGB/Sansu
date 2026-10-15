/**
 * "Lihat Demo" (e2e): PT DEMO berisi transaksi contoh yang berbeda untuk tiap jenis usaha,
 * pembukuan seimbang, perusahaan terpisah per pengunjung.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';
import { DemoService } from '../src/modules/demo/demo.module';

const MODELS = ['RITEL', 'DAGANG', 'JASA', 'FMCG', 'MANUFAKTUR', 'FNB'] as const;

describe('Lihat Demo (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const sessions = new Map<string, { token: string; tenantId: string }>();
  const get = (t: string, u: string) => http.get(u).set({ Authorization: `Bearer ${t}` });
  const count = async (tenantId: string, table: string) =>
    Number((await db.execute<{ n: string }>(sql.raw(`SELECT COUNT(*)::text AS n FROM ${table} WHERE tenant_id = '${tenantId}'`))).rows[0].n);

  beforeAll(async () => {
    process.env.DEMO_STRICT = 'true';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    db = app.get<Db>(DB);
    http = request(app.getHttpServer());
  });
  afterAll(async () => {
    delete process.env.DEMO_STRICT;
    await app.close();
  });

  it.each(MODELS)('%s: PT DEMO dibuat dengan transaksi contoh dan pembukuan seimbang', async (model) => {
    const r = await http.post('/api/demo/start').send({ businessModel: model }).expect(200);
    const token = r.body.accessToken as string;
    const me = (await get(token, '/api/auth/me').expect(200)).body;
    expect(me.tenantName).toBe('PT DEMO');
    expect(me.businessModel).toBe(model);
    expect(me.demo?.expiresAt).toBeTruthy(); // spanduk "mode demo" + masa hapus otomatis
    sessions.set(model, { token, tenantId: me.tenantId });

    const tb = (await get(token, '/api/accounting/reports/trial-balance').expect(200)).body;
    expect(tb.balanced).toBe(true);
    expect(Number(tb.totalDebit)).toBeGreaterThan(0);
    const pl = (await get(token, `/api/accounting/reports/profit-loss`).expect(200)).body;
    expect(Number(pl.totalRevenue)).toBeGreaterThan(0);
    const bs = (await get(token, '/api/accounting/reports/balance-sheet').expect(200)).body;
    expect(bs.balanced).toBe(true);
    const health = (await get(token, '/api/accounting/health').expect(200)).body.checks as { key: string; status: string }[];
    expect(health.filter((h) => h.status === 'ERROR').map((h) => h.key)).toEqual([]);
    expect(await count(me.tenantId, 'journal_entries')).toBeGreaterThan(8);
    expect(await count(me.tenantId, 'employees')).toBeGreaterThan(0);
  });

  it('data tiap jenis usaha berbeda (produk, pelanggan, jenis dokumen)', async () => {
    const names = async (model: string, table: string, col: string) => {
      const s = sessions.get(model)!;
      return (await db.execute<{ v: string }>(sql.raw(`SELECT ${col} AS v FROM ${table} WHERE tenant_id = '${s.tenantId}'`))).rows.map((x) => x.v);
    };
    const skus = await Promise.all(MODELS.map((m) => names(m, 'products', 'sku')));
    // tidak ada SKU yang sama antar jenis usaha
    const all = skus.flat();
    expect(new Set(all).size).toBe(all.length);
    const custs = await Promise.all(MODELS.map((m) => names(m, 'customers', 'code')));
    const allC = custs.flat();
    expect(new Set(allC).size).toBe(allC.length);
    // ciri khas tiap model
    const s = (m: string) => sessions.get(m)!.tenantId;
    expect(await count(s('RITEL'), 'pos_orders')).toBeGreaterThan(20);
    expect(await count(s('DAGANG'), 'invoices')).toBeGreaterThan(5);
    expect(await count(s('JASA'), 'projects')).toBeGreaterThan(0);
    expect(await count(s('JASA'), 'products')).toBe(0);
    // FMCG: distribusi barang konsumen — tanpa produksi, tetapi ber-lot dengan tanggal kedaluwarsa
    expect(await count(s('FMCG'), 'production_orders')).toBe(0);
    expect(await count(s('FMCG'), 'invoices')).toBeGreaterThan(10);
    expect(await count(s('FMCG'), 'stock_lots')).toBeGreaterThan(3);
    // daftar harga per segmen, promo, dan jejak lot ke pelanggan (bahan penelusuran recall)
    expect(await count(s('FMCG'), 'price_lists')).toBe(2);
    expect(await count(s('FMCG'), 'promos')).toBe(2);
    expect(await count(s('FMCG'), 'stock_lot_issues')).toBeGreaterThan(5);
    expect(await count(s('RITEL'), 'price_lists')).toBe(0);
    expect(await count(s('MANUFAKTUR'), 'production_orders')).toBeGreaterThan(2);
    expect(await count(s('RITEL'), 'production_orders')).toBe(0);
    expect(await count(s('DAGANG'), 'pos_orders')).toBe(0);
    // F&B: menu dijual lewat kasir dan bahan terpotong otomatis sesuai resep; ada resep, barang setengah jadi, dan produksi adonan
    expect(await count(s('FNB'), 'pos_orders')).toBeGreaterThan(50);
    expect(await count(s('FNB'), 'boms')).toBeGreaterThan(6);
    expect(Number((await db.execute<{ n: string }>(sql.raw(`SELECT COUNT(*)::text AS n FROM pos_order_lines l JOIN pos_orders o ON o.id = l.order_id WHERE o.tenant_id = '${s('FNB')}' AND l.from_recipe`))).rows[0].n)).toBeGreaterThan(50);
    expect(await count(s('FNB'), 'production_orders')).toBeGreaterThan(1);
    // meja, pesanan terbuka, pesanan online + pencairan, dan pajak restoran daerah (PB1)
    expect(await count(s('FNB'), 'pos_tables')).toBe(4);
    expect(await count(s('FNB'), 'pos_platform_settlements')).toBe(1);
    const one = async (q: string) => Number((await db.execute<{ n: string }>(sql.raw(q))).rows[0].n);
    expect(await one(`SELECT COUNT(*)::text AS n FROM pos_orders WHERE tenant_id = '${s('FNB')}' AND channel IS NOT NULL`)).toBe(5);
    expect(await one(`SELECT COUNT(*)::text AS n FROM pos_orders WHERE tenant_id = '${s('FNB')}' AND channel IS NOT NULL AND settlement_id IS NULL`)).toBe(3);
    expect(await one(`SELECT COUNT(*)::text AS n FROM pos_tabs WHERE tenant_id = '${s('FNB')}' AND status = 'OPEN'`)).toBe(1);
    expect(await one(`SELECT COUNT(*)::text AS n FROM pos_orders WHERE tenant_id = '${s('FNB')}' AND tax_kind = 'LOCAL'`)).toBeGreaterThan(50);
    expect(await one(`SELECT COUNT(*)::text AS n FROM pos_orders WHERE tenant_id = '${s('FNB')}' AND tax_kind = 'VAT' AND tax_amount::numeric > 0`)).toBe(0);
    const kitchen = (await get(sessions.get('FNB')!.token, '/api/pos/kitchen').expect(200)).body;
    expect(kitchen.tickets.length).toBe(1);
    // F&B: ada lot dengan tanggal kedaluwarsa (satu sudah lewat, beberapa segera); jumlah lot tidak melebihi stok
    const lotList = (await get(sessions.get('FNB')!.token, '/api/inventory/lots').expect(200)).body;
    expect(lotList.summary.expired).toBeGreaterThanOrEqual(1);
    expect(lotList.summary.soon).toBeGreaterThanOrEqual(2);
    expect(lotList.items.length).toBeGreaterThanOrEqual(4);
    expect(Number((await db.execute<{ n: string }>(sql.raw(`SELECT COUNT(*)::text AS n FROM (SELECT l.product_id FROM stock_lots l JOIN stock_balances b ON b.product_id = l.product_id AND b.warehouse_id = l.warehouse_id WHERE l.tenant_id = '${s('FNB')}' AND l.qty_remaining > 0 GROUP BY l.product_id, l.warehouse_id, b.qty HAVING SUM(l.qty_remaining) > b.qty) x`))).rows[0].n)).toBe(0);
  });

  it('tiap permintaan membuat perusahaan terpisah', async () => {
    const a = (await http.post('/api/demo/start').send({ businessModel: 'JASA' }).expect(200)).body.accessToken;
    const b = (await http.post('/api/demo/start').send({ businessModel: 'JASA' }).expect(200)).body.accessToken;
    const ta = (await get(a, '/api/auth/me').expect(200)).body.tenantId;
    const tb = (await get(b, '/api/auth/me').expect(200)).body.tenantId;
    expect(ta).not.toBe(tb);
  });

  it('jenis usaha tidak dikenal ditolak', async () => {
    await http.post('/api/demo/start').send({ businessModel: 'NGAWUR' }).expect(400);
  });

  it('perusahaan demo kedaluwarsa dibersihkan, perusahaan biasa tidak disentuh', async () => {
    const old = sessions.get('JASA')!.tenantId;
    const keep = sessions.get('RITEL')!.tenantId;
    await db.execute(sql`UPDATE tenants SET created_at = now() - interval '5 days' WHERE id = ${old}`);
    const n = await app.get(DemoService).purgeExpired();
    expect(n).toBeGreaterThanOrEqual(1);
    const left = (await db.execute<{ id: string }>(sql`SELECT id FROM tenants WHERE id IN (${old}, ${keep})`)).rows.map((r) => r.id);
    expect(left).toEqual([keep]);
    expect(await count(old, 'journal_entries')).toBe(0);
  });

  it('produk dikelompokkan otomatis: bahan baku, produk jadi (dari resep), setengah jadi tidak bercampur', async () => {
    const roles = async (m: string) => ((await get(sessions.get(m)!.token, '/api/products').expect(200)).body as { sku: string; role: string }[]);
    const man = await roles('MANUFAKTUR');
    expect(man.filter((p) => p.role === 'RAW').map((p) => p.sku)).toEqual(expect.arrayContaining(['FN-JATI', 'FN-PLY']));
    expect(man.filter((p) => p.role === 'FINISHED').map((p) => p.sku).sort()).toEqual(['FN-KURSI', 'FN-LEMARI', 'FN-MEJA']);
    // usaha dagang tidak punya resep: semua "barang lain"
    expect((await roles('DAGANG')).every((p) => p.role === 'TRADING')).toBe(true);
  });
});

describe('Sebutan Resep per industri (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
  });
  afterAll(async () => {
    await app.close();
  });

  it('ADMIN dapat mengganti sebutan Resep; /auth/me ikut berubah; nilai di luar daftar ditolak', async () => {
    const r = await http.post('/api/demo/start').send({ businessModel: 'MANUFAKTUR' }).expect(200);
    const auth = { Authorization: `Bearer ${r.body.accessToken}` };
    expect((await http.get('/api/auth/me').set(auth)).body.recipeTerm).toBe('Resep');
    await http.patch('/api/settings/terms').set(auth).send({ recipe: 'Bill of Materials' }).expect(200);
    expect((await http.get('/api/auth/me').set(auth)).body.recipeTerm).toBe('Bill of Materials');
    await http.patch('/api/settings/terms').set(auth).send({ recipe: 'Ngawur' }).expect(400);
  });
});
