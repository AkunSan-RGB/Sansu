/**
 * Lembar Excel untuk setiap laporan SANSU. Semua fungsi murni: data API → SheetSpec.
 * Angka turunan ditulis sebagai rumus (dengan nilai hasil), angka sumber sebagai nilai.
 */
import { ScheduleResult } from '@/api/types';
import { CASH_DENOMINATIONS, type CashCount, type CashTransaction, type FixedAsset } from '@sansu/shared';
import { d, n, SheetBuilder, total, type SheetSpec } from './book';
import { tgl, RP, money, type DocLike, documentSheet } from './reports.shared';

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
/** Rincian satu akun (metode + tabel rincian dan perhitungan) sebagai lampiran Excel */
export function scheduleSheet(r: ScheduleResult, company?: string): SheetSpec[] {
  const method = { number: '', title: 'Metode', paragraphs: [r.method.basis, ...r.method.formulas.map((f) => `• ${f}`), ...(r.method.policies ?? []).map((f) => `• ${f}`)], tables: [] };
  const compare = {
    number: '',
    title: 'Pencocokan dengan laporan keuangan',
    paragraphs: r.findings,
    tables: [{ columns: ['Saldo akhir di laporan keuangan', 'Saldo akhir menurut rincian', 'Selisih'], align: ['right', 'right', 'right'] as ('left' | 'right')[], rows: [[Number(r.reported), Number(r.computed), Number(r.difference)]] }],
  };
  const tables = r.tables.map((t, i) => ({
    number: '',
    title: t.title,
    paragraphs: t.note ? [t.note] : [],
    tables: [
      {
        columns: t.columns.map((c) => c.title),
        align: t.columns.map((c) => (c.kind === 'text' || c.kind === 'date' ? 'left' : 'right')) as ('left' | 'right')[],
        rows: t.rows.map((row) => t.columns.map((c) => (c.kind === 'money' || c.kind === 'qty' || c.kind === 'percent' ? (row.cells[c.key] == null ? null : Number(row.cells[c.key])) : (row.cells[c.key] ?? null)))),
        total: t.total ? t.columns.map((c, ci) => (ci === 0 && t.total![c.key] == null ? 'Jumlah' : c.kind === 'money' || c.kind === 'qty' ? (t.total![c.key] == null ? null : Number(t.total![c.key])) : (t.total![c.key] ?? null))) : undefined,
      },
    ],
    key: `t${i}`,
  }));
  const doc = { framework: 'SAK_EP', period: { from: r.period.from, to: r.period.to }, company: { name: company ?? '' }, sections: [compare, ...tables, method] } as DocLike;
  return documentSheet('Rincian akun', `${r.account.code} ${r.account.name}`.trim(), doc, company, [`Periode ${tgl(r.period.from)} s/d ${tgl(r.period.to)}`, RP]);
}
