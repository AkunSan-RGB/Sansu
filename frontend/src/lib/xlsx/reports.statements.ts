/**
 * Lembar Excel untuk setiap laporan SANSU. Semua fungsi murni: data API → SheetSpec.
 * Angka turunan ditulis sebagai rumus (dengan nilai hasil), angka sumber sebagai nilai.
 */
import { SupportReport, JOURNAL_SOURCE_LABELS, statementTitle, type CashFlowStatement, type EquityStatement, type FinancialAppendix, type FinancialNotes, type FinancialPosition, type FullTrialBalance, type IncomeStatement, type LedgerReport, type StatementLine, type Worksheet } from '@sansu/shared';
import { d, n, SheetBuilder, type Column, type SheetSpec, type Val } from './book';
import { conclusionParagraphs } from '../conclusionText';
import { tgl, periodeText, RP, money, DK, max0, type StatementMeta, basis, type DocLike, documentSheet } from './reports.shared';

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
export function notesSheet(nt: FinancialNotes, company?: string): SheetSpec[] {
  return documentSheet('CALK', statementTitle('notes', nt.framework), nt, company);
}
export function appendixSheet(ap: FinancialAppendix, company?: string): SheetSpec[] {
  return documentSheet('Lampiran', 'Lampiran Laporan Keuangan', ap, company);
}
/** Laporan pendukung (penjualan, pembelian, persediaan, kas, akun lain) beserta tabel pencocokan buku besar */
export function supportSheet(r: SupportReport, framework: FinancialNotes['framework'], company?: string): SheetSpec[] {
  const recon = {
    number: '',
    title: 'Pencocokan dengan buku besar',
    paragraphs: [],
    tables: [
      {
        columns: ['Pencocokan', 'Rincian (dokumen/kartu)', 'Buku besar', 'Selisih', 'Status'],
        align: ['left', 'right', 'right', 'right', 'left'] as ('left' | 'right')[],
        rows: r.reconciliation.map((x) => [x.title, x.left.value, x.right.value, x.diff, x.ok ? 'Cocok' : 'Selisih']),
      },
    ],
  };
  const conclusion = { number: '', title: 'Kesimpulan dan saran', paragraphs: conclusionParagraphs(r.conclusion), tables: [] };
  return documentSheet('Pendukung', r.title, { framework, period: r.period, company: { name: company ?? '' }, sections: [recon, ...r.sections, conclusion] } as DocLike, company, [`Periode ${tgl(r.period.from)} s/d ${tgl(r.period.to)}`, RP]);
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
