import { Pool, PoolClient, PoolConfig } from 'pg';
import { dbScope } from './db-scope';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nama peran database yang tunduk pada row-level security (dibuat oleh migrasi 0038). */
export const APP_ROLE = 'sansu_app';

/** SQL penyiapan sesi untuk lingkup saat ini. tenantId divalidasi sebagai UUID sehingga aman disisipkan. */
export function scopeSql(scope = dbScope.getStore()): string {
  const bypass = !scope || scope.bypass || !scope.tenantId;
  if (!bypass && !UUID_RE.test(scope!.tenantId!)) throw new Error('tenantId tidak valid untuk lingkup database');
  const tenant = bypass ? '' : scope!.tenantId!.toLowerCase();
  return `SET ROLE ${APP_ROLE}; SELECT set_config('app.tenant_id', '${tenant}', false), set_config('app.bypass_rls', '${bypass ? 'on' : 'off'}', false)`;
}

/**
 * Pool yang menyiapkan setiap koneksi yang dipinjam: berganti ke peran `sansu_app` (tidak melewati RLS)
 * dan mengisi perusahaan aktif dari lingkup permintaan. Dengan begitu query yang lupa menyaring
 * `tenant_id` tetap tidak bisa membaca atau mengubah baris perusahaan lain.
 * (Turunan `Pool` agar pemeriksaan `instanceof Pool` milik drizzle tetap berlaku untuk transaksi.)
 */
export class TenantPool extends Pool {
  constructor(config: PoolConfig) {
    super(config);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connect(cb?: any): any {
    // PENTING: lingkup dibaca SEKARANG (di konteks pemanggil). Bila kolam penuh, permintaan antre dan baru dilayani
    // di konteks async pihak lain — membaca lingkup saat itu akan memakai perusahaan yang salah.
    let sql: string;
    try {
      sql = scopeSql();
    } catch (e) {
      if (typeof cb === 'function') {
        cb(e, undefined, () => undefined);
        return undefined;
      }
      return Promise.reject(e);
    }
    const prepare = async (client: PoolClient & { __scopeKey?: string }) => {
      // Sesi sudah memakai lingkup yang sama (pengaturan sesi bertahan antar peminjaman): lewati satu round-trip
      if (client.__scopeKey === sql) return;
      client.__scopeKey = undefined;
      await client.query(sql);
      client.__scopeKey = sql;
    };
    if (typeof cb === 'function') {
      super.connect((err: Error | undefined, client: PoolClient | undefined, done: (e?: Error) => void) => {
        if (err || !client) return cb(err, client, done);
        prepare(client).then(
          () => cb(undefined, client, done),
          (e) => {
            done(e);
            cb(e, undefined, done);
          },
        );
      });
      return undefined;
    }
    return super.connect().then(async (client: PoolClient) => {
      try {
        await prepare(client);
      } catch (e) {
        client.release(e as Error);
        throw e;
      }
      return client;
    });
  }
}
