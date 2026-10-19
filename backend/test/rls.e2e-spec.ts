/**
 * Row-level security (e2e): isolasi antar perusahaan ditegakkan di DASAR database, bukan hanya di kode.
 *  - setiap tabel ber-tenant_id wajib punya RLS aktif + kebijakan (penjaga agar tabel baru tidak terlewat)
 *  - query TANPA filter tenant_id di dalam lingkup perusahaan A hanya melihat/menulis baris A
 *  - sesi bypass (login, panel pemilik, tugas latar) tetap melihat semuanya
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';
import { dbScope } from '../src/db/db-scope';
import { scopeSql } from '../src/db/tenant-pool';

describe('Row-level security (e2e)', () => {
  let app: INestApplication;
  let db: Db;
  let tenantA: string;
  let tenantB: string;
  // query drizzle itu malas (jalan saat di-await): await harus terjadi DI DALAM lingkup, seperti pada penanganan permintaan sungguhan
const inScope = <T>(tenantId: string | undefined, fn: () => PromiseLike<T>): Promise<T> =>
    dbScope.run(tenantId ? { tenantId, bypass: false } : { bypass: true }, async () => await fn());
  const count = async (tenant: string | undefined, table: string) =>
    Number((await inScope(tenant, () => db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM ${sql.identifier(table)}`))).rows[0].n);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    db = app.get<Db>(DB);
    const http = request(app.getHttpServer());
    const stamp = Date.now();
    const reg = async (n: string) =>
      (await http.post('/api/auth/register').send({ companyName: `PT RLS ${n}`, name: `Pemilik ${n}`, email: `rls-${n}-${stamp}@uji.id`, password: 'rahasia123' }).expect(201)).body;
    const a = await reg('A');
    const b = await reg('B');
    tenantA = a.user.tenantId;
    tenantB = b.user.tenantId;
    const mk = (t: string) => http.post('/api/customers').set({ Authorization: `Bearer ${t}` });
    await mk(a.accessToken).send({ code: 'C-RLS-A', name: 'Pelanggan RLS A' }).expect(201);
    await mk(b.accessToken).send({ code: 'C-RLS-B', name: 'Pelanggan RLS B' }).expect(201);
  });
  afterAll(() => app.close());

  it('setiap tabel ber-tenant_id punya RLS aktif dan kebijakan tenant_isolation', async () => {
    const rows = (
      await db.execute<{ t: string; rls: boolean; pol: string | null }>(sql`
        SELECT c.relname AS t, c.relrowsecurity AS rls,
               (SELECT polname FROM pg_policy p WHERE p.polrelid = c.oid AND polname = 'tenant_isolation') AS pol
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        WHERE c.relkind = 'r' AND EXISTS (
          SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'tenant_id')`)
    ).rows;
    expect(rows.length).toBeGreaterThan(30);
    // data_erasure_log: bukti penghapusan tanpa FK; kebijakan 'platform_only' (hanya bypass) lebih ketat daripada tenant_isolation
    expect(rows.filter((r) => r.t !== 'data_erasure_log' && (!r.rls || r.pol !== 'tenant_isolation')).map((r) => r.t)).toEqual([]);
    expect(rows.find((r) => r.t === 'data_erasure_log')?.rls).toBe(true);
  });

  it('di dalam lingkup perusahaan A, query tanpa filter hanya melihat baris A', async () => {
    const all = await count(undefined, 'customers');
    const a = await count(tenantA, 'customers');
    const b = await count(tenantB, 'customers');
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(all).toBeGreaterThanOrEqual(2);
    const names = (await inScope(tenantA, () => db.execute<{ name: string }>(sql`SELECT name FROM customers`))).rows.map((r) => r.name);
    expect(names).toEqual(['Pelanggan RLS A']);
  });

  it('tidak bisa menyisipkan, mengubah, atau menghapus baris perusahaan lain', async () => {
    const err = await inScope(tenantA, () => db.execute(sql`INSERT INTO customers (tenant_id, code, name) VALUES (${tenantB}, 'C-BOCOR', 'Bocor')`)).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(`${err.message} ${(err as { cause?: Error }).cause?.message ?? ''}`).toMatch(/row-level security/i);
    const upd = await inScope(tenantA, () => db.execute(sql`UPDATE customers SET name = 'DIUBAH' WHERE tenant_id = ${tenantB}`));
    expect(upd.rowCount).toBe(0);
    const del = await inScope(tenantA, () => db.execute(sql`DELETE FROM customers WHERE tenant_id = ${tenantB}`));
    expect(del.rowCount).toBe(0);
    expect(await count(tenantB, 'customers')).toBe(1);
  });

  it('transaksi mengikuti lingkup perusahaan yang sama', async () => {
    const n = await inScope(tenantB, () =>
      db.transaction(async (tx) => Number((await tx.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM customers`)).rows[0].n)),
    );
    expect(n).toBe(1);
  });

  it('lingkup tidak bocor antar permintaan: setelah lingkup A selesai, sesi bypass melihat semuanya lagi', async () => {
    await count(tenantA, 'customers');
    expect(await count(undefined, 'customers')).toBeGreaterThanOrEqual(2);
  });

  it('query paralel melebihi ukuran kolam (antre) tetap memakai perusahaan masing-masing', async () => {
    const jobs = Array.from({ length: 40 }, (_, i) => {
      const t = i % 2 ? tenantA : tenantB;
      return inScope(t, () => db.execute<{ t: string }>(sql`SELECT tenant_id::text AS t FROM customers`)).then((r) => ({ t, seen: r.rows.map((x) => x.t) }));
    });
    for (const j of await Promise.all(jobs)) expect(j.seen).toEqual([j.t]);
  });

  it('tenantId bukan UUID ditolak (tidak bisa menyisipkan SQL lewat lingkup)', () => {
    expect(() => dbScope.run({ tenantId: "x'; DROP TABLE customers; --", bypass: false }, () => scopeSql())).toThrow(/tidak valid/);
  });
});
