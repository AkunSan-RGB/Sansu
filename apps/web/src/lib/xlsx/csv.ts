/**
 * Ekspor lembar laporan ke CSV (teks polos, bisa dibuka di Excel, Google Sheets, atau diolah program lain).
 * Dua varian: titik koma + koma desimal (dibaca benar oleh Excel berbahasa Indonesia saat diklik dua kali) dan koma + titik desimal (standar).
 * Rapi: kop (perusahaan, judul, periode), judul kolom, baris pemisah/kolom kosong dibuang, hierarki lewat indentasi.
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
  const join = (a: string[]) => a.join(o.delimiter);
  sheets.forEach((s, si) => {
    if (si > 0) lines.push('', '');
    // Kop: perusahaan, judul, periode — supaya berkas berdiri sendiri
    for (const t of [s.company, s.title, ...s.subtitle]) if (t) lines.push(text(t, o));
    if (lines.length && lines[lines.length - 1] !== '' ) lines.push('');
    // Baris pemisah kosong dibuang; kolom yang kosong di seluruh baris (mis. Catatan) disembunyikan
    const rows = s.rows.filter((r) => r.values.some((v) => (isFormula(v) ? v.v : v) != null && (isFormula(v) ? v.v : v) !== ''));
    const keep = s.columns.map((_, i) => i === 0 || rows.some((r) => { const v = r.values[i]; const x = isFormula(v) ? v.v : v; return x != null && x !== ''; }));
    const cols = s.columns.map((c, i) => ({ c, i })).filter((x) => keep[x.i]);
    if (s.header) lines.push(join(cols.map(({ c, i }) => text(i === 0 && c.header === 'Pos' ? 'Uraian' : c.header, o))));
    for (const r of rows) {
      lines.push(join(cols.map(({ c, i }) => {
        const out = cell(r.values[i], c, o);
        // Hierarki laporan dipertahankan lewat spasi di depan uraian
        if (i === 0 && r.indent && out) return `"${' '.repeat(r.indent * 2)}${out.replace(/^"|"$/g, '').replace(/""/g, '"').replace(/"/g, '""')}"`;
        return out;
      })));
    }
  });
  // BOM agar Excel membaca UTF-8 (huruf berakson tidak rusak)
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
