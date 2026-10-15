/**
 * Migrasi 0058: perusahaan lama bermodel PRODUKSI (mengolah bahan baku: resep, perintah produksi) dipindah ke MANUFAKTUR yang
 * mempertahankan seluruh fitur produksinya; model lain dan perusahaan tanpa pengaturan model tidak tersentuh.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { sql } from 'drizzle-orm';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DB, Db } from '../src/db/db';

describe('Migrasi Produksi → Manufaktur (e2e)', () => {
  let app: INestApplication;
  let db: Db;
  const stamp = Date.now();

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    db = app.get<Db>(DB);
  });
  afterAll(() => app.close());

  it('hanya model PRODUKSI yang berubah menjadi MANUFAKTUR', async () => {
    const mk = async (name: string, settings: object) =>
      (await db.execute<{ id: string }>(sql`INSERT INTO tenants (name, settings) VALUES (${`${name} ${stamp}`}, ${JSON.stringify(settings)}::jsonb) RETURNING id`)).rows[0].id;
    const a = await mk('Konveksi lama', { business: { model: 'PRODUKSI', other: 1 }, keep: true });
    const b = await mk('Dagang', { business: { model: 'DAGANG' } });
    const c = await mk('Tanpa model', {});
    const file = readFileSync(join(__dirname, '../drizzle/0058_model_fmcg.sql'), 'utf8').replace(/^\s*--.*$/gm, '');
    for (const stmt of file.split(';').map((x) => x.trim()).filter(Boolean)) await db.execute(sql.raw(stmt));
    const model = async (id: string) => (await db.execute<{ m: string | null; s: string }>(sql`SELECT settings #>> '{business,model}' AS m, settings::text AS s FROM tenants WHERE id = ${id}`)).rows[0];
    const ra = await model(a);
    expect(ra.m).toBe('MANUFAKTUR');
    expect(ra.s).toContain('"other": 1');
    expect(ra.s).toContain('"keep": true');
    expect((await model(b)).m).toBe('DAGANG');
    expect((await model(c)).m).toBeNull();
  });
});
