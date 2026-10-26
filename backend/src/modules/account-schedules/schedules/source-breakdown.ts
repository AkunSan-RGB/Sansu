import { JOURNAL_SOURCE_LABELS, type JournalSource } from '@sansu/shared';
import { D, ZERO } from '../../../common/utils/money';
import { DbOrTx } from '../../../db/db';
import { AccountSchedulesRepository } from '../account-schedules.repository';
import { col, money, netOf } from '../account-schedule.support';
import type { ScheduleContext, ScheduleTable } from '../account-schedule.types';

const label = (s: string) => JOURNAL_SOURCE_LABELS[s as JournalSource] ?? s;

/**
 * Tabel pelengkap akun laba rugi: dari mana angka setahun berasal (menurut sumber jurnal: faktur, kas, gaji, penyusutan, penilaian ulang, dst.)
 * dan transaksi terbesar. Jumlah per sumber sama dengan jumlah akun di laporan laba rugi (jurnal penutup tidak dihitung).
 */
export async function sourceTables(db: DbOrTx, repo: AccountSchedulesRepository, cx: ScheduleContext, labels: { add: string; sub: string }): Promise<ScheduleTable[]> {
  const a = cx.account;
  const [src, top] = await Promise.all([repo.sourceBreakdown(db, cx.tenantId, a.id, cx.from, cx.to), repo.topLines(db, cx.tenantId, a.id, cx.from, cx.to)]);
  const rows = src.rows.map((r) => {
    const debit = D(r.debit);
    const credit = D(r.credit);
    const add = a.type === 'ASSET' || a.type === 'EXPENSE' ? debit : credit;
    const sub = a.type === 'ASSET' || a.type === 'EXPENSE' ? credit : debit;
    return { cells: { source: label(r.source_type), n: r.n, add: money(add), sub: money(sub), net: money(netOf(a.type, debit, credit)) } };
  });
  const total = src.rows.reduce((s, r) => s.plus(netOf(a.type, D(r.debit), D(r.credit))), ZERO);
  const out: ScheduleTable[] = [];
  if (rows.length) {
    out.push({
      key: 'by-source',
      title: 'Rincian menurut sumber transaksi',
      note: 'Dari dokumen atau proses mana angka akun ini berasal; jumlahnya sama dengan jumlah akun di laporan.',
      columns: [col('source', 'Sumber', 'text'), col('n', 'Jumlah baris', 'qty'), col('add', labels.add), col('sub', labels.sub), col('net', 'Neto')],
      rows,
      total: { source: 'Jumlah', net: money(total) },
    });
  }
  if (top.rows.length) {
    out.push({
      key: 'top-lines',
      title: 'Transaksi terbesar tahun ini',
      note: 'Sepuluh baris jurnal dengan nilai terbesar; klik untuk membuka jurnalnya.',
      columns: [col('date', 'Tanggal', 'date'), col('number', 'No. jurnal', 'text'), col('description', 'Keterangan', 'text'), col('source', 'Sumber', 'text'), col('amount', 'Jumlah')],
      rows: top.rows.map((r) => ({ cells: { date: r.date, number: r.number, description: r.description, source: label(r.source_type), amount: money(netOf(a.type, D(r.debit), D(r.credit))) }, link: `/journals?q=${encodeURIComponent(r.number)}` })),
    });
  }
  return out;
}
