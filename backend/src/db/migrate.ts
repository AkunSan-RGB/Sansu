/**
 * Jalankan migrasi SQL di folder /drizzle.
 *   npm run db:migrate            → terapkan migrasi baru
 *   ts-node src/db/migrate.ts --reset → HAPUS semua data lalu migrasi ulang (hanya untuk test)
 */
import 'dotenv/config';
import { runMigrations } from './run-migrations';
import { createPool } from './db';

async function main() {
  const pool = createPool();
  if (process.argv.includes('--reset')) {
    if (!process.env.DATABASE_URL?.includes('test')) throw new Error('--reset hanya boleh untuk database test');
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
  }
  await runMigrations(pool);
  console.log('Migrasi selesai.');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
