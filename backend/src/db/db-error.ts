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
  // di produksi (Railway dll.) pengaturan datang dari variabel layanan, bukan berkas .env
  const lines = [`Database yang dituju : ${target}`];
  if (process.env.NODE_ENV !== 'production') lines.push(`Berkas .env yang dibaca: ${envFile} (${existsSync(envFile) ? 'ada' : 'TIDAK ADA'})`);

  let cause: string;
  if (!url) {
    cause = 'DATABASE_URL belum diisi. Isi variabel DATABASE_URL (di backend\\.env saat lokal, atau di Variables layanan hosting).';
  } else if (code === '28P01' || /password authentication failed/i.test(msg)) {
    cause = 'Password atau nama pengguna database salah. Salin ulang connection string terbaru dari Neon (setelah Reset password) ke DATABASE_URL.';
  } else if (err?.hostname === 'base' || /hostname.*base/i.test(msg)) {
    cause = 'DATABASE_URL di Variables bukan alamat PostgreSQL yang valid (pustaka memakai host cadangan "base"). Salin ulang dari Neon › Connect, dimulai dari postgresql:// — tanpa tanda kutip atau spasi.';
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

/**
 * Rapikan DATABASE_URL dari salah ketik yang umum (spasi, tanda kutip, awalan "DATABASE_URL=") dan tolak bila
 * bukan alamat PostgreSQL. Tanpa ini pustaka koneksi diam-diam memakai host cadangan "base" (galat ENOTFOUND yang membingungkan).
 * Tidak pernah memuat isi alamat ke dalam pesan galat (ada password).
 */
export function cleanDbUrl(raw: string): string {
  let u = raw.trim();
  u = u.replace(/^DATABASE_URL\s*=\s*/i, '').trim();
  u = u.replace(/^(["'`])(.*)\1$/s, '$2').trim();
  if (/\$\{\{.*\}\}/.test(u)) {
    throw new Error('DATABASE_URL masih berisi referensi variabel yang belum terisi (${{...}}). Pastikan nama layanan pada referensi benar, atau tempel alamat database langsung.');
  }
  if (!/^postgres(ql)?:\/\/[^\s/]+/i.test(u)) {
    throw new Error('DATABASE_URL tidak valid: harus diawali postgresql:// lalu pengguna:password@host/namadb (tanpa tanda kutip, spasi, atau teks lain). Salin ulang dari Neon › Connect.');
  }
  return u;
}
