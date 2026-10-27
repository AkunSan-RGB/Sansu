/** Ekspor laporan ke Excel (.xlsx) dan cetak / simpan PDF lewat dialog cetak browser. */

import type { SheetSpec } from './xlsx/book';
import { sheetsToCsv, type CsvOptions } from './xlsx/csv';

export type { SheetSpec } from './xlsx/book';
export { SheetBuilder } from './xlsx/book';

/** Angka uang dari API (string) → number */
export const num = (v: string | number | null | undefined) => (v == null || v === '' ? null : Number(v));

/** Modul CommonJS yang dimuat dinamis kadang membungkus ekspornya di `.default`; ambil yang sebenarnya (satu-satunya titik tipe dilonggarkan) */
const interop = <T>(m: unknown): T => ((m as { default?: unknown }).default ?? m) as T;

/** Unduh laporan sebagai .xlsx yang rapi dan tetap berumus */
export async function exportExcel(filename: string, sheets: SheetSpec[]) {
  // dimuat saat dibutuhkan saja supaya halaman lain tetap ringan
  const [{ buildXlsx }, ExcelJS, JSZip] = await Promise.all([import('./xlsx/render'), import('exceljs'), import('jszip')]);
  const bytes = await buildXlsx(sheets, { ExcelJS: interop<typeof ExcelJS>(ExcelJS), JSZip: interop<typeof import('jszip')>(JSZip) });
  const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`).replace(/[\\/:*?"<>|]+/g, '-');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Unduh laporan sebagai CSV (teks polos) */
export function exportCsv(filename: string, sheets: SheetSpec[], options: CsvOptions) {
  const blob = new Blob([sheetsToCsv(sheets, options)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (filename.endsWith('.csv') ? filename : `${filename}.csv`).replace(/[\\/:*?"<>|]+/g, '-');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Cetak area laporan saja (elemen dengan class .print-area); pilih "Simpan sebagai PDF" di dialog cetak. */
export function printReport(title: string) {
  const prev = document.title;
  document.title = title;
  document.body.classList.add('printing-report');
  window.print();
  document.body.classList.remove('printing-report');
  document.title = prev;
}
