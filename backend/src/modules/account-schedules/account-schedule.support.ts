import { D, Dec, ZERO } from '../../common/utils/money';
import { natural, type AccountMeta } from '../accounting/ledger-data';
import type { AccountMovement, ScheduleColumn, ScheduleRow, ScheduleTable } from './account-schedule.types';

export const MONTH_NAMES = [
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

export const col = (key: string, title: string, kind: ScheduleColumn['kind'] = 'money'): ScheduleColumn => ({ key, title, kind });
export const money = (d: Dec) => d.toFixed(2);
export const monthEnd = (year: number, m: number) => new Date(Date.UTC(year, m + 1, 0)).toISOString().slice(0, 10);
export const monthStart = (year: number, m: number) => `${year}-${String(m + 1).padStart(2, '0')}-01`;
export const ledgerLink = (accountId: string, from: string, to: string) =>
  `/ledger?accountId=${accountId}&from=${from}&to=${to}`;

/** Selisih bersih satu periode dengan tanda alami akun */
export const netOf = (type: AccountMeta['type'], debit: Dec, credit: Dec) => natural(type, { debit, credit });

export const emptyMovement = (): AccountMovement => ({
  openingDebit: ZERO,
  openingCredit: ZERO,
  months: Array.from({ length: 12 }, () => ({ debit: ZERO, credit: ZERO })),
});

/** Saldo awal tahun (tanda alami). Akun nominal tidak punya saldo awal: jurnal tahun lalu sudah ditutup. */
export const openingOf = (a: AccountMeta, m: AccountMovement) =>
  a.type === 'REVENUE' || a.type === 'EXPENSE' ? ZERO : netOf(a.type, m.openingDebit, m.openingCredit);

/**
 * Baris roll-forward bulanan: saldo awal, penambahan, pengurangan, saldo akhir (tanda alami).
 * Penambahan = sisi yang menambah saldo akun (debit untuk aset/beban, kredit untuk lainnya).
 */
export function monthlyRows(a: AccountMeta, m: AccountMovement, year: number): { rows: ScheduleRow[]; closing: Dec; add: Dec; sub: Dec } {
  const debitNormal = a.type === 'ASSET' || a.type === 'EXPENSE';
  let run = openingOf(a, m);
  let add = ZERO;
  let sub = ZERO;
  const rows = m.months.map((mm, i) => {
    const inc = debitNormal ? mm.debit : mm.credit;
    const dec = debitNormal ? mm.credit : mm.debit;
    const open = run;
    run = open.plus(inc).minus(dec);
    add = add.plus(inc);
    sub = sub.plus(dec);
    return {
      cells: { month: MONTH_NAMES[i], opening: money(open), add: money(inc), sub: money(dec), closing: money(run) },
      link: ledgerLink(a.id, monthStart(year, i), monthEnd(year, i)),
      muted: inc.isZero() && dec.isZero(),
    };
  });
  return { rows, closing: run, add, sub };
}

export const D0 = (v: string | number | null | undefined) => D(v ?? 0);

export interface MovementLabels {
  /** Judul sisi yang menambah saldo akun (debit untuk aset/beban, kredit untuk lainnya) */
  add: string;
  /** Judul sisi yang mengurangi saldo akun */
  sub: string;
}

/**
 * Tabel mutasi buku besar per bulan. Akun neraca: saldo awal, penambahan, pengurangan, saldo akhir.
 * Akun laba rugi (nominal): tanpa saldo awal; kolom jumlah bulan dan akumulasi sejak awal tahun.
 */
export function movementTable(a: AccountMeta, m: AccountMovement, year: number, labels: MovementLabels, title: string): { table: ScheduleTable; closing: Dec } {
  const r = monthlyRows(a, m, year);
  const nominal = a.type === 'REVENUE' || a.type === 'EXPENSE';
  if (!nominal) {
    return {
      closing: r.closing,
      table: {
        key: 'ledger-monthly',
        title,
        note: 'Bersumber dari jurnal buku besar; klik baris untuk melihat jurnalnya.',
        columns: [col('month', 'Bulan', 'text'), col('opening', 'Saldo awal'), col('add', labels.add), col('sub', labels.sub), col('closing', 'Saldo akhir')],
        rows: r.rows,
        total: { month: 'Jumlah tahun berjalan', opening: money(openingOf(a, m)), add: money(r.add), sub: money(r.sub), closing: money(r.closing) },
      },
    };
  }
  let acc = ZERO;
  const rows = r.rows.map((row) => {
    const net = D(row.cells.add as string).minus(D(row.cells.sub as string));
    acc = acc.plus(net);
    return { ...row, cells: { month: row.cells.month, add: row.cells.add, sub: row.cells.sub, net: money(net), cumulative: money(acc) } };
  });
  return {
    closing: acc,
    table: {
      key: 'ledger-monthly',
      title,
      note: 'Akun laba rugi tidak punya saldo awal; jurnal penutup tidak dihitung. Klik baris untuk melihat jurnalnya.',
      columns: [col('month', 'Bulan', 'text'), col('add', labels.add), col('sub', labels.sub), col('net', 'Jumlah bulan'), col('cumulative', 'Akumulasi sejak awal tahun')],
      rows,
      total: { month: 'Jumlah tahun berjalan', add: money(r.add), sub: money(r.sub), net: money(acc), cumulative: money(acc) },
    },
  };
}
