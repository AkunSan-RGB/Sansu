/**
 * Tabel global (tenants, plans, platform_settings, auth_tokens) tidak boleh ber-RLS: tanpa kebijakan, RLS menolak
 * pendaftaran/demo/login. Tes ini juga memastikan migrasi pemulih (0105) benar-benar memperbaiki keadaan yang rusak.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const GLOBAL = ['tenants', 'plans', 'platform_settings', 'auth_tokens'];

describe('Tabel global tanpa RLS (e2e)', () => {
  let pool: Pool;
  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });
  afterAll(async () => {
    await pool.end();
  });

  const state = async () =>
    (await pool.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1)`, [GLOBAL])).rows;

  it('setelah migrasi, tidak satu pun tabel global memakai RLS', async () => {
    for (const r of await state()) expect([r.relname, r.relrowsecurity]).toEqual([r.relname, false]);
  });

  it('migrasi 0105 memulihkan tabel global yang RLS-nya terlanjur aktif', async () => {
    await pool.query('ALTER TABLE tenants ENABLE ROW LEVEL SECURITY');
    expect((await state()).find((r) => r.relname === 'tenants')!.relrowsecurity).toBe(true);
    await pool.query(readFileSync(join(__dirname, '../drizzle/0105_tabel_global_tanpa_rls.sql'), 'utf8'));
    for (const r of await state()) expect([r.relname, r.relrowsecurity]).toEqual([r.relname, false]);
  });
});
