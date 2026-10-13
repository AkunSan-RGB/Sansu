/**
 * Mengingat halaman yang dituju sebelum sesi habis / belum masuk, agar setelah login pengguna kembali ke sana.
 * Hanya jalur internal yang diterima (mencegah pengalihan terbuka ke situs lain).
 */
const KEY = 'sansu.returnTo';

export function safeReturnPath(p: string | null | undefined): string | undefined {
  if (!p || typeof p !== 'string') return undefined;
  if (!p.startsWith('/') || p.startsWith('//') || p.includes('\\')) return undefined;
  if (/^\/(login|forgot-password|reset-password|verify-email)(\/|\?|$)/.test(p)) return undefined;
  return p.length > 500 ? undefined : p;
}

export function rememberReturnTo(path: string) {
  const ok = safeReturnPath(path);
  try {
    if (ok) sessionStorage.setItem(KEY, ok);
  } catch {
    /* penyimpanan sesi tidak tersedia */
  }
}

/** Baca tujuan yang diingat tanpa menghapusnya (aman dipanggil saat render); kosong bila tidak ada. */
export function peekReturnTo(): string | undefined {
  try {
    return safeReturnPath(sessionStorage.getItem(KEY));
  } catch {
    return undefined;
  }
}

export function clearReturnTo() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* penyimpanan sesi tidak tersedia */
  }
}
