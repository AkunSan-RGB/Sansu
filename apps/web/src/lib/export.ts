/** Ekspor laporan ke Excel (.xlsx) dan cetak / simpan PDF lewat dialog cetak browser. */

import type { SheetSpec } from './xlsx/book';

export type { SheetSpec } from './xlsx/book';
export { SheetBuilder } from './xlsx/book';

/** Angka uang dari API (string) → number */
export const num = (v: string | number | null | undefined) => (v == null || v === '' ? null : Number(v));

/** Unduh laporan sebagai .xlsx yang rapi dan tetap berumus */
export async function exportExcel(filename: string, sheets: SheetSpec[]) {
  // dimuat saat dibutuhkan saja supaya halaman lain tetap ringan
  const [{ buildXlsx }, ExcelJS, JSZip] = await Promise.all([import('./xlsx/render'), import('exceljs'), import('jszip')]);
  const bytes = await buildXlsx(sheets, { ExcelJS: (ExcelJS as unknown as { default?: typeof ExcelJS }).default ?? ExcelJS, JSZip: (JSZip as unknown as { default: typeof import('jszip') }).default ?? JSZip });
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

/** Cetak area laporan saja (elemen dengan class .print-area); pilih "Simpan sebagai PDF" di dialog cetak. */
export function printReport(title: string) {
  const prev = document.title;
  document.title = title;
  document.body.classList.add('printing-report');
  window.print();
  document.body.classList.remove('printing-report');
  document.title = prev;
}
