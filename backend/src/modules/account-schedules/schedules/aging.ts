import { Dec, ZERO } from '../../../common/utils/money';
import { col, money } from '../account-schedule.support';
import type { ScheduleTable } from '../account-schedule.types';

const BUCKETS = [
  { label: '0–30 hari', max: 30 },
  { label: '31–60 hari', max: 60 },
  { label: '61–90 hari', max: 90 },
  { label: 'Lebih dari 90 hari', max: Infinity },
];

const days = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));

/** Tanggal acuan umur: akhir tahun laporan, atau hari ini bila tahun berjalan */
export const agingDate = (to: string) => {
  const today = new Date().toISOString().slice(0, 10);
  return today < to ? today : to;
};

/**
 * Umur saldo akun yang tidak punya daftar dokumen sendiri (kasbon, klaim, titipan, jaminan, utang lain): pengurangan (pelunasan,
 * pembalikan) dianggap melunasi penambahan yang tertua lebih dulu (FIFO); sisanya dikelompokkan menurut umurnya. Perkiraan karena
 * jurnal tidak menyebut dokumen mana yang dilunasi; jumlah seluruh kelompok = saldo akhir akun.
 */
export function fifoAging(p: { opening: Dec; openingDate: string; lines: { date: string; net: Dec }[]; asOf: string }): { buckets: Dec[]; remaining: Dec; oldest: string | null } {
  const items: { date: string; amount: Dec }[] = [];
  let reduce = ZERO;
  if (p.opening.gt(0)) items.push({ date: p.openingDate, amount: p.opening });
  else reduce = reduce.plus(p.opening.abs());
  for (const l of [...p.lines].sort((a, b) => a.date.localeCompare(b.date))) {
    if (l.net.gt(0)) items.push({ date: l.date, amount: l.net });
    else reduce = reduce.plus(l.net.abs());
  }
  const buckets = BUCKETS.map(() => ZERO);
  let remaining = ZERO;
  let oldest: string | null = null;
  for (const it of items) {
    let amt = it.amount;
    if (reduce.gt(0)) {
      const take = reduce.lt(amt) ? reduce : amt;
      amt = amt.minus(take);
      reduce = reduce.minus(take);
    }
    if (amt.lte(0)) continue;
    const age = days(it.date, p.asOf);
    buckets[BUCKETS.findIndex((b) => age <= b.max)] = buckets[BUCKETS.findIndex((b) => age <= b.max)].plus(amt);
    remaining = remaining.plus(amt);
    oldest ??= it.date;
  }
  return { buckets, remaining, oldest };
}

export function agingTable(a: { buckets: Dec[]; remaining: Dec }, asOf: string, noun: string): ScheduleTable {
  return {
    key: 'aging',
    title: `Umur saldo ${noun} (perkiraan FIFO)`,
    note: `Per ${asOf}. Pengurangan dianggap melunasi penambahan tertua lebih dulu; jumlahnya sama dengan saldo akhir akun.`,
    columns: [col('bucket', 'Umur', 'text'), col('amount', 'Saldo'), col('share', 'Persen', 'percent')],
    rows: BUCKETS.map((b, i) => ({
      cells: { bucket: b.label, amount: money(a.buckets[i]), share: a.remaining.gt(0) ? a.buckets[i].div(a.remaining).times(100).toFixed(1) : null },
      muted: a.buckets[i].isZero(),
    })),
    total: { bucket: 'Jumlah', amount: money(a.remaining), share: a.remaining.gt(0) ? '100.0' : null },
  };
}

export const OVERDUE_DAYS = 90;
