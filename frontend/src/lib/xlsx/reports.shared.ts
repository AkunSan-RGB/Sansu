/**
 * Lembar Excel untuk setiap laporan SANSU. Semua fungsi murni: data API → SheetSpec.
 * Angka turunan ditulis sebagai rumus (dengan nilai hasil), angka sumber sebagai nilai.
 */
import { REPORTING_FRAMEWORK_LABELS, type ReportingFramework, type FinancialNotes } from '@sansu/shared';
import { SheetBuilder, total, type Column, type SheetSpec } from './book';

export const BULAN = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];
/** '2026-03-31' → '31 Maret 2026' */
export const tgl = (s: string) => {
  const [y, m, dd] = s.slice(0, 10).split('-').map(Number);
  return `${dd} ${BULAN[m - 1]} ${y}`;
};
export const periodeText = (from: string, to: string) => `Periode ${tgl(from)} s/d ${tgl(to)}`;
export const RP = 'Dalam Rupiah';
export const money = (key: string, header: string, width?: number): Column => ({ key, header, fmt: 'money', width });
export const DK = (p: string): Column[] => [money(`${p}D`, 'Debit'), money(`${p}K`, 'Kredit')];
export const max0 = (x: number) => Math.max(0, x);
// ============ Laporan keuangan ============
export interface StatementMeta {
  company?: string;
  framework: ReportingFramework;
  refs?: Record<string, string>;
  detail?: boolean;
  /** Penandatangan laporan (hanya Posisi Keuangan dan Laba Rugi; CALK tidak ditandatangani) */
  signer?: { name: string; city?: string | null; directorName?: string | null; directorTitle?: string | null };
}
export const basis = (fw: StatementMeta['framework']) => `Disusun berdasarkan ${REPORTING_FRAMEWORK_LABELS[fw]}`;
export type DocLike = Pick<FinancialNotes, 'framework' | 'period'> & {
  company: { name: string };
  sections: { number: string; title: string; paragraphs: string[]; tables: FinancialNotes['sections'][number]['tables']; subsections?: FinancialNotes['sections'][number]['subsections'] }[];
};
export function documentSheet(sheetName: string, docTitle: string, nt: DocLike, company?: string, subtitle?: string[]): SheetSpec[] {
  const width = Math.max(
    3,
    ...nt.sections.flatMap((x) => [
      ...x.tables.map((t) => t.columns.length),
      ...(x.subsections ?? []).map((u) => u.table?.columns.length ?? 0),
    ]),
  );
  const s = new SheetBuilder(sheetName, {
    company: company ?? nt.company.name,
    title: docTitle,
    subtitle: subtitle ?? [`Untuk tahun yang berakhir ${tgl(nt.period.to)}`, `${basis(nt.framework)} · ${RP}`],
    columns: [
      { key: 'c0', header: 'Uraian', width: 50 },
      ...Array.from({ length: width - 1 }, (_, i) => money(`c${i + 1}`, '', 18)),
    ],
    landscape: width > 4,
    header: false,
  });
  const table = (t: {
    title?: string;
    columns: string[];
    rows: (string | number | null)[][];
    total?: (string | number | null)[];
  }) => {
    if (t.title) s.row([t.title], 'group');
    s.row(t.columns, 'section');
    const a = s.next;
    for (const r of t.rows)
      s.row(
        r.map((x) => (typeof x === 'number' ? x : (x ?? null))),
        'body',
        1,
      );
    const b = s.next - 1;
    if (t.total) {
      s.row(
        t.total.map((x, i) => {
          if (i === 0 || typeof x !== 'number') return x;
          const col = `c${i}`;
          const sumJs = total(t.rows.map((r) => (typeof r[i] === 'number' ? (r[i] as number) : 0)));
          return s.verified(`SUM(${s.range(col, a, b)})`, x, sumJs);
        }),
        'total',
      );
    }
    s.blank();
  };
  for (const sec of nt.sections) {
    s.heading(`${sec.number}. ${sec.title}`);
    for (const p of sec.paragraphs) s.note(p);
    for (const sub of sec.subsections ?? []) {
      s.row([sub.title], 'group');
      for (const p of sub.paragraphs) s.note(p);
      if (sub.table) table(sub.table);
    }
    for (const t of sec.tables) table(t);
    s.blank();
  }
  // tabel CALK: judul kolom ditulis di baris "section" → rata kanan untuk angka
  return [s.spec];
}
