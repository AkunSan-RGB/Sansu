/**
 * Ekspor lembar laporan ke CSV (teks polos, bisa dibuka di Excel, Google Sheets, atau diolah program lain).
 * Dua varian: titik koma + koma desimal (dibaca benar oleh Excel berbahasa Indonesia saat diklik dua kali) dan koma + titik desimal (standar).
 * Hanya judul kolom dan baris isi; kop (perusahaan, periode) ada di nama berkas dan judul bagian bila lembar lebih dari satu.
 */
import { isFormula, type Column, type SheetSpec, type Val } from './book';

export interface CsvOptions {
  delimiter: ';' | ',';
  decimal: ',' | '.';
}
export const CSV_ID: CsvOptions = { delimiter: ';', decimal: ',' };
export const CSV_STANDARD: CsvOptions = { delimiter: ',', decimal: '.' };

const pad2 = (n: number) => String(n).padStart(2, '0');

function num(v: number, col: Column | undefined, o: CsvOptions) {
  if (!Number.isFinite(v)) return '';
  const s = col?.fmt === 'money' ? v.toFixed(2) : col?.fmt === 'int' ? String(Math.round(v)) : String(Math.round(v * 1e6) / 1e6);
  return o.decimal === ',' ? s.replace('.', ',') : s;
}

/** Teks aman untuk CSV: tanda kutip bila perlu, dan awalan rumus (= + @ -) dinetralkan agar tidak dijalankan Excel */
function text(s: string, o: CsvOptions) {
  let t = s.replace(/\r?\n/g, ' ');
  if (/^[=+@]/.test(t) || (/^-/.test(t) && !/^-?[\d.,]+$/.test(t))) t = `'${t}`;
  return /[";,\r\n]/.test(t) || t !== t.trim() || t.includes(o.delimiter) ? `"${t.replace(/"/g, '""')}"` : t;
}

function cell(v: Val, col: Column | undefined, o: CsvOptions): string {
  const x = isFormula(v) ? (v.v ?? '') : v;
  if (x == null || x === '') return '';
  if (x instanceof Date) return `${x.getUTCFullYear()}-${pad2(x.getUTCMonth() + 1)}-${pad2(x.getUTCDate())}`;
  if (typeof x === 'number') return num(x, col, o);
  return text(String(x), o);
}

export function sheetsToCsv(sheets: SheetSpec[], o: CsvOptions = CSV_ID): string {
  const lines: string[] = [];
  sheets.forEach((s, si) => {
    if (si > 0) lines.push('');
    if (sheets.length > 1) lines.push(text(s.title, o));
    if (s.header) lines.push(s.columns.map((c) => text(c.header, o)).join(o.delimiter));
    for (const r of s.rows) lines.push(s.columns.map((c, i) => cell(r.values[i], c, o)).join(o.delimiter));
  });
  // BOM agar Excel membaca UTF-8 (huruf berakson tidak rusak)
  return `﻿${lines.join('\r\n')}\r\n`;
}
