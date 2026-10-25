import { rememberReturnTo } from '@/auth/returnTo';

const TOKEN_KEY = 'sansu.token';

// sesi dari versi sebelum ganti nama (Akurata) dipindahkan sekali agar pengguna tidak perlu login ulang
const LEGACY_KEY = 'akurata.token';
try {
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy && !localStorage.getItem(TOKEN_KEY)) localStorage.setItem(TOKEN_KEY, legacy);
  localStorage.removeItem(LEGACY_KEY);
} catch {
  /* penyimpanan browser tidak tersedia */
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** isi lengkap jawaban error dari server (mis. hasil periksa baris impor) */
    public data?: unknown,
  ) {
    super(message);
  }
}

/** Batas tunggu satu permintaan: jaringan yang menggantung tidak membuat layar menunggu selamanya */
export const REQUEST_TIMEOUT_MS = 45_000;
/** Unggah/ekspor besar boleh lebih lama */
const LONG_TIMEOUT_MS = 180_000;

/**
 * Kunci idempotensi untuk permintaan yang mengubah data. Kunci dibuat per (metode, alamat, isi) dan DIPAKAI ULANG bila
 * permintaan sebelumnya berakhir tanpa jawaban (jaringan putus/waktu habis) sehingga pengiriman ulang tidak menggandakan transaksi
 * bila ternyata yang pertama sudah diproses server. Begitu server menjawab (berhasil atau ditolak), kunci dibuang.
 */
const pendingKeys = new Map<string, { key: string; at: number }>();
const KEY_TTL_MS = 10 * 60_000;
function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
export function idempotencyKeyFor(method: string, path: string, body: string | undefined, now = Date.now()): { id: string; key: string } {
  for (const [k, v] of pendingKeys) if (now - v.at > KEY_TTL_MS) pendingKeys.delete(k);
  const id = `${method} ${path} ${body ?? ''}`;
  const hit = pendingKeys.get(id);
  if (hit) return { id, key: hit.key };
  const key = newKey();
  pendingKeys.set(id, { key, at: now });
  return { id, key };
}
export const forgetIdempotencyKey = (id: string) => pendingKeys.delete(id);

/** Pembungkus fetch: menambah token, mengurai JSON, dan menerjemahkan error API. */
export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = tokenStore.get();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');

  const method = (init.method ?? 'GET').toUpperCase();
  const body = init.json !== undefined ? JSON.stringify(init.json) : init.body;
  let idem: { id: string; key: string } | undefined;
  if (method !== 'GET' && method !== 'HEAD' && !headers.has('Idempotency-Key') && !path.startsWith('/auth/') && (body === undefined || typeof body === 'string')) {
    idem = idempotencyKeyFor(method, path, body as string | undefined);
    headers.set('Idempotency-Key', idem.key);
  }

  let res: Response;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? (/(import|export|upload|backup)/i.test(path) ? LONG_TIMEOUT_MS : REQUEST_TIMEOUT_MS));
  try {
    res = await fetch(`/api${path}`, { ...init, headers, body, signal: init.signal ?? ctrl.signal });
  } catch (e) {
    // kunci sengaja DIPERTAHANKAN: kita tidak tahu apakah server sempat memproses permintaan ini
    if ((e as { name?: string }).name === 'AbortError') {
      throw new ApiError(
        504,
        method === 'GET'
          ? 'Server terlalu lama menjawab. Periksa koneksi internet lalu coba lagi.'
          : 'Server terlalu lama menjawab. Transaksi ini MUNGKIN sudah tersimpan: periksa daftarnya dulu; bila belum ada, kirim ulang (tidak akan tercatat dobel).',
      );
    }
    throw new ApiError(
      503,
      method === 'GET' || method === 'HEAD'
        ? 'Tidak bisa terhubung ke server SANSU. Periksa koneksi internet atau pastikan server SANSU berjalan'
        : 'Tidak bisa terhubung ke server SANSU. Transaksi ini MUNGKIN sudah tersimpan: periksa daftarnya dulu; bila belum ada, kirim ulang (tidak akan tercatat dobel).',
    );
  } finally {
    clearTimeout(timer);
  }
  if (idem) forgetIdempotencyKey(idem.id); // server menjawab: kunci selesai dipakai

  if (res.status === 401 && !path.startsWith('/auth/')) {
    tokenStore.clear();
    rememberReturnTo(window.location.pathname + window.location.search);
    window.location.href = '/login';
  }

  const text = await res.text();
  // Yang terbaca halaman web (HTML), bukan data: alamat ini belum tersambung ke server API (mis. hosting tampilan saja)
  if (/^\s*</.test(text)) {
    throw new ApiError(
      503,
      'Alamat ini belum tersambung ke server API SANSU (yang terbaca halaman web, bukan data). Hubungi pengelola untuk mengisi alamat API.',
    );
  }
  let data: { message?: string | string[] } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Bukan JSON: biasanya server belum menyala (proxy) atau sedang memulai ulang
    if (!res.ok) throw new ApiError(503, 'Server SANSU belum siap. Tunggu sebentar, data akan dimuat otomatis');
    throw new ApiError(500, 'Jawaban server tidak dikenali');
  }
  if (!res.ok) {
    if (res.status === 404 && typeof data?.message === 'string' && data.message.startsWith('Cannot ')) {
      throw new ApiError(
        404,
        'Fitur ini belum ada di server yang sedang berjalan (server versi lama). Tutup semua jendela SANSU lalu jalankan ulang',
      );
    }
    if (res.status === 429 && typeof data?.message === 'string' && /^Throttler/i.test(data.message)) {
      throw new ApiError(429, 'Terlalu banyak permintaan dalam waktu singkat. Tunggu sebentar lalu coba lagi.');
    }
    if (res.status >= 500)
      throw new ApiError(
        res.status,
        `Terjadi kesalahan di server (${res.status}). ${typeof data?.message === 'string' && data.message !== 'Internal server error' ? data.message : 'Coba lagi; bila berulang, kirim tangkapan layar ini'}`,
      );
    if (
      res.status === 403 &&
      (data as { code?: string } | null)?.code === 'TWO_FACTOR_SETUP_REQUIRED' &&
      window.location.pathname !== '/account/security'
    ) {
      window.location.href = '/account/security';
    }
    const msg = Array.isArray(data?.message) ? data.message.join('; ') : (data?.message ?? res.statusText);
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, json: unknown = {}) => api<T>(path, { method: 'POST', json });
export const patch = <T>(path: string, json: unknown) => api<T>(path, { method: 'PATCH', json });
export const put = <T>(path: string, json: unknown) => api<T>(path, { method: 'PUT', json });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

/** Bangun query string, abaikan nilai kosong */
export const qs = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v && p.set(k, v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** Unduh file dari API (mis. XML Coretax) dengan token */
export async function download(path: string, filename: string) {
  const token = tokenStore.get();
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const t = await res.text();
    let msg = res.statusText;
    try {
      msg = JSON.parse(t).message ?? msg;
    } catch {
      /* bukan JSON */
    }
    throw new ApiError(res.status, msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
