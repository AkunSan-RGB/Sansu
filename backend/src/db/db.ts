import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, types } from 'pg';
import * as schema from './schema';
import { cleanDbUrl } from './db-error';
import { txScope } from './db-scope';
import { TenantPool } from './tenant-pool';

// Kembalikan kolom DATE sebagai string 'YYYY-MM-DD' apa adanya (tanpa konversi zona waktu)
types.setTypeParser(1082, (v) => v);

export type Db = NodePgDatabase<typeof schema>;
/** Klien transaksi — semua posting dokumen berjalan di dalam satu Tx. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Bisa koneksi biasa atau transaksi */
export type DbOrTx = Db | Tx;

export const DB = Symbol('DB');
export const POOL = Symbol('POOL');

/** Isi kolam dan batas tunggu: permintaan yang tidak kebagian koneksi gagal dengan galat jelas, tidak menggantung selamanya */
const POOL_MAX = Number(process.env.DB_POOL_MAX ?? 10);
const POOL_WAIT_MS = Number(process.env.DB_POOL_WAIT_MS ?? 20_000);
const poolOptions = { max: POOL_MAX, connectionTimeoutMillis: POOL_WAIT_MS };

/**
 * Batas waktu di sisi database untuk koneksi aplikasi (bukan migrasi/seed): kueri yang macet dibatalkan dan transaksi yang
 * dibiarkan menganggur melepas kuncinya, sehingga satu permintaan buruk tidak menghabiskan kolam atau menahan baris pengguna lain.
 * 0 = tanpa batas. Pekerjaan besar sengaja dipecah dalam transaksi kecil (tagih berlatar, impor per bagian).
 */
const STATEMENT_TIMEOUT_MS = Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 60_000);
const IDLE_TX_TIMEOUT_MS = Number(process.env.DB_IDLE_TX_TIMEOUT_MS ?? 60_000);
const appPoolOptions = {
  ...poolOptions,
  statement_timeout: STATEMENT_TIMEOUT_MS,
  idle_in_transaction_session_timeout: IDLE_TX_TIMEOUT_MS,
};

export function createPool(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL belum diatur');
  return new Pool({ connectionString: cleanDbUrl(url), ...poolOptions });
}

/**
 * Pool untuk aplikasi (API): memakai peran `sansu_app` + row-level security per perusahaan.
 * Matikan darurat lewat RLS_DISABLED=true (kembali ke pool biasa). Migrasi/seed memakai createPool biasa.
 */
export function createAppPool(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL belum diatur');
  const connectionString = cleanDbUrl(url);
  if (process.env.RLS_DISABLED === 'true') return new Pool({ connectionString, ...appPoolOptions });
  return new TenantPool({ connectionString, ...appPoolOptions });
}

export function createDb(pool: Pool): Db {
  const db = drizzle(pool, { schema });
  // Tandai alur async di dalam transaksi agar koneksi kedua (penyebab kebuntuan kolam) terdeteksi oleh TenantPool
  const transaction = db.transaction.bind(db);
  db.transaction = ((cb: Parameters<Db['transaction']>[0], config?: Parameters<Db['transaction']>[1]) =>
    transaction((tx) => txScope.run({ inTx: true }, () => cb(tx)), config)) as Db['transaction'];
  return db;
}

export { schema };
