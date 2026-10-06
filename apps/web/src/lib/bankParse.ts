/**
 * Membaca file mutasi rekening dari internet banking (CSV / Excel) apa pun formatnya:
 * kolom ditebak otomatis (Tanggal, Keterangan, Debet/Kredit atau Mutasi + DB/CR, Saldo) dan bisa diubah pengguna.
 */
export type Grid = (string | number | null)[][];

export interface ColumnMap {
  date?: number;
  description?: number;
  /** Kolom keterangan kedua (mis. Mandiri MCM punya dua kolom "Description") — digabung */
  description2?: number;
  /** Uang keluar (debet rekening koran) */
  debit?: number;
  /** Uang masuk (kredit rekening koran) */
  credit?: number;
  /** Satu kolom nilai bertanda, atau dengan akhiran DB/CR */
  amount?: number;
  /** Kolom penanda DB/CR terpisah */
  dc?: number;
  balance?: number;
}

export interface ParsedLine {
  date: string;
  description: string;
  amount: string;
  balance?: string;
}

export async function readGrid(file: File): Promise<Grid> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: false, raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
}

/** Rapikan judul kolom: huruf kecil, "_" jadi spasi, buang "(IDR)" dsb. */
const norm = (v: unknown) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Baris judul = baris pertama yang memuat kata "tanggal"/"date" dan "keterangan"/"description" atau kolom nilai */
export function findHeader(grid: Grid): number {
  for (let i = 0; i < Math.min(grid.length, 40); i++) {
    const cells = grid[i].map(norm);
    const hasDate = cells.some((c) => /^(tanggal|tgl|date|post date|posting date|trx date|transaction date)/.test(c));
    const hasOther = cells.some((c) => /(keterangan|uraian|deskripsi|description|remark|desk|mutasi|debet|debit|kredit|credit|jumlah|amount|nominal|dana)/.test(c));
    if (hasDate && hasOther) return i;
  }
  return 0;
}

export function guessColumns(header: (string | number | null)[]): ColumnMap {
  const h = header.map(norm);
  const find = (re: RegExp, exclude?: RegExp) => {
    const i = h.findIndex((c) => re.test(c) && !(exclude && exclude.test(c)));
    return i >= 0 ? i : undefined;
  };
  const map: ColumnMap = {
    date: find(/^(tanggal|tgl|date|post date|posting date|trx date|transaction date)/),
    description: find(/(keterangan|uraian|deskripsi|description|remark|transaksi|desk|berita|narasi)/, /(tanggal|tgl|date|code|kode)/),
    debit: find(/^(debet|debit|db|dr|mutasi debet|mutasi debit|uang keluar|dana keluar|withdrawal|pengeluaran|keluar)$/),
    credit: find(/^(kredit|credit|cr|mutasi kredit|uang masuk|dana masuk|deposit|pemasukan|masuk)$/),
    balance: find(/(saldo|balance)/),
  };
  if (map.description !== undefined) {
    const second = h.findIndex((c, i) => i > map.description! && /(keterangan|uraian|deskripsi|description|remark|berita)/.test(c) && !/(tanggal|tgl|date|code|kode)/.test(c));
    if (second >= 0) map.description2 = second;
  }
  if (map.debit === undefined && map.credit === undefined) {
    map.amount = find(/(jumlah|mutasi|amount|nominal|nilai)/, /saldo/);
    map.dc = find(/^(db\/cr|d\/k|dk|cr\/db|d\/c|dc|db cr|jenis|type|tipe)$/);
  }
  return map;
}

/** "1.500.000,00" · "1,500,000.00" · "1500000" · "(15.000)" · "15.000,00 DB" → angka bertanda */
export function parseAmount(v: unknown): { value: number; dc?: 'DB' | 'CR' } | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return { value: v };
  let s = String(v).trim().toUpperCase();
  let dc: 'DB' | 'CR' | undefined;
  const m = s.match(/\b(DB|CR|D|K|DR)\s*$/);
  if (m) {
    dc = m[1] === 'CR' || m[1] === 'K' ? 'CR' : 'DB';
    s = s.slice(0, m.index).trim();
  }
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    neg = true;
    s = s.slice(1);
  }
  s = s.replace(/RP|IDR|\s/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    s = dec === '.' ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
  } else if (lastComma >= 0) {
    // "1,500,000" (ribuan) vs "1500,50" (desimal)
    s = /,\d{3}(,|$)/.test(s) && s.split(',').slice(1).every((p) => p.length === 3) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot >= 0) {
    s = /\.\d{3}(\.|$)/.test(s) && s.split('.').slice(1).every((p) => p.length === 3) ? s.replace(/\./g, '') : s;
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return { value: neg ? -n : n, dc };
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MEI: 5, MAY: 5, JUN: 6, JUL: 7, AGU: 8, AGS: 8, AUG: 8, SEP: 9, OKT: 10, OCT: 10, NOV: 11, DES: 12, DEC: 12,
};

/** Tanggal dari banyak format; tahun kosong (mis. BCA "03/09") memakai `year` */
export function parseDate(v: unknown, year: number): string | null {
  if (v === null || v === undefined || v === '') return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (typeof v === 'number') {
    // nomor seri tanggal Excel
    if (v > 20000 && v < 80000) {
      const d = new Date(Math.round((v - 25569) * 86400000));
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    return null;
  }
  const s = String(v).trim().replace(/^'/, '');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : year;
    return `${y}-${pad(+m[2])}-${pad(+m[1])}`;
  }
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2,4})/);
  if (m && MONTHS[m[2].toUpperCase()]) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${y}-${pad(MONTHS[m[2].toUpperCase()])}-${pad(+m[1])}`;
  }
  return null;
}

export function toLines(grid: Grid, headerRow: number, map: ColumnMap, year: number): { lines: ParsedLine[]; skipped: number; pending: number } {
  const lines: ParsedLine[] = [];
  let skipped = 0;
  let pending = 0;
  // Kolom DB/CR tanpa judul (mis. BCA) biasanya tepat di sebelah kolom mutasi
  if (map.amount !== undefined && map.dc === undefined) {
    const next = map.amount + 1;
    const sample = grid.slice(headerRow + 1, headerRow + 30).map((r) => norm(r[next]).toUpperCase());
    if (sample.some((v) => /^(DB|CR)$/.test(v))) map = { ...map, dc: next };
  }
  for (const row of grid.slice(headerRow + 1)) {
    if (map.date === undefined) break;
    const date = parseDate(row[map.date], year);
    if (!date) {
      const first = norm(row[map.date]);
      // transaksi tertunda (BCA "PEND") belum dibukukan bank; baris ringkasan (Saldo Awal, Mutasi Debet, …) bukan transaksi
      if (first === 'pend' || first === 'pending') pending++;
      else if (!/^(saldo|mutasi|total|jumlah|ringkasan|summary|opening|closing|ending|beginning)/.test(first) && row.some((c) => c !== null && c !== '')) skipped++;
      continue;
    }
    let amount: number | null = null;
    if (map.debit !== undefined || map.credit !== undefined) {
      const d = map.debit !== undefined ? parseAmount(row[map.debit]) : null;
      const c = map.credit !== undefined ? parseAmount(row[map.credit]) : null;
      amount = (c ? Math.abs(c.value) : 0) - (d ? Math.abs(d.value) : 0);
    } else if (map.amount !== undefined) {
      const a = parseAmount(row[map.amount]);
      if (a) {
        const dcCell = map.dc !== undefined ? norm(row[map.dc]).toUpperCase() : '';
        const dc = a.dc ?? (/^(DB|D|DR|DEBET|DEBIT)/.test(dcCell) ? 'DB' : /^(CR|K|KREDIT|CREDIT)/.test(dcCell) ? 'CR' : undefined);
        amount = dc === 'DB' ? -Math.abs(a.value) : dc === 'CR' ? Math.abs(a.value) : a.value;
      }
    }
    if (!amount) {
      skipped++;
      continue;
    }
    const bal = map.balance !== undefined ? parseAmount(row[map.balance]) : null;
    lines.push({
      date,
      description:
        [map.description, map.description2]
          .filter((i): i is number => i !== undefined)
          .map((i) => String(row[i] ?? '').trim())
          .filter(Boolean)
          .join(' ') || '-',
      amount: amount.toFixed(2),
      balance: bal ? bal.value.toFixed(2) : undefined,
    });
  }
  return { lines, skipped, pending };
}
