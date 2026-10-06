/**
 * Penyusun lembar Excel SANSU — murni data (tanpa pustaka Excel), jadi bisa diuji.
 *
 * Setiap lembar punya kop (nama perusahaan, judul, periode), baris judul kolom,
 * lalu baris isi. Angka turunan (jumlah, subtotal, saldo berjalan, selisih kontrol)
 * ditulis sebagai RUMUS Excel lengkap dengan nilai hasilnya, sehingga file langsung
 * benar saat dibuka dan tetap ikut berubah bila angkanya diedit.
 */

export type Fmt = 'text' | 'code' | 'money' | 'int' | 'dec' | 'pct' | 'date';
export type RowStyle = 'body' | 'section' | 'group' | 'subtotal' | 'total' | 'grand' | 'note' | 'heading' | 'check';

export interface Formula {
  f: string;
  /** Nilai hasil (cache) — ditampilkan apa adanya oleh pembaca yang tidak menghitung ulang */
  v?: number | string | null;
}
export type Val = string | number | null | undefined | Date | Formula;

export interface Column {
  key: string;
  header: string;
  fmt?: Fmt;
  /** Lebar kolom (karakter). Kosong = otomatis dari isi. */
  width?: number;
  align?: 'center';
}

export interface Row {
  values: Val[];
  style: RowStyle;
  indent?: number;
}

export interface SheetSpec {
  name: string;
  title: string;
  company?: string;
  /** Baris keterangan di bawah judul: periode, dasar penyusunan, satuan */
  subtitle: string[];
  columns: Column[];
  /** Judul kelompok di atas judul kolom (mis. "Saldo awal" di atas Debit/Kredit) */
  groups?: { label: string; from: string; to: string }[];
  rows: Row[];
  landscape: boolean;
  /** Tombol filter di judul kolom (untuk daftar) */
  filter: boolean;
  /** Jumlah kolom kiri yang dibekukan saat menggulir ke kanan */
  freezeCols: number;
  /** Sel kontrol yang harus bernilai nol (diwarnai merah bila tidak) */
  checks: string[];
  /** false = tanpa baris judul kolom (untuk lembar naratif seperti CALK) */
  header: boolean;
}

export const isFormula = (v: Val): v is Formula => typeof v === 'object' && v !== null && !(v instanceof Date) && 'f' in v;

/** 0 → A, 25 → Z, 26 → AA */
export const colLetter = (i: number): string => {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

/** Angka dari API (string desimal) → number; kosong → null */
export const n = (v: string | number | null | undefined): number | null => (v == null || v === '' ? null : Number(v));

/** 'YYYY-MM-DD' → Date (UTC tengah malam, supaya Excel tidak bergeser sehari) */
export const d = (s: string | null | undefined): Date | null => {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
};

const near = (a: number | null | undefined, b: number | null | undefined) => Math.abs((a ?? 0) - (b ?? 0)) < 0.005;

export interface SheetOptions {
  title: string;
  company?: string;
  subtitle?: (string | null | undefined | false)[];
  columns: Column[];
  groups?: SheetSpec['groups'];
  landscape?: boolean;
  filter?: boolean;
  freezeCols?: number;
  header?: boolean;
}

/** Nomor baris Excel judul kolom terakhir (atau baris kosong setelah kop bila tanpa judul kolom) */
export const headerRowOf = (s: Pick<SheetSpec, 'subtitle' | 'groups' | 'header'>) => 1 + 1 + s.subtitle.length + 1 + (s.header ? (s.groups?.length ? 2 : 1) : 0);

export class SheetBuilder {
  readonly spec: SheetSpec;
  private readonly idx = new Map<string, number>();

  constructor(name: string, o: SheetOptions) {
    this.spec = {
      name: safeSheetName(name),
      title: o.title,
      company: o.company,
      subtitle: (o.subtitle ?? []).filter((x): x is string => !!x),
      columns: o.columns,
      groups: o.groups,
      rows: [],
      landscape: o.landscape ?? o.columns.length > 7,
      filter: o.filter ?? false,
      freezeCols: o.freezeCols ?? 0,
      checks: [],
      header: o.header ?? true,
    };
    o.columns.forEach((c, i) => this.idx.set(c.key, i));
  }

  /** Baris judul kolom terakhir (nomor baris Excel) */
  get headerRow(): number {
    return headerRowOf(this.spec);
  }
  /** Nomor baris Excel untuk baris isi berikutnya */
  get next(): number {
    return this.headerRow + this.spec.rows.length + 1;
  }

  /** Huruf kolom untuk key */
  L(key: string): string {
    const i = this.idx.get(key);
    if (i == null) throw new Error(`Kolom tidak dikenal: ${key}`);
    return colLetter(i);
  }
  /** Alamat sel, mis. ref('debit', 12) → "E12" */
  ref(key: string, row: number): string {
    return `${this.L(key)}${row}`;
  }
  /** Rentang satu kolom */
  range(key: string, r1: number, r2: number): string {
    return `${this.L(key)}${r1}:${this.L(key)}${r2}`;
  }

  /**
   * Tambah baris. `values` boleh array berurutan sesuai kolom, atau objek {key: nilai}.
   * Mengembalikan nomor baris Excel.
   */
  row(values: Val[] | Record<string, Val>, style: RowStyle = 'body', indent = 0): number {
    const arr: Val[] = Array.isArray(values) ? values : this.spec.columns.map((c) => values[c.key]);
    const r = this.next;
    this.spec.rows.push({ values: arr, style, indent });
    return r;
  }
  section(label: string): number {
    return this.row([label], 'section');
  }
  heading(label: string): number {
    return this.row([label], 'heading');
  }
  note(text: string): number {
    return this.row([text], 'note');
  }
  blank(): number {
    return this.row([], 'body');
  }

  /** Rumus dengan nilai cache */
  fx(f: string, v: number | string | null | undefined): Formula {
    return { f, v: v ?? null };
  }
  /** Nilai (atau nilai cache rumus) sel pada baris Excel tertentu */
  valueAt(key: string, row: number): number {
    const r = this.spec.rows[row - this.headerRow - 1];
    const x = r?.values[this.idx.get(key) ?? -1];
    const v = isFormula(x) ? x.v : x;
    return typeof v === 'number' ? v : 0;
  }
  /** =SUM(kolom r1:r2); kosong (r2 < r1) → 0. Nilai cache dihitung otomatis bila tidak diberikan. */
  sum(key: string, r1: number, r2: number, v?: number | null): Formula {
    if (r2 < r1) return { f: '0', v: 0 };
    let calc = 0;
    for (let r = r1; r <= r2; r++) calc += this.valueAt(key, r);
    return { f: `SUM(${this.range(key, r1, r2)})`, v: v ?? Math.round(calc * 100) / 100 };
  }
  /** =A+B+C dari daftar sel (baris) di satu kolom; tanda minus didukung lewat {row, neg} */
  add(key: string, rows: (number | { row: number; neg: true })[], v?: number | null): Formula {
    if (!rows.length) return { f: '0', v: 0 };
    const f = rows
      .map((x, i) => {
        const neg = typeof x === 'object';
        const ref = this.ref(key, typeof x === 'object' ? x.row : x);
        return i === 0 ? (neg ? `-${ref}` : ref) : `${neg ? '-' : '+'}${ref}`;
      })
      .join('');
    const calc = rows.reduce<number>((s, x) => (typeof x === 'object' ? s - this.valueAt(key, x.row) : s + this.valueAt(key, x)), 0);
    return { f, v: v ?? Math.round(calc * 100) / 100 };
  }

  /**
   * Pakai rumus hanya bila hasil hitung ulangnya sama dengan angka sistem.
   * Bila berbeda (mis. ada pembulatan khusus pajak), tulis angka sistem apa adanya
   * — Excel tidak boleh menampilkan angka yang berbeda dari aplikasi.
   */
  verified(f: string, systemValue: number | null, recomputed: number | null): Val {
    return near(systemValue, recomputed) ? { f, v: systemValue } : systemValue;
  }

  /** Tandai sel kontrol (harus nol) — diberi warna merah otomatis bila tidak nol */
  check(cell: string) {
    this.spec.checks.push(cell);
  }

  /** Baris "Jumlah" untuk daftar: SUM pada kolom-kolom yang diminta */
  totals(
    label: string,
    r1: number,
    r2: number,
    keys: string[],
    o: { cache?: Record<string, number | null>; style?: RowStyle; labelKey?: string; extra?: (row: number) => Record<string, Val> } = {},
  ): number {
    const row = this.next;
    const v: Record<string, Val> = { [o.labelKey ?? this.spec.columns[0].key]: label };
    for (const k of keys) v[k] = this.sum(k, r1, r2, o.cache?.[k]);
    Object.assign(v, o.extra?.(row));
    return this.row(v, o.style ?? 'total');
  }
}

/** Nama lembar Excel: maks 31 karakter, tanpa : \ / ? * [ ] */
export function safeSheetName(s: string): string {
  return s.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31).trim() || 'Lembar';
}

/** Jumlah dari daftar angka (untuk nilai cache) */
export const total = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);
