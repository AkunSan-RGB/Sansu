import { decryptField, FIELD_TOKEN } from '../../common/utils/secret';

/** Pembentuk CSV untuk ekspor data: UTF-8 dengan BOM (terbuka benar di Excel), pemisah koma, baris CRLF */

/** Kolom bertipe teks yang awalnya = + - @ (atau tab/CR) diberi apostrof agar tidak dijalankan sebagai rumus di Excel/Sheets */
export function neutralizeFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function csvCell(v: unknown, isText = false): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else if (Buffer.isBuffer(v)) s = `\\x${v.toString('hex')}`;
  else if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  // kolom identitas terenkripsi di database: arsip ekspor milik klien memuat nilai aslinya (juga di dalam kolom jsonb)
  if (s.includes('enc1:')) s = s.replace(FIELD_TOKEN, (t) => { try { return decryptField(t) ?? ''; } catch { return t; } });
  if (isText) s = neutralizeFormula(s);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvRow = (cells: string[]) => `${cells.join(',')}\r\n`;

export const CSV_BOM = '﻿';
