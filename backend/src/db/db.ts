import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, types } from 'pg';
import * as schema from './schema';

// Kembalikan kolom DATE sebagai string 'YYYY-MM-DD' apa adanya (tanpa konversi zona waktu)
types.setTypeParser(1082, (v) => v);

export type Db = NodePgDatabase<typeof schema>;
/** Klien transaksi — semua posting dokumen berjalan di dalam satu Tx. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Bisa koneksi biasa atau transaksi */
export type DbOrTx = Db | Tx;

export const DB = Symbol('DB');
export const POOL = Symbol('POOL');

export function createPool(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL belum diatur');
  return new Pool({ connectionString: url, max: 10 });
}

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}

export { schema };
