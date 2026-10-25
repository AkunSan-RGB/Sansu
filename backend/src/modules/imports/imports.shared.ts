import { type Tx } from '../../db/db';
import { type Dec } from '../../common/utils/money';
import { date, num, text } from './parse';

export type Row = Record<string, unknown>;

export interface RowResult {
  row: number; // nomor baris di Excel (baris 2 = data pertama)
  key: string;
  action: 'CREATE' | 'UPDATE' | 'ERROR';
  errors: string[];
  warnings: string[];
}

export type Plan = { results: RowResult[]; write: (tx: Tx) => Promise<void> };

export const MAX = { code: 30, sku: 40, name: 160, uom: 10 };

export const upper = (s?: string) => s?.toUpperCase();

export const rp = (d: Dec) => 'Rp ' + Number(d.toFixed(0)).toLocaleString('id-ID');

export function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Pemeriksa satu baris: kumpulkan error/peringatan, kembalikan hasil */
export function rowChecker(results: RowResult[], i: number, key: string) {
  const r: RowResult = { row: i + 2, key, action: 'CREATE', errors: [], warnings: [] };
  results.push(r);
  const req = (v: unknown, label: string) => {
    const t = text(v);
    if (!t) r.errors.push(`${label} wajib diisi`);
    return t;
  };
  const max = (v: string | undefined, n: number, label: string) => {
    if (v && v.length > n) r.errors.push(`${label} maksimal ${n} karakter`);
    return v;
  };
  const amount = (v: unknown, label: string, opt: { required?: boolean; min?: number; positive?: boolean } = {}) => {
    const n = num(v);
    if (n === 'invalid') {
      r.errors.push(`${label} bukan angka: "${String(v)}"`);
      return undefined;
    }
    if (n === null) {
      if (opt.required) r.errors.push(`${label} wajib diisi`);
      return undefined;
    }
    if (opt.positive && !n.gt(0)) r.errors.push(`${label} harus lebih dari 0`);
    else if (opt.min !== undefined && n.lt(opt.min)) r.errors.push(`${label} tidak boleh negatif`);
    if (n.decimalPlaces() > 4) r.errors.push(`${label} terlalu banyak desimal`);
    return n;
  };
  const day = (v: unknown, label: string, required = false) => {
    const d = date(v);
    if (d === 'invalid') {
      r.errors.push(`${label} tidak dikenali: "${String(v)}" (pakai format 31/12/2025)`);
      return undefined;
    }
    if (d === null && required) r.errors.push(`${label} wajib diisi`);
    return d ?? undefined;
  };
  return { r, req, max, amount, day };
}
