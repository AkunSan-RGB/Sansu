import { JOURNAL_SOURCE_LABELS, type JournalSource } from '@sansu/shared';
import { D, Dec, ZERO } from '../../../common/utils/money';
import { DbOrTx } from '../../../db/db';
import { AccountSchedulesRepository } from '../account-schedules.repository';
import { col, money, netOf, openingOf } from '../account-schedule.support';
import type { ScheduleContext, ScheduleRow, ScheduleTable } from '../account-schedule.types';

const label = (s: string) => JOURNAL_SOURCE_LABELS[s as JournalSource] ?? s;
const LIST_LIMIT = 1000;
const NO_PARTY = 'Tanpa pihak (jurnal manual, kas, pajak, penyesuaian)';

/** Jenis jadwal yang sudah berupa kartu pembantu/register sendiri (kartu stok, daftar aset): daftar dokumen tidak diulang */
export const SKIP_DOCUMENT_TABLES = new Set(['INVENTORY', 'FIXED_ASSET_COST', 'FIXED_ASSET_ACCUMULATED', 'DEPRECIATION_EXPENSE', 'UNCLOSED_EARNINGS']);

/**
 * Daftar dan rincian dari dokumen sumber, disusun sebelum menjadi angka di laporan keuangan: setiap baris jurnal akun ini ditelusuri ke
 * dokumennya (faktur, pembayaran, retur, kas, kasir, penggajian, aset, ...), lalu direkap per pihak dan per jenis dokumen. Jumlahnya
 * (saldo awal + mutasi) sama dengan saldo akun di laporan keuangan. Akun penjualan/HPP ditambah rekap per produk, akun gaji per karyawan.
 */
export async function documentTables(db: DbOrTx, repo: AccountSchedulesRepository, cx: ScheduleContext): Promise<ScheduleTable[]> {
  const a = cx.account;
  const rows = (await repo.documentLines(db, cx.tenantId, a.id, cx.from, cx.to)).rows;
  const opening = openingOf(a, cx.movement);
  const debitNormal = a.type === 'ASSET' || a.type === 'EXPENSE';
  const calc = rows.map((r) => {
    const debit = D(r.debit);
    const credit = D(r.credit);
    return { ...r, add: debitNormal ? debit : credit, sub: debitNormal ? credit : debit, net: netOf(a.type, debit, credit) };
  });
  const totalNet = calc.reduce((s, r) => s.plus(r.net), ZERO);
  const tables: ScheduleTable[] = [];
  if (!calc.length && opening.isZero()) return tables;

  const nominal = a.type === 'REVENUE' || a.type === 'EXPENSE';
  const list: ScheduleRow[] = calc.slice(-LIST_LIMIT).map((r) => ({
    cells: { date: r.date, doc: r.doc_no, type: label(r.st), party: r.party, note: r.note, amount: money(r.net) },
    link: `/journals?q=${encodeURIComponent(r.jn)}`,
  }));
  if (!nominal && !opening.isZero()) list.unshift({ cells: { date: null, doc: null, type: 'Saldo awal', party: null, note: 'Saldo sebelum 1 Januari (dari tahun-tahun sebelumnya)', amount: money(opening) } });
  tables.push({
    key: 'source-documents',
    title: 'Daftar dokumen sumber',
    note: `Setiap transaksi pada akun ini beserta dokumen asalnya${calc.length > LIST_LIMIT ? ` (${LIST_LIMIT} terbaru dari ${calc.length}; rekap di bawah mencakup semuanya)` : ''}. Klik baris untuk membuka jurnalnya.`,
    columns: [col('date', 'Tanggal', 'date'), col('doc', 'No. dokumen', 'text'), col('type', 'Jenis dokumen', 'text'), col('party', 'Pihak / objek', 'text'), col('note', 'Keterangan', 'text'), col('amount', 'Jumlah')],
    rows: list,
    total: { doc: nominal ? 'Jumlah tahun berjalan' : 'Saldo akhir (saldo awal + mutasi)', amount: money(opening.plus(totalNet)) },
  });

  const group = (key: (r: (typeof calc)[number]) => string) => {
    const m = new Map<string, { n: number; add: Dec; sub: Dec; net: Dec }>();
    for (const r of calc) {
      const k = key(r);
      const g = m.get(k) ?? { n: 0, add: ZERO, sub: ZERO, net: ZERO };
      g.n += 1;
      g.add = g.add.plus(r.add);
      g.sub = g.sub.plus(r.sub);
      g.net = g.net.plus(r.net);
      m.set(k, g);
    }
    return [...m.entries()].sort((x, y) => y[1].net.abs().comparedTo(x[1].net.abs()));
  };
  const addLabel = debitNormal ? 'Debit' : 'Kredit';
  const subLabel = debitNormal ? 'Kredit' : 'Debit';
  const recap = (key: string, title: string, head: string, entries: [string, { n: number; add: Dec; sub: Dec; net: Dec }][], note?: string): ScheduleTable => ({
    key,
    title,
    note,
    columns: [col('name', head, 'text'), col('n', 'Baris', 'qty'), col('add', addLabel), col('sub', subLabel), col('net', 'Neto')],
    rows: entries.slice(0, 200).map(([name, g]) => ({ cells: { name, n: g.n, add: money(g.add), sub: money(g.sub), net: money(g.net) } })),
    total: { name: 'Jumlah mutasi tahun berjalan', add: money(entries.reduce((s, [, g]) => s.plus(g.add), ZERO)), sub: money(entries.reduce((s, [, g]) => s.plus(g.sub), ZERO)), net: money(totalNet) },
  });
  const byParty = group((r) => r.party ?? NO_PARTY);
  if (byParty.some(([k]) => k !== NO_PARTY)) tables.push(recap('by-party', 'Rekap per pihak', 'Pelanggan / pemasok / objek', byParty, 'Pelanggan, pemasok, proyek, atau aset yang menjadi lawan transaksi.'));
  tables.push(recap('by-document-type', 'Rekap per jenis dokumen', 'Jenis dokumen', group((r) => label(r.st))));

  if (a.type === 'REVENUE') {
    const r = (await repo.salesByProduct(db, cx.tenantId, a.id, cx.from, cx.to)).rows;
    if (r.length) tables.push(productTable('by-product', 'Penjualan per produk', 'Nilai baris faktur/kasir sebelum PPN; selisih dengan akun berasal dari diskon, retur, atau akun pendapatan lain.', r));
  } else if (a.reportGroup === 'COST_OF_SALES') {
    const r = (await repo.cogsByProduct(db, cx.tenantId, a.id, cx.from, cx.to)).rows;
    if (r.length) tables.push(productTable('by-product', 'Harga pokok per produk', 'Dari mutasi stok keluar (jumlah × biaya rata-rata) pada dokumen yang menyentuh akun ini.', r));
  }
  if (a.type === 'EXPENSE' && calc.some((r) => r.st === 'PAYROLL')) {
    const r = (await repo.payrollByEmployee(db, cx.tenantId, a.id, cx.from, cx.to)).rows;
    if (r.length) {
      tables.push({
        key: 'by-employee',
        title: 'Rincian per karyawan (slip gaji)',
        note: 'Dari slip gaji pada penggajian yang menyentuh akun ini; gaji bruto per karyawan.',
        columns: [col('code', 'Kode', 'text'), col('name', 'Karyawan', 'text'), col('slips', 'Slip', 'qty'), col('gross', 'Gaji bruto'), col('net', 'Dibayar (neto)')],
        rows: r.map((x) => ({ cells: { code: x.code, name: x.name, slips: x.slips, gross: money(D(x.gross)), net: money(D(x.net)) } })),
        total: { name: 'Jumlah', gross: money(r.reduce((s, x) => s.plus(x.gross), ZERO)), net: money(r.reduce((s, x) => s.plus(x.net), ZERO)) },
      });
    }
  }
  return tables;
}

function productTable(key: string, title: string, note: string, r: { sku: string; name: string; qty: string; amount: string }[]): ScheduleTable {
  return {
    key,
    title,
    note,
    columns: [col('sku', 'SKU', 'text'), col('name', 'Produk', 'text'), col('qty', 'Jumlah', 'qty'), col('amount', 'Nilai')],
    rows: r.map((x) => ({ cells: { sku: x.sku, name: x.name, qty: D(x.qty).toFixed(4), amount: money(D(x.amount)) } })),
    total: { name: 'Jumlah', amount: money(r.reduce((s, x) => s.plus(x.amount), ZERO)) },
  };
}
