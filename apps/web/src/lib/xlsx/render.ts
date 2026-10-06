/**
 * Mengubah SheetSpec menjadi file .xlsx rapi (ExcelJS): kop laporan, judul kolom berwarna,
 * format angka akuntansi, garis total, beku panel, siap cetak A4, dan rumus tetap hidup.
 */
import type { Borders, Cell, Fill, Font, Style, Workbook, Worksheet } from 'exceljs';
import { headerRowOf, isFormula, type Column, type Fmt, type Row, type SheetSpec, type Val } from './book';

const FONT = 'Arial';
const NAVY = 'FF1C3160';
const INK = 'FF101C33';
const MUTED = 'FF6B7280';
const LINE = 'FFD9DEE7';
const SOFT = 'FFEEF2FA';
const SOFT2 = 'FFF5F7FA';

export const NUMFMT: Record<Fmt, string | undefined> = {
  text: undefined,
  code: '@',
  money: '#,##0_);(#,##0);"-"_)',
  int: '#,##0_);(#,##0);"-"_)',
  dec: '#,##0.00_);(#,##0.00);"-"_)',
  pct: '0.00%',
  date: 'dd/mm/yyyy',
};
const isNumFmt = (f?: Fmt) => f === 'money' || f === 'int' || f === 'dec' || f === 'pct';

const fill = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const font = (o: Partial<Font> = {}): Partial<Font> => ({ name: FONT, size: 10, color: { argb: INK }, ...o });

/** Perkiraan lebar teks (karakter) untuk lebar kolom otomatis */
function textWidth(v: Val, fmt?: Fmt): number {
  if (v == null) return 0;
  if (v instanceof Date) return 11;
  const raw = typeof v === 'object' ? v.v : v;
  if (typeof raw === 'number') {
    if (fmt === 'pct') return 9;
    return Math.round(raw).toLocaleString('en-US').length + (raw < 0 ? 2 : 1) + (fmt === 'dec' ? 3 : 0);
  }
  return String(raw ?? '').length;
}

function autoWidths(s: SheetSpec): number[] {
  return s.columns.map((c, i) => {
    if (c.width) return c.width;
    let w = Math.max(...c.header.split(' ').map((p) => p.length), Math.min(c.header.length, 14));
    for (const r of s.rows) {
      if (r.style === 'note' || r.style === 'heading' || r.style === 'section') continue;
      w = Math.max(w, textWidth(r.values[i], c.fmt) + (i === 0 ? (r.indent ?? 0) * 2 : 0));
    }
    const max = isNumFmt(c.fmt) ? 22 : 48;
    return Math.min(max, Math.max(isNumFmt(c.fmt) ? 12 : 8, w + 2));
  });
}

function writeValue(cell: Cell, v: Val) {
  if (v == null || v === '') return;
  if (isFormula(v)) {
    cell.value = v.v == null || (typeof v.v === 'number' && !Number.isFinite(v.v)) ? { formula: v.f } : { formula: v.f, result: v.v as number | string };
    return;
  }
  cell.value = v as Cell['value'];
}

function styleFor(row: Row, col: Column, ci: number): Partial<Style> {
  const num = isNumFmt(col.fmt);
  const st: Partial<Style> = {
    font: font(),
    alignment: { vertical: 'middle', horizontal: num ? 'right' : col.fmt === 'date' || col.align === 'center' ? 'center' : 'left', indent: ci === 0 ? row.indent ?? 0 : 0 },
    numFmt: NUMFMT[col.fmt ?? 'text'],
  };
  const hair: Partial<Borders> = { bottom: { style: 'hair', color: { argb: LINE } } };
  switch (row.style) {
    case 'body':
      st.border = hair;
      break;
    case 'group':
      st.border = hair;
      break;
    case 'section':
      st.font = font({ bold: true, color: { argb: NAVY } });
      st.fill = fill(SOFT);
      break;
    case 'heading':
      st.font = font({ bold: true, size: 11, color: { argb: NAVY } });
      break;
    case 'subtotal':
      st.font = font({ bold: true });
      st.border = num ? { top: { style: 'thin', color: { argb: INK } }, bottom: { style: 'hair', color: { argb: LINE } } } : hair;
      break;
    case 'total':
      st.font = font({ bold: true });
      st.fill = fill(SOFT2);
      st.border = { top: { style: 'thin', color: { argb: INK } }, bottom: { style: 'thin', color: { argb: INK } } };
      break;
    case 'grand':
      st.font = font({ bold: true, color: { argb: NAVY } });
      st.fill = fill(SOFT);
      st.border = { top: { style: 'thin', color: { argb: INK } }, bottom: { style: 'double', color: { argb: INK } } };
      break;
    case 'check':
      st.font = font({ italic: true, size: 9, color: { argb: MUTED } });
      break;
    case 'note':
      st.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
      break;
  }
  return st;
}

function renderSheet(wb: Workbook, s: SheetSpec, printedAt: string) {
  const ncol = Math.max(1, s.columns.length);
  const headerRow = headerRowOf(s);
  const ws: Worksheet = wb.addWorksheet(s.name, {
    views: s.header ? [{ state: 'frozen', xSplit: s.freezeCols, ySplit: headerRow, showGridLines: false, zoomScale: 100 }] : [{ showGridLines: false, zoomScale: 100 }],
    pageSetup: {
      paperSize: 9,
      orientation: s.landscape ? 'landscape' : 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.55, bottom: 0.6, header: 0.25, footer: 0.3 },
      ...(s.header ? { printTitlesRow: `${headerRow - (s.groups?.length ? 1 : 0)}:${headerRow}` } : {}),
    },
    headerFooter: {
      oddFooter: `&L&"Arial,Italic"&8${(s.company ?? '').replace(/&/g, '&&')} · ${s.title.replace(/&/g, '&&')}&R&"Arial"&8Halaman &P dari &N`,
    },
  });
  ws.properties.defaultRowHeight = 16;
  autoWidths(s).forEach((w, i) => (ws.getColumn(i + 1).width = w));

  // ---- kop laporan ----
  let r = 1;
  const kop = (text: string, f: Partial<Font>, height?: number) => {
    const row = ws.getRow(r);
    const c = row.getCell(1);
    c.value = text;
    c.font = font(f);
    c.alignment = { vertical: 'middle', horizontal: 'left' };
    if (height) row.height = height;
    r++;
  };
  kop(s.company ?? '', { bold: true, size: 14, color: { argb: NAVY } }, 22);
  kop(s.title, { bold: true, size: 12 }, 18);
  for (const t of s.subtitle) kop(t, { size: 9, italic: true, color: { argb: MUTED } });
  // garis tipis pemisah kop
  for (let c = 1; c <= ncol; c++) ws.getRow(r - 1).getCell(c).border = { bottom: { style: 'thin', color: { argb: NAVY } } };
  r++; // baris kosong

  // ---- judul kolom ----
  const head = (cell: Cell, text: string) => {
    cell.value = text;
    cell.font = font({ bold: true, color: { argb: 'FFFFFFFF' } });
    cell.fill = fill(NAVY);
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { top: { style: 'thin', color: { argb: NAVY } }, left: { style: 'thin', color: { argb: 'FF3A4E7A' } }, right: { style: 'thin', color: { argb: 'FF3A4E7A' } }, bottom: { style: 'thin', color: { argb: NAVY } } };
  };
  if (!s.header) {
    // lembar naratif: tanpa judul kolom
  } else if (s.groups?.length) {
    const top = r;
    const bottom = r + 1;
    const grouped = new Set<number>();
    for (const g of s.groups) {
      const a = s.columns.findIndex((c) => c.key === g.from);
      const b = s.columns.findIndex((c) => c.key === g.to);
      for (let i = a; i <= b; i++) grouped.add(i);
      head(ws.getRow(top).getCell(a + 1), g.label);
      for (let i = a + 1; i <= b; i++) head(ws.getRow(top).getCell(i + 1), '');
      if (b > a) ws.mergeCells(top, a + 1, top, b + 1);
    }
    s.columns.forEach((c, i) => {
      if (grouped.has(i)) head(ws.getRow(bottom).getCell(i + 1), c.header);
      else {
        head(ws.getRow(top).getCell(i + 1), c.header);
        head(ws.getRow(bottom).getCell(i + 1), '');
        ws.mergeCells(top, i + 1, bottom, i + 1);
      }
    });
    ws.getRow(top).height = 20;
    ws.getRow(bottom).height = 20;
    r += 2;
  } else {
    s.columns.forEach((c, i) => head(ws.getRow(r).getCell(i + 1), c.header));
    ws.getRow(r).height = 30;
    r++;
  }

  // ---- isi ----
  let lastBody = headerRow;
  for (const row of s.rows) {
    const xr = ws.getRow(r);
    if (row.style === 'note' || row.style === 'heading' || (row.style === 'section' && row.values.length <= 1)) {
      const c = xr.getCell(1);
      writeValue(c, row.values[0]);
      c.style = styleFor(row, s.columns[0] ?? { key: '', header: '' }, 0) as Style;
      if (row.style === 'section') for (let i = 2; i <= ncol; i++) xr.getCell(i).fill = fill(SOFT);
      if (ncol > 1) ws.mergeCells(r, 1, r, ncol);
      if (row.style === 'note') {
        const chars = String(row.values[0] ?? '').length;
        const width = (ws.columns ?? []).reduce((a, col) => a + (col.width ?? 10), 0);
        xr.height = Math.max(16, Math.ceil(chars / Math.max(20, width * 1.1)) * 13 + 4);
      }
      if (row.style === 'heading') xr.height = 20;
    } else {
      s.columns.forEach((col, i) => {
        const c = xr.getCell(i + 1);
        writeValue(c, row.values[i]);
        c.style = styleFor(row, col, i) as Style;
      });
      if (row.style === 'body' || row.style === 'group') lastBody = r;
    }
    r++;
  }

  // sel kontrol: merah bila tidak nol, hijau bila nol
  for (const ref of s.checks) {
    ws.addConditionalFormatting({
      ref,
      rules: [
        { type: 'expression', formulae: [`ABS(${ref})>=0.005`], priority: 1, style: { font: { color: { argb: 'FFC00000' }, bold: true, italic: false } } },
        { type: 'expression', formulae: [`ABS(${ref})<0.005`], priority: 2, style: { font: { color: { argb: 'FF15803D' } } } },
      ],
    });
  }

  if (s.filter && lastBody > headerRow) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: lastBody, column: ncol } };

  // tanda dibuat oleh
  r++;
  const foot = ws.getRow(r).getCell(1);
  foot.value = `Dibuat dari SANSU · ${printedAt}`;
  foot.font = font({ size: 8, italic: true, color: { argb: MUTED } });
}

/** Buat workbook (biner .xlsx) dari daftar lembar */
export async function buildXlsx(sheets: SheetSpec[], opts: { ExcelJS: typeof import('exceljs'); JSZip?: typeof import('jszip'); now?: Date }): Promise<Uint8Array> {
  const wb = new opts.ExcelJS.Workbook();
  const now = opts.now ?? new Date();
  wb.creator = 'SANSU';
  wb.lastModifiedBy = 'SANSU';
  wb.created = now;
  wb.modified = now;
  wb.calcProperties = { fullCalcOnLoad: true };
  const pad = (x: number) => String(x).padStart(2, '0');
  const printedAt = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const used = new Set<string>();
  for (const s of sheets) {
    // nama lembar harus unik
    let name = s.name;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${s.name.slice(0, 28)} ${i}`;
    used.add(name.toLowerCase());
    renderSheet(wb, { ...s, name }, printedAt);
  }
  const buf = new Uint8Array(await wb.xlsx.writeBuffer());
  return opts.JSZip ? silenceTextNumbers(buf, opts.JSZip) : buf;
}

/**
 * Kode akun, NPWP, NIK, no. rekening sengaja disimpan sebagai teks. Matikan segitiga hijau
 * "Number stored as text" supaya lembar tetap bersih.
 */
async function silenceTextNumbers(buf: Uint8Array, JSZip: typeof import('jszip')): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(buf);
  const files = Object.keys(zip.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f));
  for (const f of files) {
    const xml = await zip.file(f)!.async('string');
    if (xml.includes('<ignoredErrors')) continue;
    const tag = '<ignoredErrors><ignoredError sqref="A1:XFD1048576" numberStoredAsText="1"/></ignoredErrors>';
    const at = ['<drawing', '<legacyDrawing', '<picture', '<oleObjects', '<controls', '<webPublishItems', '<tableParts', '<extLst', '</worksheet>'].map((t) => xml.indexOf(t)).filter((i) => i >= 0);
    const pos = Math.min(...at);
    zip.file(f, xml.slice(0, pos) + tag + xml.slice(pos));
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
