/**
 * Lembar Excel untuk setiap laporan SANSU. Semua fungsi murni: data API → SheetSpec.
 * Angka turunan ditulis sebagai rumus (dengan nilai hasil), angka sumber sebagai nilai.
 */
import {
  CASH_DENOMINATIONS,
  FISCAL_ASSET_GROUP_INFO,
  JOURNAL_SOURCE_LABELS,
  REPORTING_FRAMEWORK_LABELS,
  type ReportingFramework,
  statementTitle,
  TAX_PAYMENT_LABELS,
  type AnnualTaxRecap,
  type BpjsRecap,
  type CashCount,
  type CashTransaction,
  type CashFlowStatement,
  type EquityStatement,
  type FinancialAppendix,
  type FinancialNotes,
  type FinancialPosition,
  type FiscalAssetGroup,
  type FiscalReconciliation,
  type FixedAsset,
  type FullTrialBalance,
  type IncomeStatement,
  type LedgerReport,
  type Payslip,
  type PayrollRun,
  type StatementLine,
  type TaxPayment,
  type VatReport,
  type VatReportRow,
  type WithholdingRecap,
  type Worksheet,
} from '@sansu/shared';
import { d, n, SheetBuilder, total, type Column, type SheetSpec, type Val } from './book';

const BULAN = [
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
const periodeText = (from: string, to: string) => `Periode ${tgl(from)} s/d ${tgl(to)}`;
const RP = 'Dalam Rupiah';
const money = (key: string, header: string, width?: number): Column => ({ key, header, fmt: 'money', width });
const DK = (p: string): Column[] => [money(`${p}D`, 'Debit'), money(`${p}K`, 'Kredit')];
const max0 = (x: number) => Math.max(0, x);

// ============ Neraca saldo ============
export function trialBalanceSheet(t: FullTrialBalance, company?: string): SheetSpec[] {
  const s = new SheetBuilder('Neraca Saldo', {
    company,
    title: 'Neraca Saldo',
    subtitle: [periodeText(t.period.from, t.period.to), RP],
    columns: [
      { key: 'code', header: 'Kode', fmt: 'code', width: 10 },
      { key: 'name', header: 'Nama akun' },
      ...DK('o'),
      ...DK('m'),
      ...DK('c'),
    ],
    groups: [
      { label: 'Saldo awal', from: 'oD', to: 'oK' },
      { label: 'Mutasi', from: 'mD', to: 'mK' },
      { label: 'Saldo akhir', from: 'cD', to: 'cK' },
    ],
    freezeCols: 2,
    filter: true,
  });
  const first = s.next;
  for (const r of t.rows) {
    const row = s.next;
    const [oD, oK, mD, mK] = [
      n(r.opening.debit) ?? 0,
      n(r.opening.credit) ?? 0,
      n(r.movement.debit) ?? 0,
      n(r.movement.credit) ?? 0,
    ];
    const net = oD - oK + mD - mK;
    const a = (k: string) => s.ref(k, row);
    s.row({
      code: r.code,
      name: r.name,
      oD,
      oK,
      mD,
      mK,
      cD: s.verified(`MAX(0,${a('oD')}-${a('oK')}+${a('mD')}-${a('mK')})`, n(r.closing.debit), max0(net)),
      cK: s.verified(`MAX(0,${a('oK')}-${a('oD')}+${a('mK')}-${a('mD')})`, n(r.closing.credit), max0(-net)),
    });
  }
  const last = s.next - 1;
  const tt = t.totals;
  const tot = s.totals('Jumlah', first, last, ['oD', 'oK', 'mD', 'mK', 'cD', 'cK'], {
    cache: {
      oD: n(tt.opening.debit),
      oK: n(tt.opening.credit),
      mD: n(tt.movement.debit),
      mK: n(tt.movement.credit),
      cD: n(tt.closing.debit),
      cK: n(tt.closing.credit),
    },
    style: 'grand',
    labelKey: 'name',
  });
  const diff = (dk: string, kk: string, a: string | null, b: string | null) =>
    s.fx(`${s.ref(dk, tot)}-${s.ref(kk, tot)}`, (n(a) ?? 0) - (n(b) ?? 0));
  const cr = s.row(
    {
      name: 'Selisih debit − kredit (harus nol)',
      oK: diff('oD', 'oK', tt.opening.debit, tt.opening.credit),
      mK: diff('mD', 'mK', tt.movement.debit, tt.movement.credit),
      cK: diff('cD', 'cK', tt.closing.debit, tt.closing.credit),
    },
    'check',
  );
  ['oK', 'mK', 'cK'].forEach((k) => s.check(s.ref(k, cr)));
  return [s.spec];
}

// ============ Neraca lajur ============
const WS_COLS = [
  { k: 'trial', p: 'ns', label: 'Neraca saldo' },
  { k: 'adjustment', p: 'aj', label: 'Penyesuaian' },
  { k: 'adjusted', p: 'nsd', label: 'NS disesuaikan' },
  { k: 'incomeStatement', p: 'lr', label: 'Laba rugi' },
  { k: 'balanceSheet', p: 'nr', label: 'Neraca' },
] as const;

export function worksheetSheet(w: Worksheet, company?: string): SheetSpec[] {
  const s = new SheetBuilder('Neraca Lajur', {
    company,
    title: 'Neraca Lajur',
    subtitle: [periodeText(w.period.from, w.period.to), RP],
    columns: [
      { key: 'code', header: 'Kode', fmt: 'code', width: 10 },
      { key: 'name', header: 'Nama akun' },
      ...WS_COLS.flatMap((c) => DK(c.p)),
    ],
    groups: WS_COLS.map((c) => ({ label: c.label, from: `${c.p}D`, to: `${c.p}K` })),
    freezeCols: 2,
    landscape: true,
  });
  const first = s.next;
  for (const r of w.rows) {
    const row = s.next;
    const a = (k: string) => s.ref(k, row);
    const v = (c: (typeof WS_COLS)[number]['k'], side: 'debit' | 'credit') => n(r[c][side]);
    const net =
      (v('trial', 'debit') ?? 0) -
      (v('trial', 'credit') ?? 0) +
      (v('adjustment', 'debit') ?? 0) -
      (v('adjustment', 'credit') ?? 0);
    const isPL = r.isPL ?? (n(r.incomeStatement.debit) !== 0 || n(r.incomeStatement.credit) !== 0);
    const vals: Record<string, Val> = {
      code: r.code,
      name: r.name,
      nsD: v('trial', 'debit'),
      nsK: v('trial', 'credit'),
      ajD: v('adjustment', 'debit'),
      ajK: v('adjustment', 'credit'),
      nsdD: s.verified(`MAX(0,${a('nsD')}-${a('nsK')}+${a('ajD')}-${a('ajK')})`, v('adjusted', 'debit'), max0(net)),
      nsdK: s.verified(`MAX(0,${a('nsK')}-${a('nsD')}+${a('ajK')}-${a('ajD')})`, v('adjusted', 'credit'), max0(-net)),
    };
    const to = isPL ? 'lr' : 'nr';
    const other = isPL ? 'nr' : 'lr';
    const src = isPL ? 'incomeStatement' : 'balanceSheet';
    vals[`${to}D`] = s.verified(a('nsdD'), v(src, 'debit'), v('adjusted', 'debit'));
    vals[`${to}K`] = s.verified(a('nsdK'), v(src, 'credit'), v('adjusted', 'credit'));
    vals[`${other}D`] = null;
    vals[`${other}K`] = null;
    s.row(vals);
  }
  const last = s.next - 1;
  const keys = WS_COLS.flatMap((c) => [`${c.p}D`, `${c.p}K`]);
  const cache: Record<string, number | null> = {};
  for (const c of WS_COLS) {
    cache[`${c.p}D`] = n(w.totals[c.k].debit);
    cache[`${c.p}K`] = n(w.totals[c.k].credit);
  }
  const tot = s.row(
    { name: 'Jumlah', ...Object.fromEntries(keys.map((k) => [k, s.sum(k, first, last, cache[k])])) },
    'subtotal',
  );
  // Laba bersih: selisih kolom laba rugi, dipindah ke neraca
  const np = n(w.netProfit) ?? 0;
  const P = `(${s.ref('lrK', tot)}-${s.ref('lrD', tot)})`;
  const lb = s.row(
    {
      name: np >= 0 ? 'Laba bersih' : 'Rugi bersih',
      lrD: s.fx(`MAX(0,${P})`, max0(np)),
      lrK: s.fx(`MAX(0,-${P})`, max0(-np)),
      nrD: s.fx(`MAX(0,-${P})`, max0(-np)),
      nrK: s.fx(`MAX(0,${P})`, max0(np)),
    },
    'body',
  );
  const bal = (k: string) =>
    s.fx(`${s.ref(k, tot)}+${s.ref(k, lb)}`, (cache[k] ?? 0) + (k === 'lrD' || k === 'nrK' ? max0(np) : max0(-np)));
  const fin = s.row(
    { name: 'Jumlah seimbang', lrD: bal('lrD'), lrK: bal('lrK'), nrD: bal('nrD'), nrK: bal('nrK') },
    'grand',
  );
  const cr = s.row(
    {
      name: 'Selisih (harus nol)',
      nsK: s.fx(`${s.ref('nsD', tot)}-${s.ref('nsK', tot)}`, (cache.nsD ?? 0) - (cache.nsK ?? 0)),
      nsdK: s.fx(`${s.ref('nsdD', tot)}-${s.ref('nsdK', tot)}`, (cache.nsdD ?? 0) - (cache.nsdK ?? 0)),
      lrK: s.fx(`${s.ref('lrD', fin)}-${s.ref('lrK', fin)}`, 0),
      nrK: s.fx(`${s.ref('nrD', fin)}-${s.ref('nrK', fin)}`, w.balanced ? 0 : null),
    },
    'check',
  );
  ['nsK', 'nsdK', 'lrK', 'nrK'].forEach((k) => s.check(s.ref(k, cr)));
  return [s.spec];
}

// ============ Laporan keuangan ============
export interface StatementMeta {
  company?: string;
  framework: ReportingFramework;
  refs?: Record<string, string>;
  detail?: boolean;
  /** Penandatangan laporan (hanya Posisi Keuangan dan Laba Rugi; CALK tidak ditandatangani) */
  signer?: { name: string; city?: string | null; directorName?: string | null; directorTitle?: string | null };
}
/** Blok tanda tangan di bawah laporan: kota & tanggal (hari dikosongkan), perusahaan, ruang tanda tangan, nama, jabatan */
function signatureBlock(s: SheetBuilder, m: StatementMeta, year: number) {
  const g = m.signer;
  if (!g) return;
  s.blank();
  s.blank();
  s.row({ label: `${g.city || '……………'}, … Maret ${year + 1}` }, 'note');
  s.row({ label: g.name }, 'note');
  s.blank();
  s.blank();
  s.blank();
  s.row({ label: g.directorName || '(nama)' }, 'heading');
  if (g.directorTitle) s.row({ label: g.directorTitle }, 'note');
}
const basis = (fw: StatementMeta['framework']) => `Disusun berdasarkan ${REPORTING_FRAMEWORK_LABELS[fw]}`;

/** Tulis satu baris pos (dengan rincian akun bila diminta); mengembalikan nomor barisnya */
function statementLine(s: SheetBuilder, l: StatementLine, m: StatementMeta, rowOf: Map<string, number>): number {
  const ref = m.refs?.[l.key] ?? '';
  if (l.kind !== 'group') {
    const parts = (l.parts ?? []).map((k) => rowOf.get(k)).filter((x): x is number => x != null);
    const ok = parts.length === (l.parts ?? []).length && parts.length > 0;
    const r = s.row(
      {
        label: l.label,
        note: ref,
        cur: ok ? s.add('cur', parts, n(l.amount)) : n(l.amount),
        cmp: ok ? s.add('cmp', parts, n(l.compare)) : n(l.compare),
      },
      l.kind === 'total' ? 'grand' : 'subtotal',
    );
    rowOf.set(l.key, r);
    return r;
  }
  const accs = m.detail ? (l.accounts ?? []) : [];
  if (!accs.length) {
    const r = s.row({ label: l.label, note: ref, cur: n(l.amount), cmp: n(l.compare) }, 'group', 1);
    rowOf.set(l.key, r);
    return r;
  }
  s.row({ label: l.label, note: ref }, 'group', 1);
  const a1 = s.next;
  for (const a of accs)
    s.row({ label: `${a.code ? `${a.code}  ` : ''}${a.name}`, cur: n(a.amount), cmp: n(a.compare) }, 'body', 3);
  const a2 = s.next - 1;
  const r = s.row(
    {
      label: `Jumlah ${l.label.toLowerCase()}`,
      cur: s.sum('cur', a1, a2, n(l.amount)),
      cmp: s.sum('cmp', a1, a2, n(l.compare)),
    },
    'subtotal',
    1,
  );
  rowOf.set(l.key, r);
  return r;
}

const stmtCols = (cur: string, cmp: string): Column[] => [
  { key: 'label', header: 'Pos', width: 52 },
  { key: 'note', header: 'Catatan', width: 9, align: 'center' },
  money('cur', cur, 18),
  money('cmp', cmp, 18),
];

export function positionSheet(p: FinancialPosition, m: StatementMeta): SheetSpec[] {
  const s = new SheetBuilder('Posisi Keuangan', {
    company: m.company,
    title: statementTitle('position', m.framework),
    subtitle: [`Per ${tgl(p.asOf)}`, basis(m.framework), RP],
    columns: stmtCols(tgl(p.asOf), tgl(p.compareAsOf)),
    landscape: false,
  });
  const rowOf = new Map<string, number>();
  const secRow = new Map<string, number>();
  const block = (keys: string[], label: string, totalKey: 'assets' | 'liabilities' | 'equity') => {
    s.heading(label);
    const rows: number[] = [];
    for (const sec of p.sections.filter((x) => keys.includes(x.key))) {
      s.section(sec.label);
      const lines = sec.lines.map((l) => statementLine(s, l, m, rowOf));
      const r = s.row(
        {
          label: `Jumlah ${sec.label.toLowerCase()}`,
          cur: s.add('cur', lines, n(sec.total)),
          cmp: s.add('cmp', lines, n(sec.compareTotal)),
        },
        'subtotal',
      );
      secRow.set(sec.key, r);
      rows.push(r);
    }
    const t = p.totals[totalKey];
    return { rows, t };
  };
  const A = block(['CURRENT_ASSET', 'NONCURRENT_ASSET'], 'ASET', 'assets');
  const ta = s.row(
    { label: 'JUMLAH ASET', cur: s.add('cur', A.rows, n(A.t.amount)), cmp: s.add('cmp', A.rows, n(A.t.compare)) },
    'grand',
  );
  s.blank();
  const L = block(['CURRENT_LIABILITY', 'NONCURRENT_LIABILITY'], 'LIABILITAS', 'liabilities');
  const tl = s.row(
    { label: 'Jumlah liabilitas', cur: s.add('cur', L.rows, n(L.t.amount)), cmp: s.add('cmp', L.rows, n(L.t.compare)) },
    'subtotal',
  );
  s.blank();
  const E = block(['EQUITY'], 'EKUITAS', 'equity');
  const te = E.rows[0] ?? tl;
  s.blank();
  const le = p.totals.liabilitiesEquity;
  const tle = s.row(
    {
      label: 'JUMLAH LIABILITAS DAN EKUITAS',
      cur: s.add('cur', [tl, te], n(le.amount)),
      cmp: s.add('cmp', [tl, te], n(le.compare)),
    },
    'grand',
  );
  const c = s.row(
    {
      label: 'Selisih aset − (liabilitas + ekuitas), harus nol',
      cur: s.fx(`${s.ref('cur', ta)}-${s.ref('cur', tle)}`, (n(p.totals.assets.amount) ?? 0) - (n(le.amount) ?? 0)),
      cmp: s.fx(`${s.ref('cmp', ta)}-${s.ref('cmp', tle)}`, (n(p.totals.assets.compare) ?? 0) - (n(le.compare) ?? 0)),
    },
    'check',
  );
  s.check(s.ref('cur', c));
  s.check(s.ref('cmp', c));
  signatureBlock(s, m, Number(p.asOf.slice(0, 4)));
  return [s.spec];
}

export function incomeSheet(p: IncomeStatement, m: StatementMeta): SheetSpec[] {
  const s = new SheetBuilder('Laba Rugi', {
    company: m.company,
    title: statementTitle('income', p.framework),
    subtitle: [periodeText(p.period.from, p.period.to), basis(p.framework), `${RP} · beban ditampilkan dalam kurung`],
    columns: stmtCols(
      `${tgl(p.period.from)} – ${tgl(p.period.to)}`,
      `${tgl(p.comparePeriod.from)} – ${tgl(p.comparePeriod.to)}`,
    ),
    landscape: false,
  });
  const rowOf = new Map<string, number>();
  for (const l of p.lines) statementLine(s, l, { ...m, framework: p.framework }, rowOf);
  signatureBlock(s, m, Number(p.period.to.slice(0, 4)));
  return [s.spec];
}

export function equitySheet(e: EquityStatement, m: StatementMeta): SheetSpec[] {
  const cols: Column[] = [
    { key: 'label', header: 'Keterangan', width: 44 },
    ...e.columns.filter((c) => c.key !== 'TOTAL').map((c) => money(c.key, c.label, 17)),
    money('TOTAL', 'Jumlah ekuitas', 18),
  ];
  const s = new SheetBuilder('Perubahan Ekuitas', {
    company: m.company,
    title: statementTitle('equity', m.framework),
    subtitle: [periodeText(e.period.from, e.period.to), basis(m.framework), RP],
    columns: cols,
    landscape: true,
  });
  const valueCols = cols.slice(1, -1).map((c) => c.key);
  const part = (title: string, rows: EquityStatement['current']['rows']) => {
    s.section(title);
    const first = s.next;
    for (const r of rows) {
      const row = s.next;
      const isClosing = r.key === 'CLOSING';
      const vals: Record<string, Val> = {
        label: r.label.replace(/Saldo per (\d{4}-\d{2}-\d{2})/, (_, x) => `Saldo per ${tgl(x)}`),
      };
      for (const k of valueCols)
        vals[k] = isClosing && row > first ? s.sum(k, first, row - 1, n(r.values[k])) : n(r.values[k]);
      vals.TOTAL = s.fx(
        `SUM(${s.ref(valueCols[0], row)}:${s.ref(valueCols[valueCols.length - 1], row)})`,
        n(r.values.TOTAL),
      );
      s.row(vals, r.kind === 'balance' ? (isClosing ? 'grand' : 'subtotal') : 'body', r.kind === 'balance' ? 0 : 1);
    }
    s.blank();
  };
  part(`Periode ${tgl(e.comparePeriod.from)} – ${tgl(e.comparePeriod.to)}`, e.previous.rows);
  part(`Periode ${tgl(e.period.from)} – ${tgl(e.period.to)}`, e.current.rows);
  return [s.spec];
}

export function cashFlowSheet(c: CashFlowStatement, m: StatementMeta): SheetSpec[] {
  const s = new SheetBuilder('Arus Kas', {
    company: m.company,
    title: statementTitle('cashflow', m.framework),
    subtitle: [
      periodeText(c.period.from, c.period.to),
      `Metode ${c.method === 'direct' ? 'langsung' : 'tidak langsung'} · ${basis(m.framework)}`,
      RP,
    ],
    columns: [
      { key: 'label', header: 'Keterangan', width: 56 },
      money('cur', `${tgl(c.period.from)} – ${tgl(c.period.to)}`, 18),
      money('cmp', `${tgl(c.comparePeriod.from)} – ${tgl(c.comparePeriod.to)}`, 18),
    ],
    landscape: false,
  });
  const totals: number[] = [];
  const sec = (title: string, k: 'operating' | 'investing' | 'financing') => {
    s.section(`Arus kas dari ${title}`);
    const labels = [
      ...new Set([...c.current[k].items.map((i) => i.label), ...c.previous[k].items.map((i) => i.label)]),
    ];
    const a = s.next;
    for (const lb of labels)
      s.row(
        {
          label: lb,
          cur: n(c.current[k].items.find((i) => i.label === lb)?.amount) ?? 0,
          cmp: n(c.previous[k].items.find((i) => i.label === lb)?.amount) ?? 0,
        },
        'body',
        1,
      );
    const b = s.next - 1;
    totals.push(
      s.row(
        {
          label: `Kas bersih dari ${title}`,
          cur: s.sum('cur', a, b, n(c.current[k].total)),
          cmp: s.sum('cmp', a, b, n(c.previous[k].total)),
        },
        'subtotal',
      ),
    );
    s.blank();
  };
  sec('aktivitas operasi', 'operating');
  sec('aktivitas investasi', 'investing');
  sec('aktivitas pendanaan', 'financing');
  const net = s.row(
    {
      label: 'Kenaikan (penurunan) bersih kas dan setara kas',
      cur: s.add('cur', totals, n(c.current.netChange)),
      cmp: s.add('cmp', totals, n(c.previous.netChange)),
    },
    'subtotal',
  );
  const open = s.row(
    { label: 'Kas dan setara kas awal periode', cur: n(c.current.opening), cmp: n(c.previous.opening) },
    'body',
  );
  const close = s.row(
    {
      label: 'Kas dan setara kas akhir periode',
      cur: s.add('cur', [net, open], n(c.current.closing)),
      cmp: s.add('cmp', [net, open], n(c.previous.closing)),
    },
    'grand',
  );
  const diffs = [n(c.current.difference) ?? 0, n(c.previous.difference) ?? 0];
  if (diffs.some((x) => Math.abs(x) >= 0.005)) {
    const act = s.row(
      {
        label: 'Kas dan setara kas menurut buku besar',
        cur: n(c.current.actualClosing),
        cmp: n(c.previous.actualClosing),
      },
      'body',
    );
    const r = s.row(
      {
        label: 'Selisih (perlu ditelusuri)',
        cur: s.fx(`${s.ref('cur', close)}-${s.ref('cur', act)}`, diffs[0]),
        cmp: s.fx(`${s.ref('cmp', close)}-${s.ref('cmp', act)}`, diffs[1]),
      },
      'check',
    );
    s.check(s.ref('cur', r));
    s.check(s.ref('cmp', r));
  }
  return [s.spec];
}

type DocLike = Pick<FinancialNotes, 'framework' | 'period'> & {
  company: { name: string };
  sections: { number: string; title: string; paragraphs: string[]; tables: FinancialNotes['sections'][number]['tables']; subsections?: FinancialNotes['sections'][number]['subsections'] }[];
};

export function notesSheet(nt: FinancialNotes, company?: string): SheetSpec[] {
  return documentSheet('CALK', statementTitle('notes', nt.framework), nt, company);
}

export function appendixSheet(ap: FinancialAppendix, company?: string): SheetSpec[] {
  return documentSheet('Lampiran', 'Lampiran Laporan Keuangan', ap, company);
}

function documentSheet(sheetName: string, docTitle: string, nt: DocLike, company?: string): SheetSpec[] {
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
    subtitle: [`Untuk tahun yang berakhir ${tgl(nt.period.to)}`, `${basis(nt.framework)} · ${RP}`],
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

// ============ Buku besar ============
export function ledgerSheet(l: LedgerReport, from: string, to: string, company?: string): SheetSpec[] {
  const debitNormal = l.account.type === 'ASSET' || l.account.type === 'EXPENSE';
  const s = new SheetBuilder('Buku Besar', {
    company,
    title: `Buku Besar · ${l.account.code} ${l.account.name}`,
    subtitle: [periodeText(from, to), `Saldo normal: ${debitNormal ? 'debit' : 'kredit'} · ${RP}`],
    columns: [
      { key: 'date', header: 'Tanggal', fmt: 'date', width: 12 },
      { key: 'no', header: 'Nomor jurnal', fmt: 'code', width: 18 },
      { key: 'desc', header: 'Keterangan', width: 50 },
      { key: 'src', header: 'Sumber', width: 16 },
      money('D', 'Debit'),
      money('K', 'Kredit'),
      money('bal', 'Saldo'),
    ],
    filter: true,
  });
  const open = s.row({ desc: 'Saldo awal', bal: n(l.opening) }, 'subtotal');
  let prev = open;
  let prevVal = n(l.opening) ?? 0;
  for (const r of l.rows) {
    const row = s.next;
    const dv = n(r.debit) ?? 0;
    const kv = n(r.credit) ?? 0;
    const calc = prevVal + (debitNormal ? dv - kv : kv - dv);
    const f = debitNormal
      ? `${s.ref('bal', prev)}+${s.ref('D', row)}-${s.ref('K', row)}`
      : `${s.ref('bal', prev)}+${s.ref('K', row)}-${s.ref('D', row)}`;
    s.row({
      date: d(r.date),
      no: r.number,
      desc: r.description,
      src: JOURNAL_SOURCE_LABELS[r.sourceType] ?? r.sourceType,
      D: dv || null,
      K: kv || null,
      bal: s.verified(f, n(r.balance), calc),
    });
    prev = row;
    prevVal = n(r.balance) ?? calc;
  }
  const a = open + 1;
  const b = s.next - 1;
  s.row(
    {
      desc: 'Jumlah mutasi & saldo akhir',
      D: s.sum('D', a, b, n(l.totalDebit)),
      K: s.sum('K', a, b, n(l.totalCredit)),
      bal: s.fx(
        debitNormal
          ? `${s.ref('bal', open)}+${s.ref('D', s.next)}-${s.ref('K', s.next)}`
          : `${s.ref('bal', open)}+${s.ref('K', s.next)}-${s.ref('D', s.next)}`,
        n(l.closing),
      ),
    },
    'grand',
  );
  return [s.spec];
}

// ============ Penggajian ============
export function payrollSheets(run: PayrollRun, slips: Payslip[], company?: string): SheetSpec[] {
  const per = `Periode ${run.period} · dibayar ${tgl(run.payDate)}`;
  const s = new SheetBuilder('Rekap Gaji', {
    company,
    title: `Rekap Gaji ${run.number}`,
    subtitle: [per, RP],
    columns: [
      { key: 'code', header: 'Kode', fmt: 'code', width: 10 },
      { key: 'name', header: 'Nama pegawai', width: 26 },
      { key: 'wd', header: 'Hari kerja', fmt: 'int', width: 8 },
      { key: 'pd', header: 'Hadir', fmt: 'int', width: 8 },
      money('base', 'Gaji pokok'),
      money('fix', 'Tunjangan tetap'),
      money('daily', 'Uang makan/ transport'),
      money('ot', 'Lembur'),
      money('oth', 'Bonus/ lainnya'),
      money('abs', 'Potongan absen'),
      money('gross', 'Penghasilan bruto'),
      money('kes', 'BPJS Kesehatan'),
      money('jht', 'BPJS JHT'),
      money('jp', 'BPJS JP'),
      money('pph', 'PPh 21'),
      money('loan', 'Kasbon/ potongan lain'),
      money('ded', 'Jumlah potongan'),
      money('net', 'Gaji bersih'),
      { key: 'bank', header: 'Bank', width: 10 },
      { key: 'acct', header: 'No. rekening', fmt: 'code', width: 16 },
    ],
    freezeCols: 2,
    filter: true,
    landscape: true,
  });
  const first = s.next;
  for (const p of slips) {
    const r = s.next;
    const a = (k: string) => s.ref(k, r);
    const v = {
      base: n(p.baseSalary) ?? 0,
      fix: n(p.fixedAllowance) ?? 0,
      daily: n(p.dailyAllowance) ?? 0,
      ot: n(p.overtimePay) ?? 0,
      oth: n(p.otherIncome) ?? 0,
      abs: n(p.absenceDeduction) ?? 0,
      kes: n(p.bpjsKesEmployee) ?? 0,
      jht: n(p.jhtEmployee) ?? 0,
      jp: n(p.jpEmployee) ?? 0,
      pph: n(p.pph21) ?? 0,
      loan: n(p.otherDeduction) ?? 0,
    };
    const gross = v.base + v.fix + v.daily + v.ot + v.oth - v.abs;
    const ded = v.kes + v.jht + v.jp + v.pph + v.loan;
    s.row({
      code: p.employee.code,
      name: p.employee.name,
      wd: p.workDays,
      pd: p.presentDays,
      ...v,
      gross: s.verified(`SUM(${a('base')}:${a('oth')})-${a('abs')}`, n(p.grossPay), gross),
      ded: s.fx(`SUM(${a('kes')}:${a('loan')})`, ded),
      net: s.verified(`${a('gross')}-${a('ded')}`, n(p.netPay), (n(p.grossPay) ?? gross) - ded),
      bank: p.employee.bankName ?? '',
      acct: p.employee.bankAccount ?? '',
    });
  }
  const last = s.next - 1;
  const keys = ['base', 'fix', 'daily', 'ot', 'oth', 'abs', 'gross', 'kes', 'jht', 'jp', 'pph', 'loan', 'ded', 'net'];
  s.totals(`Jumlah (${slips.length} pegawai)`, first, last, keys, {
    cache: { gross: n(run.totalGross), pph: n(run.totalPph21), net: n(run.totalNet) },
    style: 'grand',
    labelKey: 'name',
  });

  const c = new SheetBuilder('Iuran Perusahaan', {
    company,
    title: `Iuran BPJS Ditanggung Perusahaan · ${run.number}`,
    subtitle: [per, RP],
    columns: [
      { key: 'code', header: 'Kode', fmt: 'code', width: 10 },
      { key: 'name', header: 'Nama pegawai', width: 26 },
      money('gross', 'Penghasilan bruto'),
      money('kes', 'BPJS Kesehatan'),
      money('jht', 'JHT'),
      money('jp', 'JP'),
      money('jkk', 'JKK'),
      money('jkm', 'JKM'),
      money('tot', 'Jumlah iuran'),
      money('cost', 'Total biaya pegawai'),
    ],
    freezeCols: 2,
    filter: true,
  });
  const f2 = c.next;
  for (const p of slips) {
    const r2 = c.next;
    const a = (k: string) => c.ref(k, r2);
    const v = {
      kes: n(p.bpjsKesCompany) ?? 0,
      jht: n(p.jhtCompany) ?? 0,
      jp: n(p.jpCompany) ?? 0,
      jkk: n(p.jkkCompany) ?? 0,
      jkm: n(p.jkmCompany) ?? 0,
    };
    const tot = v.kes + v.jht + v.jp + v.jkk + v.jkm;
    c.row({
      code: p.employee.code,
      name: p.employee.name,
      gross: n(p.grossPay),
      ...v,
      tot: c.fx(`SUM(${a('kes')}:${a('jkm')})`, tot),
      cost: c.fx(`${a('gross')}+${a('tot')}`, (n(p.grossPay) ?? 0) + tot),
    });
  }
  c.totals('Jumlah', f2, c.next - 1, ['gross', 'kes', 'jht', 'jp', 'jkk', 'jkm', 'tot', 'cost'], {
    cache: { cost: n(run.totalEmployerCost) },
    style: 'grand',
    labelKey: 'name',
  });
  return [s.spec, c.spec];
}

export interface Pph21Report {
  year: number;
  employees: {
    code: string;
    name: string;
    nik: string | null;
    npwp: string | null;
    ptkp: string;
    months: number;
    gross: string;
    pension: string;
    pph21: string;
  }[];
  monthly: { period: string; gross: string; pph21: string; n: number }[];
}
export function pph21Sheets(p: Pph21Report, company?: string): SheetSpec[] {
  const m = new SheetBuilder('Per Masa Pajak', {
    company,
    title: `Rekap PPh 21 Tahun ${p.year} · per masa pajak`,
    subtitle: ['Bahan SPT Masa PPh 21 · hanya penggajian yang sudah diposting', RP],
    columns: [
      { key: 'period', header: 'Masa pajak', width: 16 },
      { key: 'n', header: 'Jumlah pegawai', fmt: 'int', width: 12 },
      money('gross', 'Penghasilan bruto'),
      money('pph', 'PPh 21 dipotong'),
      { key: 'rate', header: 'Tarif efektif', fmt: 'pct', width: 11 },
    ],
  });
  const a = m.next;
  for (const x of p.monthly) {
    const r = m.next;
    const [y, mm] = x.period.split('-').map(Number);
    const g = n(x.gross) ?? 0;
    m.row({
      period: `${BULAN[mm - 1]} ${y}`,
      n: x.n,
      gross: g,
      pph: n(x.pph21),
      rate: m.fx(`IF(${m.ref('gross', r)}=0,0,${m.ref('pph', r)}/${m.ref('gross', r)})`, g ? (n(x.pph21) ?? 0) / g : 0),
    });
  }
  const b = m.next - 1;
  const tg = total(p.monthly.map((x) => n(x.gross)));
  const tp = total(p.monthly.map((x) => n(x.pph21)));
  m.totals('Jumlah setahun', a, b, ['gross', 'pph'], {
    cache: { gross: tg, pph: tp },
    style: 'grand',
    extra: (t) => ({
      rate: m.fx(`IF(${m.ref('gross', t)}=0,0,${m.ref('pph', t)}/${m.ref('gross', t)})`, tg ? tp / tg : 0),
    }),
  });

  const e = new SheetBuilder('Per Pegawai', {
    company,
    title: `Rekap PPh 21 Tahun ${p.year} · per pegawai`,
    subtitle: ['Bahan bukti potong 1721-A1', RP],
    columns: [
      { key: 'code', header: 'Kode', fmt: 'code', width: 10 },
      { key: 'name', header: 'Nama pegawai', width: 26 },
      { key: 'nik', header: 'NIK', fmt: 'code', width: 18 },
      { key: 'npwp', header: 'NPWP', fmt: 'code', width: 22 },
      { key: 'ptkp', header: 'Status PTKP', width: 10 },
      { key: 'months', header: 'Jumlah bulan', fmt: 'int', width: 9 },
      money('gross', 'Bruto setahun'),
      money('pension', 'Iuran JHT + JP'),
      money('pph', 'PPh 21 dipotong'),
    ],
    filter: true,
    freezeCols: 2,
  });
  const a2 = e.next;
  for (const x of p.employees)
    e.row({
      code: x.code,
      name: x.name,
      nik: x.nik ?? '',
      npwp: x.npwp ?? '',
      ptkp: x.ptkp,
      months: x.months,
      gross: n(x.gross),
      pension: n(x.pension),
      pph: n(x.pph21),
    });
  e.totals('Jumlah', a2, e.next - 1, ['gross', 'pension', 'pph'], {
    style: 'grand',
    labelKey: 'name',
    cache: {
      gross: total(p.employees.map((x) => n(x.gross))),
      pension: total(p.employees.map((x) => n(x.pension))),
      pph: total(p.employees.map((x) => n(x.pph21))),
    },
  });
  return [m.spec, e.spec];
}

// ============ Pajak ============
export function vatSheets(v: VatReport, from: string, to: string, company?: string): SheetSpec[] {
  const docs = new SheetBuilder('Daftar Dokumen', {
    company,
    title: 'Rekap PPN · daftar dokumen',
    subtitle: [periodeText(from, to), RP],
    columns: [
      { key: 'kind', header: 'Jenis', width: 14 },
      { key: 'no', header: 'Nomor', fmt: 'code', width: 20 },
      { key: 'ref', header: 'Referensi', fmt: 'code', width: 18 },
      { key: 'date', header: 'Tanggal', fmt: 'date', width: 12 },
      { key: 'party', header: 'Lawan transaksi', width: 32 },
      { key: 'npwp', header: 'NPWP', fmt: 'code', width: 22 },
      money('dpp', 'DPP'),
      money('ppn', 'PPN'),
    ],
    filter: true,
  });
  const a = docs.next;
  for (const x of v.documents)
    docs.row({
      kind: x.kind,
      no: x.number,
      ref: x.ref ?? '',
      date: d(x.date),
      party: x.party,
      npwp: x.npwp ?? '',
      dpp: n(x.dpp),
      ppn: n(x.ppn),
    });
  const b = docs.next - 1;
  docs.totals(`Jumlah (${v.documents.length} dokumen)`, a, b, ['dpp', 'ppn'], {
    style: 'grand',
    labelKey: 'party',
    cache: { dpp: total(v.documents.map((x) => n(x.dpp))), ppn: total(v.documents.map((x) => n(x.ppn))) },
  });

  const s = new SheetBuilder('Ringkasan PPN', {
    company,
    title: 'Rekap PPN',
    subtitle: [periodeText(from, to), RP],
    columns: [{ key: 'label', header: 'Uraian', width: 40 }, money('amt', 'Jumlah', 20)],
    landscape: false,
  });
  const out = s.row({ label: 'PPN keluaran', amt: n(v.vatOut) }, 'body', 1);
  const inn = s.row({ label: 'PPN masukan', amt: n(v.vatIn) }, 'body', 1);
  const net = s.row(
    {
      label: 'Selisih (keluaran − masukan)',
      amt: s.verified(`${s.ref('amt', out)}-${s.ref('amt', inn)}`, n(v.net), (n(v.vatOut) ?? 0) - (n(v.vatIn) ?? 0)),
    },
    'grand',
  );
  s.row(
    {
      label: 'Status',
      amt: s.fx(
        `IF(${s.ref('amt', net)}>0,"Kurang bayar",IF(${s.ref('amt', net)}<0,"Lebih bayar","Nihil"))`,
        v.status === 'KURANG_BAYAR' ? 'Kurang bayar' : v.status === 'LEBIH_BAYAR' ? 'Lebih bayar' : 'Nihil',
      ),
    },
    'body',
  );
  s.blank();
  s.note(
    'Angka keluaran/masukan diambil dari saldo akun PPN di buku besar; rincian dokumen ada di lembar "Daftar Dokumen".',
  );
  return [s.spec, docs.spec];
}

export function taxPaymentsSheet(rows: TaxPayment[], year: number, company?: string): SheetSpec[] {
  const s = new SheetBuilder(`Setoran Pajak ${year}`, {
    company,
    title: `Riwayat Setoran Pajak ${year}`,
    subtitle: [RP],
    columns: [
      { key: 'no', header: 'Nomor', fmt: 'code', width: 18 },
      { key: 'date', header: 'Tanggal', fmt: 'date', width: 12 },
      { key: 'type', header: 'Jenis pajak', width: 24 },
      { key: 'period', header: 'Masa', width: 10 },
      money('amt', 'Jumlah disetor'),
      { key: 'bill', header: 'Kode billing', fmt: 'code', width: 18 },
      { key: 'ntpn', header: 'NTPN', fmt: 'code', width: 18 },
      { key: 'acct', header: 'Dibayar dari', width: 22 },
    ],
    filter: true,
  });
  const a = s.next;
  for (const p of rows)
    s.row({
      no: p.number,
      date: d(p.date),
      type: TAX_PAYMENT_LABELS[p.type] ?? p.type,
      period: p.period,
      amt: n(p.amount),
      bill: p.billingCode ?? '',
      ntpn: p.ntpn ?? '',
      acct: p.cashAccount?.name ?? '',
    });
  s.totals('Jumlah', a, s.next - 1, ['amt'], {
    style: 'grand',
    labelKey: 'type',
    cache: { amt: total(rows.map((x) => n(x.amount))) },
  });
  return [s.spec];
}

export function fiscalSheets(f: FiscalReconciliation, company?: string): SheetSpec[] {
  const s = new SheetBuilder('Rekonsiliasi Fiskal', {
    company,
    title: `Rekonsiliasi Fiskal & PPh Badan Tahun ${f.year}`,
    subtitle: [
      `${f.scheme === 'FINAL_UMKM' ? 'Skema PPh final UMKM' : 'Skema umum'} · ${f.legalForm} · ${basis(f.framework)}`,
      RP,
    ],
    columns: [{ key: 'label', header: 'Uraian', width: 64 }, money('amt', 'Jumlah', 20)],
    landscape: false,
  });
  const pbt = s.row({ label: 'Laba (rugi) sebelum pajak — komersial', amt: n(f.profitBeforeTax) }, 'subtotal');
  s.section('Koreksi fiskal positif');
  const p1 = s.next;
  for (const i of f.positive) s.row({ label: i.label, amt: n(i.amount) }, 'body', 1);
  const pos = s.row(
    { label: 'Jumlah koreksi positif', amt: s.sum('amt', p1, s.next - 1, n(f.totalPositive)) },
    'subtotal',
  );
  s.section('Koreksi fiskal negatif');
  const n1 = s.next;
  for (const i of f.negative) s.row({ label: i.label, amt: n(i.amount) }, 'body', 1);
  const neg = s.row(
    { label: 'Jumlah koreksi negatif', amt: s.sum('amt', n1, s.next - 1, n(f.totalNegative)) },
    'subtotal',
  );
  const A = (r: number) => s.ref('amt', r);
  const fp = s.row(
    {
      label: 'Laba (rugi) fiskal',
      amt: s.verified(
        `${A(pbt)}+${A(pos)}-${A(neg)}`,
        n(f.fiscalProfit),
        (n(f.profitBeforeTax) ?? 0) + (n(f.totalPositive) ?? 0) - (n(f.totalNegative) ?? 0),
      ),
    },
    'total',
  );
  const loss = s.row({ label: 'Kompensasi kerugian tahun lalu', amt: n(f.lossCarryforward) }, 'body', 1);
  const pkpJs = Math.max(0, Math.floor(((n(f.fiscalProfit) ?? 0) - (n(f.lossCarryforward) ?? 0)) / 1000) * 1000);
  const pkp = s.row(
    {
      label: 'Penghasilan kena pajak (dibulatkan ke ribuan)',
      amt: s.verified(`MAX(0,ROUNDDOWN(${A(fp)}-${A(loss)},-3))`, n(f.pkp), pkpJs),
    },
    'subtotal',
  );
  s.row({ label: 'Peredaran bruto', amt: n(f.grossRevenue) }, 'body', 1);
  if (n(f.facilitatedPkp))
    s.row({ label: 'PKP yang mendapat fasilitas Pasal 31E', amt: n(f.facilitatedPkp) }, 'body', 1);
  const due = s.row({ label: `PPh terutang (${f.method})`, amt: n(f.taxDue) }, 'subtotal');
  const cr = s.row(
    { label: 'Kredit pajak (PPh 22, 23, 25 yang sudah dibayar/dipotong)', amt: n(f.credits) },
    'body',
    1,
  );
  s.row(
    {
      label: 'PPh Pasal 29 (kurang/lebih bayar)',
      amt: s.verified(`${A(due)}-${A(cr)}`, n(f.pph29), (n(f.taxDue) ?? 0) - (n(f.credits) ?? 0)),
    },
    'grand',
  );
  s.row({ label: 'Angsuran PPh Pasal 25 per bulan tahun berikutnya', amt: n(f.installment25) }, 'body');
  void pkp;
  if (f.warnings.length) {
    s.blank();
    for (const w of f.warnings) s.note(`Catatan: ${w}`);
  }

  const dep = new SheetBuilder('Penyusutan Fiskal', {
    company,
    title: `Perbandingan Penyusutan Komersial & Fiskal ${f.year}`,
    subtitle: [RP],
    columns: [
      { key: 'code', header: 'Kode', fmt: 'code', width: 10 },
      { key: 'name', header: 'Aset', width: 32 },
      { key: 'cat', header: 'Kategori', width: 16 },
      { key: 'grp', header: 'Kelompok fiskal', width: 22 },
      money('cost', 'Harga perolehan'),
      money('com', 'Penyusutan komersial'),
      money('fis', 'Penyusutan fiskal'),
      money('dif', 'Selisih (komersial − fiskal)'),
      money('cbv', 'Nilai buku komersial'),
      money('fbv', 'Nilai sisa buku fiskal'),
    ],
    filter: true,
    freezeCols: 2,
  });
  const d1 = dep.next;
  for (const r of f.depreciation) {
    const row = dep.next;
    dep.row({
      code: r.code,
      name: r.name,
      cat: r.category,
      grp: FISCAL_ASSET_GROUP_INFO[r.fiscalGroup as FiscalAssetGroup]?.label ?? r.fiscalGroup,
      cost: n(r.cost),
      com: n(r.commercial),
      fis: n(r.fiscal),
      dif: dep.verified(
        `${dep.ref('com', row)}-${dep.ref('fis', row)}`,
        n(r.difference),
        (n(r.commercial) ?? 0) - (n(r.fiscal) ?? 0),
      ),
      cbv: n(r.commercialBookValue),
      fbv: n(r.fiscalBookValue),
    });
  }
  const sumOf = (k: 'cost' | 'commercial' | 'fiscal' | 'difference' | 'commercialBookValue' | 'fiscalBookValue') =>
    total(f.depreciation.map((x) => n(x[k])));
  dep.totals('Jumlah', d1, dep.next - 1, ['cost', 'com', 'fis', 'dif', 'cbv', 'fbv'], {
    style: 'grand',
    labelKey: 'name',
    cache: {
      cost: sumOf('cost'),
      com: sumOf('commercial'),
      fis: sumOf('fiscal'),
      dif: sumOf('difference'),
      cbv: sumOf('commercialBookValue'),
      fbv: sumOf('fiscalBookValue'),
    },
  });
  return [s.spec, dep.spec];
}

// ============ Aset tetap ============
export function fixedAssetsSheet(rows: FixedAsset[], asOf: string, company?: string): SheetSpec[] {
  const s = new SheetBuilder('Aset Tetap', {
    company,
    title: 'Daftar Aset Tetap',
    subtitle: [`Per ${tgl(asOf)}`, RP],
    columns: [
      { key: 'code', header: 'Kode', fmt: 'code', width: 10 },
      { key: 'name', header: 'Nama aset', width: 34 },
      { key: 'cat', header: 'Kategori', width: 16 },
      { key: 'date', header: 'Tgl perolehan', fmt: 'date', width: 12 },
      money('cost', 'Harga perolehan'),
      money('res', 'Nilai residu'),
      { key: 'life', header: 'Umur (bulan)', fmt: 'int', width: 9 },
      money('acc', 'Akumulasi penyusutan'),
      money('bv', 'Nilai buku'),
      { key: 'loc', header: 'Lokasi', width: 16 },
      { key: 'status', header: 'Status', width: 10 },
    ],
    filter: true,
    freezeCols: 2,
  });
  const a = s.next;
  for (const x of rows) {
    const r = s.next;
    s.row({
      code: x.code,
      name: x.name,
      cat: x.category.name,
      date: d(x.acquisitionDate),
      cost: n(x.cost),
      res: n(x.residualValue),
      life: x.usefulLifeMonths,
      acc: n(x.accumulated),
      bv:
        x.status === 'ACTIVE'
          ? s.verified(
              `${s.ref('cost', r)}-${s.ref('acc', r)}`,
              n(x.bookValue),
              (n(x.cost) ?? 0) - (n(x.accumulated) ?? 0),
            )
          : n(x.bookValue),
      loc: x.location ?? '',
      status: x.status === 'ACTIVE' ? 'Aktif' : 'Dilepas',
    });
  }
  s.totals(`Jumlah (${rows.length} aset)`, a, s.next - 1, ['cost', 'res', 'acc', 'bv'], {
    style: 'grand',
    labelKey: 'name',
    cache: {
      cost: total(rows.map((x) => n(x.cost))),
      res: total(rows.map((x) => n(x.residualValue))),
      acc: total(rows.map((x) => n(x.accumulated))),
      bv: total(rows.map((x) => n(x.bookValue))),
    },
  });
  return [s.spec];
}

/** Daftar pemeriksaan fisik (stok opname) aset tetap: kolom hasil dikosongkan untuk diisi tangan, lalu dicocokkan ke SANSU */
export function assetCountSheet(rows: FixedAsset[], asOf: string, company?: string): SheetSpec[] {
  const label = { FOUND: 'Ada', DAMAGED: 'Rusak', MISSING: 'Hilang' } as const;
  const s = new SheetBuilder('Pemeriksaan Fisik', {
    company,
    title: 'Daftar Pemeriksaan Fisik Aset Tetap',
    subtitle: [`Per ${tgl(asOf)}`, 'Beri tanda pada kolom Kondisi: Ada / Rusak / Hilang. Catat lokasi sebenarnya bila berpindah.'],
    columns: [
      { key: 'no', header: 'No', fmt: 'int', width: 5 },
      { key: 'code', header: 'Kode', fmt: 'code', width: 11 },
      { key: 'name', header: 'Nama aset', width: 32 },
      { key: 'cat', header: 'Kategori', width: 16 },
      { key: 'loc', header: 'Lokasi tercatat', width: 16 },
      { key: 'who', header: 'Penanggung jawab', width: 18 },
      { key: 'last', header: 'Diperiksa terakhir', width: 18 },
      { key: 'cond', header: 'Kondisi (Ada/Rusak/Hilang)', width: 18 },
      { key: 'realLoc', header: 'Lokasi sebenarnya', width: 18 },
      { key: 'note', header: 'Catatan', width: 24 },
      { key: 'sign', header: 'Paraf', width: 10 },
    ],
    filter: true,
    freezeCols: 3,
  });
  rows.forEach((x, i) => {
    s.row({
      no: i + 1,
      code: x.code,
      name: x.name,
      cat: x.category.name,
      loc: x.location ?? '',
      who: x.custodian ?? '',
      last: x.lastVerifiedAt && x.verificationStatus ? `${label[x.verificationStatus]} · ${tgl(x.lastVerifiedAt.slice(0, 10))}` : 'Belum pernah',
      cond: '',
      realLoc: '',
      note: '',
      sign: '',
    });
  });
  return [s.spec];
}

/** Daftar transaksi kas & bank (sesuai filter di layar) */
export function cashListSheet(rows: CashTransaction[], range: { from: string; to: string }, company?: string): SheetSpec[] {
  const s = new SheetBuilder('Kas & Bank', {
    company,
    title: 'Transaksi Kas & Bank',
    subtitle: [`Periode ${tgl(range.from)} s/d ${tgl(range.to)}`, RP],
    columns: [
      { key: 'no', header: 'Nomor', fmt: 'code', width: 18 },
      { key: 'date', header: 'Tanggal', fmt: 'date', width: 12 },
      { key: 'type', header: 'Jenis', width: 12 },
      { key: 'acc', header: 'Kas / bank', width: 22 },
      { key: 'desc', header: 'Keterangan', width: 34 },
      { key: 'ref', header: 'No. bukti', width: 16 },
      { key: 'branch', header: 'Cabang', width: 18 },
      { key: 'status', header: 'Status', width: 12 },
      { key: 'in', header: 'Masuk', fmt: 'money', width: 16 },
      { key: 'out', header: 'Keluar', fmt: 'money', width: 16 },
    ],
    filter: true,
    freezeCols: 2,
  });
  const live = rows.filter((r) => r.status !== 'VOID');
  rows.forEach((r) =>
    s.row({
      no: r.number,
      date: new Date(`${r.date}T00:00:00`),
      type: r.type === 'IN' ? 'Kas masuk' : r.type === 'OUT' ? 'Kas keluar' : 'Transfer',
      acc: r.toCashAccount ? `${r.cashAccount.name} → ${r.toCashAccount.name}` : r.cashAccount.name,
      desc: r.description,
      ref: r.reference ?? '',
      branch: r.branchName ?? '',
      status: r.status === 'VOID' ? 'Dibatalkan' : 'Diposting',
      in: r.type === 'IN' && r.status !== 'VOID' ? Number(r.amount) : 0,
      out: r.type === 'OUT' && r.status !== 'VOID' ? Number(r.amount) : 0,
    }),
  );
  void live;
  return [s.spec];
}

/** Rekap PPN keluaran langganan SANSU per bulan (Panel SANSU) — bahan faktur pajak Coretax */
export function subscriptionVatSheet(rows: VatReportRow[], month: string, seller?: string): SheetSpec[] {
  const [y, m] = month.split('-').map(Number);
  const s = new SheetBuilder(`PPN ${month}`, {
    company: seller,
    title: `Rekap PPN Keluaran Langganan — ${BULAN[m - 1]} ${y}`,
    subtitle: [RP, 'Tagihan yang lunas pada bulan ini'],
    columns: [
      { key: 'no', header: 'Nomor invoice', fmt: 'code', width: 20 },
      { key: 'date', header: 'Tgl lunas', fmt: 'date', width: 12 },
      { key: 'buyer', header: 'Pembeli', width: 30 },
      { key: 'npwp', header: 'NPWP pembeli', fmt: 'code', width: 22 },
      { key: 'plan', header: 'Paket', width: 16 },
      money('dpp', 'DPP'),
      { key: 'rate', header: 'Tarif %', fmt: 'dec', width: 8 },
      money('vat', 'PPN'),
      money('amt', 'Total'),
    ],
    filter: true,
  });
  const a = s.next;
  for (const r of rows) {
    const row = s.next;
    const dpp = n(r.subtotal) ?? 0;
    const vat = n(r.vatAmount) ?? 0;
    s.row({
      no: r.number,
      date: d(r.paidAt?.slice(0, 10)),
      buyer: r.buyer,
      npwp: r.buyerNpwp ?? '',
      plan: `${r.plan} · ${r.cycle === 'YEARLY' ? 'tahunan' : 'bulanan'}`,
      dpp,
      rate: n(r.vatRate),
      vat,
      amt: s.verified(`${s.ref('dpp', row)}+${s.ref('vat', row)}`, n(r.amount), dpp + vat),
    });
  }
  s.totals('Jumlah', a, s.next - 1, ['dpp', 'vat', 'amt'], {
    style: 'grand',
    labelKey: 'buyer',
    cache: {
      dpp: total(rows.map((x) => n(x.subtotal))),
      vat: total(rows.map((x) => n(x.vatAmount))),
      amt: total(rows.map((x) => n(x.amount))),
    },
  });
  return [s.spec];
}

/** Berita acara opname kas: pecahan × jumlah berumus, pos rekonsiliasi, saldo buku, selisih */
export function cashCountSheet(c: CashCount, company?: string): SheetSpec[] {
  const s = new SheetBuilder(`Opname ${c.number}`.replace(/\//g, '-'), {
    company,
    title: `Berita Acara Opname Kas — ${c.account.code} ${c.account.name}`,
    subtitle: [`Nomor ${c.number} · per ${tgl(c.date)}`, RP],
    columns: [
      { key: 'label', header: 'Uraian', width: 40 },
      { key: 'den', header: 'Pecahan', fmt: 'int', width: 12 },
      { key: 'qty', header: 'Jumlah', fmt: 'int', width: 10 },
      money('val', 'Nilai', 18),
    ],
  });
  s.section('Uang fisik');
  const a = s.next;
  for (const d of CASH_DENOMINATIONS) {
    const q = c.denominations[d.key] ?? 0;
    const r = s.next;
    s.row({ label: `Uang ${d.kind.toLowerCase()} ${d.value.toLocaleString('id-ID')}`, den: d.value, qty: q, val: s.fx(`${s.ref('den', r)}*${s.ref('qty', r)}`, d.value * q) });
  }
  const physical = s.totals('Jumlah uang fisik', a, s.next - 1, ['val'], { style: 'subtotal', cache: { val: n(c.countedTotal) } });
  const adjRows: (number | { row: number; neg: true })[] = [physical];
  if (c.items.length) {
    s.section('Pos rekonsiliasi');
    for (const i of c.items) {
      const r = s.row({ label: `${i.type === 'ADD' ? '(+)' : '(−)'} ${i.description}`, val: n(i.amount) });
      adjRows.push(i.type === 'ADD' ? r : { row: r, neg: true });
    }
  }
  const adjusted = s.row({ label: 'Kas menurut hasil opname', val: s.add('val', adjRows, n(c.countedTotal)! + n(c.itemsTotal)!) }, 'total');
  const book = s.row({ label: 'Saldo kas menurut pembukuan', val: n(c.bookBalance) });
  s.row({ label: Number(c.difference) < 0 ? 'Selisih (kurang)' : 'Selisih (lebih)', val: s.verified(`${s.ref('val', adjusted)}-${s.ref('val', book)}`, n(c.difference), (n(c.countedTotal)! + n(c.itemsTotal)!) - n(c.bookBalance)!) }, 'grand');
  if (c.reason) s.note(`Penjelasan selisih: ${c.reason}`);
  if (c.custodianName) s.note(`Pemegang kas: ${c.custodianName}`);
  return [s.spec];
}

const RECAP_STATUS: Record<string, string> = {
  NIHIL: 'Nihil',
  TEPAT: 'Tepat waktu',
  TERLAMBAT: 'Disetor terlambat',
  KURANG: 'Kurang setor',
  KURANG_TERLAMBAT: 'Kurang setor, lewat jatuh tempo',
  BELUM: 'Belum disetor',
  TERLAMBAT_BELUM: 'Belum disetor, lewat jatuh tempo',
  LEBIH_BAYAR: 'Lebih bayar (dikompensasi)',
  BELUM_MASA: '-',
};

/** Rekap pajak & BPJS tahunan: lembar ringkasan (matriks) + satu lembar rinci per jenis */
export function annualTaxSheets(r: AnnualTaxRecap, company?: string): SheetSpec[] {
  const s = new SheetBuilder(`Rekap Pajak ${r.year}`, {
    company,
    title: `Rekap Pajak & BPJS Tahun ${r.year}`,
    subtitle: [RP, 'Terutang dari buku besar; disetor dari catatan setoran (NTPN). Selisih = terutang − disetor'],
    columns: [{ key: 'masa', header: 'Masa', width: 14 }, ...r.types.flatMap((t) => [money(`${t.type}_u`, 'Terutang', 15), money(`${t.type}_s`, 'Disetor', 15), money(`${t.type}_d`, 'Selisih', 13)])],
    groups: r.types.map((t) => ({ label: t.label, from: `${t.type}_u`, to: `${t.type}_d` })),
    freezeCols: 1,
    landscape: true,
  });
  const a = s.next;
  for (let i = 0; i < 12; i++) {
    const row = s.next;
    const v: Record<string, Val> = { masa: `${BULAN[i]} ${r.year}` };
    for (const t of r.types) {
      const c = t.months[i];
      const target = t.type === 'PPN' && Number(c.payable) < 0 ? 0 : n(c.payable);
      v[`${t.type}_u`] = target;
      v[`${t.type}_s`] = n(c.paid);
      v[`${t.type}_d`] = s.fx(`${s.ref(`${t.type}_u`, row)}-${s.ref(`${t.type}_s`, row)}`, n(c.diff));
    }
    s.row(v);
  }
  s.totals(
    'Jumlah',
    a,
    s.next - 1,
    r.types.flatMap((t) => [`${t.type}_u`, `${t.type}_s`, `${t.type}_d`]),
    { style: 'grand' },
  );
  s.note('PPN: terutang = PPN keluaran − PPN masukan − kompensasi lebih bayar masa sebelumnya; masa lebih bayar ditulis 0.');
  const sheets = [s.spec];

  for (const t of r.types) {
    const d1 = new SheetBuilder(t.label, {
      company,
      title: `Rekap ${t.label} ${r.year}`,
      subtitle: [RP],
      columns: [
        { key: 'masa', header: 'Masa', width: 14 },
        ...(t.type === 'PPN'
          ? [money('out', 'PPN keluaran'), money('in', 'PPN masukan'), money('comp', 'Kompensasi')]
          : t.type === 'PPH_FINAL'
            ? [money('gross', 'Peredaran bruto')]
            : []),
        money('u', 'Terutang'),
        money('p', 'Disetor'),
        money('dd', 'Selisih'),
        { key: 'due', header: 'Jatuh tempo setor', fmt: 'date', width: 13 },
        { key: 'paid', header: 'Tanggal setor', fmt: 'date', width: 13 },
        { key: 'ntpn', header: 'NTPN', fmt: 'code', width: 22 },
        { key: 'st', header: 'Status', width: 30 },
      ],
    });
    const b = d1.next;
    t.months.forEach((c, i) => {
      const row = d1.next;
      const v: Record<string, Val> = {
        masa: `${BULAN[i]} ${r.year}`,
        u: t.type === 'PPN' && Number(c.payable) < 0 ? 0 : n(c.payable),
        p: n(c.paid),
        due: d(c.dueDate),
        paid: d(c.paidDate),
        ntpn: c.ntpn ?? '',
        st: RECAP_STATUS[c.status] ?? c.status,
      };
      if (t.type === 'PPN') {
        v.out = n(c.detail?.keluaran);
        v.in = n(c.detail?.masukan);
        v.comp = n(c.detail?.kompensasi);
        const calc = (v.out as number) - (v.in as number) - (v.comp as number);
        v.u = calc < 0 ? 0 : d1.verified(`MAX(0,${d1.ref('out', row)}-${d1.ref('in', row)}-${d1.ref('comp', row)})`, n(c.payable), calc);
      }
      if (t.type === 'PPH_FINAL') {
        v.gross = n(c.detail?.peredaranBruto);
        v.u = d1.verified(`ROUNDDOWN(${d1.ref('gross', row)}*0.5%,0)`, n(c.payable), Math.floor(((v.gross as number) ?? 0) * 0.005));
      }
      v.dd = d1.fx(`${d1.ref('u', row)}-${d1.ref('p', row)}`, n(c.diff));
      d1.row(v);
    });
    d1.totals('Jumlah', b, d1.next - 1, ['u', 'p', 'dd', ...(t.type === 'PPN' ? ['out', 'in'] : t.type === 'PPH_FINAL' ? ['gross'] : [])], { style: 'grand' });
    sheets.push(d1.spec);
  }
  return sheets;
}

/** Rekap PPh 23 / 4(2) yang dipotong — bahan bukti potong e-Bupot Unifikasi */
export function withholdingSheets(w: WithholdingRecap, company?: string): SheetSpec[] {
  const label = /^\d{4}$/.test(w.period) ? `Tahun ${w.period}` : `Masa ${BULAN[Number(w.period.slice(5, 7)) - 1]} ${w.period.slice(0, 4)}`;
  const s = new SheetBuilder('Daftar Pemotongan', {
    company,
    title: 'Daftar Pemotongan PPh 23 & PPh 4 ayat (2)',
    subtitle: [label, RP],
    columns: [
      { key: 'jenis', header: 'Jenis', width: 10 },
      { key: 'tgl', header: 'Tanggal', fmt: 'date', width: 12 },
      { key: 'no', header: 'No. faktur', fmt: 'code', width: 18 },
      { key: 'ref', header: 'No. tagihan supplier', fmt: 'code', width: 18 },
      { key: 'sup', header: 'Nama dipotong', width: 28 },
      { key: 'npwp', header: 'NPWP / NIK', fmt: 'code', width: 22 },
      { key: 'uraian', header: 'Uraian', width: 28 },
      money('dpp', 'DPP'),
      { key: 'tarif', header: 'Tarif %', fmt: 'dec', width: 8 },
      money('pph', 'PPh dipotong'),
    ],
    filter: true,
  });
  const a = s.next;
  for (const r of w.rows) {
    const row = s.next;
    s.row({
      jenis: r.type === 'PPH23' ? 'PPh 23' : 'PPh 4(2)',
      tgl: d(r.date),
      no: r.number,
      ref: r.supplierInvoiceNo,
      sup: r.supplierName,
      npwp: r.supplierNpwp ?? '(belum ada)',
      uraian: r.description ?? '',
      dpp: n(r.base),
      tarif: n(r.rate),
      pph: s.verified(`ROUND(${s.ref('dpp', row)}*${s.ref('tarif', row)}/100,2)`, n(r.amount), Math.round((n(r.base) ?? 0) * (n(r.rate) ?? 0)) / 100),
    });
  }
  s.totals('Jumlah', a, s.next - 1, ['dpp', 'pph'], { style: 'grand', labelKey: 'sup' });
  s.blank();
  s.heading('Ringkasan');
  for (const x of w.summary) {
    s.row({ sup: `${x.label} — ${x.count} transaksi`, dpp: n(x.base), pph: n(x.amount) }, 'subtotal');
    s.row({ sup: `   Saldo buku besar ${x.label}`, pph: n(x.ledger) });
    const r1 = s.next - 2;
    const r2 = s.next - 1;
    const chk = s.row({ sup: '   Selisih (harus 0)', pph: s.fx(`${s.ref('pph', r2)}-${s.ref('pph', r1)}`, n(x.unexplained)) });
    s.check(s.ref('pph', chk));
  }
  if (w.missingNpwp.length) s.note(`Belum ada NPWP/NIK: ${w.missingNpwp.join(', ')} — lengkapi di data supplier (tanpa NPWP, tarif PPh 23 menjadi 100% lebih tinggi).`);
  return [s.spec];
}

/** Rekap iuran BPJS per karyawan — cocokkan dengan tagihan SIPP & e-Dabu */
export function bpjsSheets(b: BpjsRecap, company?: string): SheetSpec[] {
  const [y, m] = b.period.split('-').map(Number);
  const s = new SheetBuilder(`BPJS ${b.period}`, {
    company,
    title: `Rekap Iuran BPJS — ${BULAN[m - 1]} ${y}`,
    subtitle: [RP, `Penggajian ${b.run?.number ?? '-'}`],
    columns: [
      { key: 'code', header: 'Kode', fmt: 'code', width: 10 },
      { key: 'name', header: 'Nama', width: 24 },
      { key: 'nik', header: 'NIK', fmt: 'code', width: 18 },
      money('wage', 'Dasar upah'),
      money('kesC', 'Perusahaan 4%', 13),
      money('kesE', 'Karyawan 1%', 13),
      money('jhtC', 'JHT 3,7%', 13),
      money('jhtE', 'JHT 2%', 13),
      money('jkk', `JKK ${b.caps.jkkRate}%`, 12),
      money('jkm', `JKM ${b.caps.jkmRate}%`, 12),
      money('jpC', 'JP 2%', 12),
      money('jpE', 'JP 1%', 12),
      money('kes', 'Total Kesehatan', 15),
      money('tk', 'Total Ketenagakerjaan', 17),
    ],
    groups: [
      { label: 'BPJS Kesehatan', from: 'kesC', to: 'kesE' },
      { label: 'BPJS Ketenagakerjaan', from: 'jhtC', to: 'jpE' },
    ],
    freezeCols: 2,
    landscape: true,
  });
  const a = s.next;
  for (const r of b.rows) {
    const row = s.next;
    const kes = Number(r.kesCompany) + Number(r.kesEmployee);
    const tk = Number(r.jhtCompany) + Number(r.jhtEmployee) + Number(r.jkkCompany) + Number(r.jkmCompany) + Number(r.jpCompany) + Number(r.jpEmployee);
    s.row({
      code: r.code,
      name: r.name,
      nik: r.nik ?? '',
      wage: n(r.wage),
      kesC: n(r.kesCompany),
      kesE: n(r.kesEmployee),
      jhtC: n(r.jhtCompany),
      jhtE: n(r.jhtEmployee),
      jkk: n(r.jkkCompany),
      jkm: n(r.jkmCompany),
      jpC: n(r.jpCompany),
      jpE: n(r.jpEmployee),
      kes: s.fx(`${s.ref('kesC', row)}+${s.ref('kesE', row)}`, kes),
      tk: s.fx(`SUM(${s.ref('jhtC', row)}:${s.ref('jpE', row)})`, tk),
    });
  }
  const tot = s.totals('Jumlah', a, s.next - 1, ['wage', 'kesC', 'kesE', 'jhtC', 'jhtE', 'jkk', 'jkm', 'jpC', 'jpE', 'kes', 'tk'], { style: 'grand', labelKey: 'name' });
  s.blank();
  s.row({ name: 'Bayar ke BPJS Kesehatan', tk: s.fx(s.ref('kes', tot), n(b.kesehatan)) }, 'subtotal');
  s.note(`Jatuh tempo ${tgl(b.dueKesehatan)}`);
  s.row({ name: 'Bayar ke BPJS Ketenagakerjaan', tk: s.fx(s.ref('tk', tot), n(b.ketenagakerjaan)) }, 'subtotal');
  s.note(`Jatuh tempo ${tgl(b.dueKetenagakerjaan)}`);
  s.note(`Batas upah: BPJS Kesehatan Rp${b.caps.kesehatan.toLocaleString('id-ID')}, Jaminan Pensiun Rp${b.caps.jp.toLocaleString('id-ID')} (sesuaikan di Pengaturan penggajian bila ada perubahan).`);
  for (const c of b.changes) s.note(`${c.kind === 'MASUK' ? 'Peserta baru' : 'Peserta keluar'}: ${c.code} ${c.name} (${tgl(c.date)}) — laporkan ke BPJS.`);
  return [s.spec];
}
