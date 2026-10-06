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

/** Pembungkus fetch: menambah token, mengurai JSON, dan menerjemahkan error API. */
export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = tokenStore.get();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
  } catch {
    throw new ApiError(
      503,
      'Tidak bisa terhubung ke server SANSU. Periksa koneksi internet atau pastikan server SANSU berjalan',
    );
  }

  if (res.status === 401 && !path.startsWith('/auth/')) {
    tokenStore.clear();
    window.location.href = '/login';
  }

  const text = await res.text();
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
