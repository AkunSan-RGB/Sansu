/**
 * Isolasi data antar perusahaan (dan antar jenis usaha): transaksi dan data tiap perusahaan terpisah total.
 *  - baca lewat API/RLS: id milik perusahaan lain tidak terlihat
 *  - tulis lintas perusahaan: UUID milik perusahaan lain di badan permintaan ditolak (bukan 2xx / 500)
 *  - pengaman database: foreign key lintas perusahaan ditolak walau kode lupa memeriksa; tabel anak ikut RLS induknya
 *  - invarian: tidak ada baris yang menunjuk ke baris perusahaan lain, nomor dokumen & bagan akun terpisah
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';

type Side = { token: string; tenantId: string; model: string; wh: string; product: string; customer: string; supplier: string; accountId: string; invoiceId?: string };

describe('Isolasi data antar perusahaan & jenis usaha (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Db;
  const stamp = Date.now();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const A: Side = {} as Side;
  const B: Side = {} as Side;
  const C: Side = {} as Side;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const post = (s: Side, url: string, body: object = {}) => http.post(url).set(as(s.token)).send(body);
  const get = (s: Side, url: string) => http.get(url).set(as(s.token));
  const OK_REJECT = [400, 403, 404, 409, 422];
  /** Galat asli PostgreSQL ada di cause (drizzle membungkusnya) */
  const dbError = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'TIDAK DITOLAK';
    } catch (e) {
      const x = e as { message: string; cause?: { message?: string } };
      return x.cause?.message ?? x.message;
    }
  };

  const setup = async (s: Side, model: string, tag: string) => {
    const r = (await http.post('/api/auth/register').send({ companyName: `PT ${tag}`, name: 'Pemilik', email: `is-${tag}-${stamp}@uji.id`, password: 'rahasia123', businessModel: model }).expect(201)).body;
    s.token = r.accessToken;
    s.tenantId = r.user.tenantId;
    s.model = model;
    s.wh = (await get(s, '/api/warehouses').expect(200)).body[0].id;
    s.product = (await post(s, '/api/products', { sku: 'P1', name: 'Barang', baseUom: model === 'JASA' ? 'JAM' : 'PCS', sellPrice: '10000' }).expect(201)).body.id;
    s.customer = (await post(s, '/api/customers', { code: 'C1', name: 'Pelanggan' }).expect(201)).body.id;
    s.supplier = (await post(s, '/api/suppliers', { code: 'S1', name: 'Pemasok' }).expect(201)).body.id;
    s.accountId = ((await get(s, '/api/accounting/accounts').expect(200)).body as { id: string; type: string }[]).find((a) => a.type === 'EXPENSE')!.id;
    await post(s, '/api/inventory/adjustments', { warehouseId: s.wh, reason: 'OPENING', date: today, lines: [{ productId: s.product, qty: '50', unitCost: '5000' }] }).expect(201);
    const so = (await post(s, '/api/sales-orders', { customerId: s.customer, warehouseId: s.wh, date: today, lines: [{ productId: s.product, qty: '2' }] }).expect(201)).body;
    await post(s, `/api/sales-orders/${so.id}/confirm`).expect(201);
    s.invoiceId = (await post(s, '/api/invoices', { salesOrderId: so.id, date: today }).expect(201)).body.id;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get<Db>(DB);
    await setup(A, 'FMCG', 'a');
    await setup(B, 'DAGANG', 'b');
    await setup(C, 'MANUFAKTUR', 'c');
  });
  afterAll(() => app.close());

  it('data terpisah: daftar dan akses per id hanya milik perusahaan sendiri', async () => {
    for (const [s, o] of [[A, B], [B, A], [A, C]] as [Side, Side][]) {
      for (const path of [`/api/customers/${o.customer}`, `/api/suppliers/${o.supplier}`, `/api/products/${o.product}`, `/api/invoices/${o.invoiceId}`]) {
        expect([403, 404]).toContain((await get(s, path)).status);
      }
      const ids = ((await get(s, '/api/customers').expect(200)).body as { id: string }[]).map((c) => c.id);
      expect(ids).not.toContain(o.customer);
      const invs = ((await get(s, '/api/invoices').expect(200)).body as { id: string }[]).map((c) => c.id);
      expect(invs).not.toContain(o.invoiceId);
    }
  });

  it('bagan akun & nomor dokumen terpisah per perusahaan dan jenis usaha', async () => {
    const accA = ((await get(A, '/api/accounting/accounts').expect(200)).body as { id: string }[]).map((x) => x.id);
    const accB = ((await get(B, '/api/accounting/accounts').expect(200)).body as { id: string }[]).map((x) => x.id);
    expect(accA.filter((x) => accB.includes(x))).toEqual([]);
    const nA = ((await get(A, '/api/invoices').expect(200)).body as { number: string }[])[0].number;
    const nB = ((await get(B, '/api/invoices').expect(200)).body as { number: string }[])[0].number;
    expect(nA).toBe(nB); // keduanya urutan pertama di perusahaan masing-masing, bukan satu deretan bersama
    const j = await db.execute<{ n: number }>(sql`SELECT COUNT(DISTINCT tenant_id)::int AS n FROM journal_entries WHERE tenant_id IN (${A.tenantId}, ${B.tenantId}, ${C.tenantId})`);
    expect(j.rows[0].n).toBe(3);
  });

  it('menulis dengan UUID milik perusahaan lain ditolak (bukan 2xx, bukan 500)', async () => {
    const attempts: [string, Side, string, object][] = [
      ['SO pelanggan lain', A, '/api/sales-orders', { customerId: B.customer, warehouseId: A.wh, date: today, lines: [{ productId: A.product, qty: '1' }] }],
      ['SO produk lain', A, '/api/sales-orders', { customerId: A.customer, warehouseId: A.wh, date: today, lines: [{ productId: B.product, qty: '1' }] }],
      ['SO gudang lain', A, '/api/sales-orders', { customerId: A.customer, warehouseId: B.wh, date: today, lines: [{ productId: A.product, qty: '1' }] }],
      ['PO pemasok lain', A, '/api/purchase-orders', { supplierId: B.supplier, warehouseId: A.wh, lines: [{ productId: A.product, qty: '1', price: '100' }] }],
      ['PO produk lain', A, '/api/purchase-orders', { supplierId: A.supplier, warehouseId: A.wh, lines: [{ productId: B.product, qty: '1', price: '100' }] }],
      ['penyesuaian stok produk lain', A, '/api/inventory/adjustments', { warehouseId: A.wh, reason: 'OPENING', date: today, lines: [{ productId: B.product, qty: '5', unitCost: '1' }] }],
      ['penyesuaian stok gudang lain', A, '/api/inventory/adjustments', { warehouseId: B.wh, reason: 'OPENING', date: today, lines: [{ productId: A.product, qty: '5', unitCost: '1' }] }],
      ['jurnal manual akun lain', A, '/api/accounting/journals', { date: today, description: 'x', lines: [{ accountId: B.accountId, debit: '100' }, { accountId: A.accountId, credit: '100' }] }],
      ['pembayaran faktur lain', A, '/api/payments', { invoiceId: B.invoiceId, amount: '100', method: 'TRANSFER' }],
      ['pelanggan baru dengan daftar harga lain', A, '/api/customers', { code: 'X1', name: 'X', priceListId: '00000000-0000-4000-8000-000000000000' }],
      ['karyawan cabang lain', A, '/api/hr/employees', { code: 'E1', name: 'E', ptkp: 'TK/0', joinDate: today, baseSalary: '1000000', branchId: B.wh }],
      ['karyawan proyek lain', A, '/api/hr/employees', { code: 'E2', name: 'E', ptkp: 'TK/0', joinDate: today, baseSalary: '1000000', projectId: B.wh }],
    ];
    for (const [label, s, url, body] of attempts) {
      const r = await post(s, url, body);
      expect({ label, ok: OK_REJECT.includes(r.status) }).toEqual({ label, ok: true });
    }
  });

  it('pengaman database: foreign key lintas perusahaan ditolak walau kode lupa memeriksa', async () => {
    // koneksi admin (melewati RLS) — meniru kode yang lupa menyaring tenant
    expect(await dbError(db.execute(sql`INSERT INTO sales_orders (tenant_id, number, date, customer_id, warehouse_id, status, subtotal, tax_amount, total) VALUES (${A.tenantId}, 'X-1', ${today}, ${B.customer}, ${A.wh}, 'DRAFT', '0', '0', '0')`))).toMatch(/lintas perusahaan/);
    // baris anak: produk milik perusahaan lain pada baris pesanan perusahaan ini
    const soA = (await get(A, '/api/sales-orders').expect(200)).body[0];
    expect(await dbError(db.execute(sql`INSERT INTO sales_order_lines (order_id, product_id, uom, uom_factor, qty, price, line_total) VALUES (${soA.id}, ${B.product}, 'PCS', '1', '1', '1', '1')`))).toMatch(/lintas perusahaan/);
  });

  it('tabel anak tunduk pada RLS induknya (peran aplikasi tanpa filter tetap hanya melihat perusahaannya)', async () => {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const count = async (tenant: string, table: string) => {
        const c = await pool.connect();
        try {
          await c.query(`SET ROLE sansu_app`);
          await c.query(`SELECT set_config('app.tenant_id', $1, false), set_config('app.bypass_rls', 'off', false)`, [tenant]);
          return Number((await c.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n);
        } finally {
          await c.query('RESET ROLE').catch(() => undefined);
          c.release();
        }
      };
      const all = Number((await pool.query(`SELECT COUNT(*)::int AS n FROM journal_lines`)).rows[0].n);
      const a = await count(A.tenantId, 'journal_lines');
      const b = await count(B.tenantId, 'journal_lines');
      const cc = await count(C.tenantId, 'journal_lines');
      expect(a).toBeGreaterThan(0);
      expect(b).toBeGreaterThan(0);
      expect(a + b + cc).toBeLessThanOrEqual(all);
      expect(a).toBeLessThan(all);
      for (const table of ['sales_order_lines', 'invoice_lines', 'stock_count_lines', 'payslips']) {
        const x = await count(A.tenantId, table);
        const total = Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n);
        expect(x).toBeLessThanOrEqual(total);
      }
      expect(await count(A.tenantId, 'sales_order_lines')).toBeLessThan(Number((await pool.query(`SELECT COUNT(*)::int AS n FROM sales_order_lines`)).rows[0].n));
    } finally {
      await pool.end();
    }
  });

  it('invarian: tidak ada baris yang menunjuk ke baris perusahaan lain; semua foreign key lintas-tabel punya pengaman', async () => {
    const fks = (
      await db.execute<{ child: string; col: string; parent: string; pcol: string; child_tenant: boolean }>(sql`
        SELECT cl.relname AS child, a.attname AS col, pl.relname AS parent, pa.attname AS pcol,
               EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema='public' AND k.table_name = cl.relname AND k.column_name='tenant_id') AS child_tenant
        FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_class pl ON pl.oid = c.confrelid
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1] JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
        JOIN pg_namespace n ON n.oid = cl.relnamespace
        WHERE c.contype='f' AND n.nspname='public' AND array_length(c.conkey,1)=1 AND pl.relname <> 'tenants'
          AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema='public' AND k.table_name = pl.relname AND k.column_name='tenant_id')`)
    ).rows;
    expect(fks.length).toBeGreaterThan(100);
    for (const f of fks.filter((x) => x.child_tenant)) {
      const bad = await db.execute(sql.raw(`SELECT 1 FROM "${f.child}" c JOIN "${f.parent}" p ON p."${f.pcol}" = c."${f.col}" WHERE p.tenant_id <> c.tenant_id LIMIT 1`));
      expect({ fk: `${f.child}.${f.col}`, leak: bad.rows.length }).toEqual({ fk: `${f.child}.${f.col}`, leak: 0 });
    }
    // setiap tabel ber-tenant_id yang punya foreign key ke tabel ber-tenant_id memiliki trigger pengaman
    const unguarded = await db.execute<{ t: string }>(sql`
      SELECT DISTINCT cl.relname AS t FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_class pl ON pl.oid = c.confrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE c.contype='f' AND n.nspname='public' AND pl.relname <> 'tenants' AND cl.relname NOT IN ('tenants','plans','platform_settings','auth_tokens')
        AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema='public' AND k.table_name = pl.relname AND k.column_name='tenant_id')
        AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema='public' AND k.table_name = cl.relname AND k.column_name='tenant_id')
        AND NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = cl.oid AND tg.tgname = 'sansu_tenant_guard')`);
    expect(unguarded.rows).toEqual([]);
    // tabel anak tanpa tenant_id yang punya induk ber-tenant_id wajib ber-RLS
    const noRls = await db.execute<{ t: string }>(sql`
      SELECT DISTINCT cl.relname AS t FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_class pl ON pl.oid = c.confrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE c.contype='f' AND n.nspname='public' AND cl.relname NOT IN ('tenants','plans','platform_settings','auth_tokens') AND cl.relkind = 'r' AND NOT cl.relrowsecurity
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema='public' AND k.table_name = cl.relname AND k.column_name='tenant_id')
        AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema='public' AND k.table_name = pl.relname AND k.column_name='tenant_id')`);
    expect(noRls.rows).toEqual([]);
  });
});
