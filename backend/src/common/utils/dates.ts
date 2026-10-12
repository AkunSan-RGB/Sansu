import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Tanggal dokumen disimpan sebagai DATE dan ditangani sebagai string 'YYYY-MM-DD'
 * agar tidak pernah bergeser karena zona waktu.
 */
export type DocDate = string;

/**
 * Jam simulasi — hanya dipakai pembuat data demo untuk "memutar mundur" tanggal hari ini
 * (mis. transaksi kasir 15 Maret). Di aplikasi normal selalu kosong.
 */
const simulatedDay = new AsyncLocalStorage<DocDate>();
export const withSimulatedDay = <T>(day: DocDate, fn: () => Promise<T>) => simulatedDay.run(day, fn);

/** Hari ini menurut zona waktu Asia/Jakarta (WIB). */
export function todayJakarta(): DocDate {
  return simulatedDay.getStore() ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

/** Waktu sekarang (atau jam kerja pada hari simulasi) */
export function nowAt(hour = 10, minute = 0): Date {
  const d = simulatedDay.getStore();
  if (!d) return new Date();
  return new Date(`${d}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+07:00`);
}

/** Input 'YYYY-MM-DD' (atau ISO) → 'YYYY-MM-DD'; kosong = hari ini (WIB). */
export function toDocDate(input?: string): DocDate {
  if (!input) return todayJakarta();
  const s = input.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Tanggal tidak valid: ${input}`);
  return s;
}

/** 'YYYY-MM-DD' yang benar-benar ada di kalender (menolak 2026-13-45 dan 2026-02-30) */
export function isDocDate(s: unknown): s is DocDate {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDays(date: DocDate, days: number): DocDate {
  const [y, m, d] = date.split('-').map(Number);
  const r = new Date(Date.UTC(y, m - 1, d + days));
  return r.toISOString().slice(0, 10);
}

/** Selisih hari (b - a) */
export function diffDays(a: DocDate, b: DocDate): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** Periode penomoran dokumen: '2026/10' */
export function period(date: DocDate): string {
  return `${date.slice(0, 4)}/${date.slice(5, 7)}`;
}

export function monthStart(date: DocDate): DocDate {
  return `${date.slice(0, 7)}-01`;
}
