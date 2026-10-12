import { existsSync } from 'fs';
import { resolve } from 'path';

/** Alamat database tanpa nama pengguna & password, aman ditampilkan di layar. */
export function safeDbTarget(url?: string): string {
  if (!url) return '(DATABASE_URL kosong)';
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname}`;
  } catch {
    return '(DATABASE_URL tidak valid: bentuknya harus postgresql://pengguna:password@host/namadb)';
  }
}

/** Ubah galat koneksi/migrasi PostgreSQL menjadi penjelasan singkat berbahasa Indonesia. */
export function describeDbError(e: unknown, url = process.env.DATABASE_URL): string {
  const err = e as { code?: string; message?: string; hostname?: string };
  const msg = String(err?.message ?? e);
  const code = err?.code;
  const target = safeDbTarget(url);
  const envFile = resolve(process.cwd(), '.env');
  const lines = [`Database yang dituju : ${target}`, `Berkas .env yang dibaca: ${envFile} (${existsSync(envFile) ? 'ada' : 'TIDAK ADA'})`];

  let cause: string;
  if (!url) {
    cause = 'DATABASE_URL belum diisi. Isi di backend\\.env (salin dari backend\\.env.example).';
  } else if (code === '28P01' || /password authentication failed/i.test(msg)) {
    cause = 'Password atau nama pengguna database salah. Salin ulang connection string terbaru dari Neon (setelah Reset password) ke DATABASE_URL.';
  } else if (code === 'ENOTFOUND' || /getaddrinfo/i.test(msg)) {
    cause = 'Alamat (host) database tidak ditemukan. Periksa penulisan DATABASE_URL dan koneksi internet.';
  } else if (code === 'ECONNREFUSED') {
    cause = 'Database tidak menerima koneksi. Jika memakai database lokal, nyalakan Docker lalu `npm run db:up`; jika memakai Neon, DATABASE_URL masih menunjuk ke localhost.';
  } else if (code === 'ETIMEDOUT' || /timeout/i.test(msg)) {
    cause = 'Koneksi ke database kehabisan waktu. Periksa internet/VPN/firewall.';
  } else if (code === '3D000' || /database .* does not exist/i.test(msg)) {
    cause = 'Nama database di akhir DATABASE_URL tidak ada.';
  } else if (/ssl|tls|insecure/i.test(msg)) {
    cause = 'Database mewajibkan SSL. Tambahkan ?sslmode=require di akhir DATABASE_URL.';
  } else if (!msg && !code) {
    cause = 'Galat tidak diketahui; lihat rincian di atasnya.';
  } else {
    cause = `Galat database${code ? ' ' + code : ''}: ${msg}`;
  }
  return [...lines, `Penyebab              : ${cause}`].join('\n');
}
