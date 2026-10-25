import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Lingkup akses database untuk satu permintaan HTTP.
 *  - `tenantId` terisi, `bypass: false` → hanya baris perusahaan itu yang terlihat/bisa ditulis (row-level security).
 *  - `bypass: true` → tanpa penyaringan perusahaan: dipakai di luar permintaan terautentikasi
 *    (login, pendaftaran, tautan persetujuan, tugas latar, panel pemilik layanan, tes).
 * Di luar permintaan HTTP (tidak ada lingkup) perlakuannya sama dengan bypass.
 */
export interface DbScope {
  tenantId?: string;
  bypass: boolean;
}

export const dbScope = new AsyncLocalStorage<DbScope>();

/** Penjalan query yang bisa dipakai di dalam transaksi (db atau tx drizzle). */
interface Runner {
  execute(query: import('drizzle-orm').SQL): PromiseLike<{ rows: Record<string, unknown>[] }>;
}

/**
 * Jalankan `fn` dengan penyaringan perusahaan dimatikan HANYA untuk bagian itu — untuk pekerjaan yang memang lintas perusahaan
 * (mis. nomor tagihan langganan global). Wajib dipanggil di dalam transaksi `tx`; setelah selesai kondisi semula dipulihkan.
 * Pemakaiannya harus langka dan eksplisit: setiap pemanggil adalah pengecualian yang disengaja dari isolasi perusahaan.
 */
export async function withRlsBypass<T>(tx: Runner, fn: () => Promise<T>): Promise<T> {
  const { sql } = await import('drizzle-orm');
  const prev = String((await tx.execute(sql`SELECT coalesce(current_setting('app.bypass_rls', true), '') AS v`)).rows[0].v);
  await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
  try {
    return await fn();
  } finally {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', ${prev}, true)`);
  }
}

/**
 * Penanda "sedang di dalam transaksi" pada alur async saat ini. Dipakai untuk mendeteksi kode yang meminta koneksi KEDUA
 * dari kolam sementara sudah memegang satu untuk transaksinya: bila beberapa transaksi seperti itu berjalan bersamaan sebanyak
 * isi kolam, semuanya saling menunggu koneksi dan server macet (kebuntuan kolam). Gunakan `tx` (bukan `this.db`) di dalam transaksi.
 */
export const txScope = new AsyncLocalStorage<{ inTx: true }>();
