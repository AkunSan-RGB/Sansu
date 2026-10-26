/** Tipe dan pembantu kecil yang dipakai bersama oleh seluruh laporan pendukung (tanpa dependensi ke service) */
export type Cell = string | number | null;
export interface SupportTable {
  title?: string;
  columns: string[];
  align: ('left' | 'right')[];
  rows: Cell[][];
  total?: Cell[];
}
export interface SupportSection {
  key: string;
  number: string;
  title: string;
  paragraphs: string[];
  tables: SupportTable[];
}
export interface Reconciliation {
  key: string;
  title: string;
  left: { label: string; value: number };
  right: { label: string; value: number };
  diff: number;
  ok: boolean;
  note?: string;
}
export const SUPPORT_KINDS = [
  'sales',
  'purchases',
  'inventory',
  'cash',
  'pos',
  'fnb',
  'fmcg',
  'mfg',
  'jasa',
  'utility',
] as const;
export type SupportKind = (typeof SUPPORT_KINDS)[number];

export const L = 'left' as const;
export const R = 'right' as const;
export const num = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;
export const sum = (rows: Cell[][], i: number) => rows.reduce((a, r) => a + Number(r[i] ?? 0), 0);
export const TOLERANCE = 1;
/** Batas baris per tabel; tabel yang mencapai batas diberi catatan agar tidak terbaca lengkap */
export const CAP = 2000;
/** Baris di luar N teratas digabung menjadi satu baris "Lainnya" sehingga jumlah tabel tetap lengkap */
export const withRest = (rows: Cell[][], n: number, sumIdx: number[]): Cell[][] => {
  if (rows.length <= n) return rows;
  const rest = rows.slice(n);
  const row: Cell[] = Array(rows[0].length).fill(null);
  row[0] = `Lainnya (${rest.length})`;
  for (const i of sumIdx) row[i] = Math.round(sum(rest, i) * 100) / 100;
  return [...rows.slice(0, n), row];
};
