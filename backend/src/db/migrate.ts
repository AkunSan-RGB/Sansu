/**
 * Jalankan migrasi SQL di folder /drizzle.
 *   npm run db:migrate            → terapkan migrasi baru
 *   ts-node src/db/migrate.ts --reset → HAPUS semua data lalu migrasi ulang (hanya untuk test)
 */
import 'dotenv/config';
import { runMigrations } from './run-migrations';
import { createPool } from './db';
import { describeDbError } from './db-error';
import { Logger } from '@nestjs/common';

const log = new Logger('Migrasi');

async function main() {
  const pool = createPool();
  if (process.argv.includes('--reset')) {
    if (!process.env.DATABASE_URL?.includes('test')) throw new Error('--reset hanya boleh untuk database test');
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
  }
  await runMigrations(pool);
  log.log('Migrasi selesai.');
  await pool.end();
}

main().catch((e) => {
  console.error('\n[X] Migrasi database gagal.\n' + describeDbError(e));
  process.exit(1);
});
