import { readMigrationFiles } from 'drizzle-orm/migrator';
import { join } from 'path';
import { Pool } from 'pg';
import { syncChartOfAccounts } from '../modules/accounting/coa-sync';
import { createDb } from './db';
import { tenants } from './schema';

/**
 * Terapkan migrasi yang belum jalan, SATU TRANSAKSI PER MIGRASI.
 * (Migrator bawaan drizzle membungkus semua migrasi dalam satu transaksi; PostgreSQL menolak memakai
 * nilai enum baru — ALTER TYPE ... ADD VALUE — sebelum transaksinya di-commit, sehingga pembaruan yang
 * melompati beberapa versi sekaligus bisa gagal.) Tabel catatan sama dengan drizzle: drizzle.__drizzle_migrations.
 */
export async function applyMigrations(pool: Pool, folder = join(__dirname, '../../drizzle')) {
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  await pool.query('CREATE SCHEMA IF NOT EXISTS drizzle');
  await pool.query(
    'CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
  );
  const { rows } = await pool.query<{ created_at: string }>(
    'SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1',
  );
  const last = rows[0] ? Number(rows[0].created_at) : -1;
  let applied = 0;
  for (const m of migrations) {
    if (m.folderMillis <= last) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const stmt of m.sql) if (stmt.trim()) await client.query(stmt);
      await client.query('INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at") VALUES ($1, $2)', [
        m.hash,
        m.folderMillis,
      ]);
      await client.query('COMMIT');
      applied++;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
  return applied;
}

/**
 * Terapkan migrasi yang belum jalan + selaraskan bagan akun semua perusahaan.
 * Aman dipanggil berulang (setiap API menyala), sehingga kode baru tidak pernah berjalan di atas skema lama.
 */
export async function runMigrations(pool: Pool) {
  const { rows } = await pool.query<{ v: string; num: string }>(
    "SELECT current_setting('server_version') AS v, current_setting('server_version_num') AS num",
  );
  if (Number(rows[0].num) < 180000) throw new Error(`SANSU membutuhkan PostgreSQL 18 atau lebih baru (server Anda: ${rows[0].v}).`);
  const db = createDb(pool);
  // Kunci agar dua proses (mis. dua jendela SANSU) tidak memigrasi bersamaan
  const lock = await pool.connect();
  await lock.query('SELECT pg_advisory_lock(727001)');
  try {
    await applyMigrations(pool);
    for (const t of await db.select({ id: tenants.id }).from(tenants)) {
      await db.transaction((tx) => syncChartOfAccounts(tx, t.id));
    }
  } finally {
    await lock.query('SELECT pg_advisory_unlock(727001)').catch(() => undefined);
    lock.release();
  }
}
