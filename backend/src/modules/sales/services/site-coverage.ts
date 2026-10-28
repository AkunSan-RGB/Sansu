import { D, Dec } from '../../../common/utils/money';
import { addDays, diffDays } from '../../../common/utils/dates';

/** Hari kalender dari `from` sampai `to` (termasuk) */
export function daysBetween(from: string, to: string): string[] {
  const n = diffDays(from, to);
  return Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}

/** Kekurangan petugas dalam hari-orang: untuk tiap hari wajib (headcount − hadir) bila positif; hari tanpa data jadwal dihitung kurang penuh */
export function shortfallHeadDays(days: string[], headcount: number, assignedByDay: Map<string, number>): number {
  return days.reduce((a, d) => a + Math.max(0, headcount - (assignedByDay.get(d) ?? 0)), 0);
}

/**
 * Tagihan satu pos untuk satu bulan: tarif per petugas × jumlah petugas; bila potong kekurangan diminta,
 * jumlah petugas ditagih dikurangi kekurangan hari-orang dibagi jumlah hari dalam bulan.
 */
export function postBilling(headcount: number, rate: string | Dec, daysInMonth: number, shortfall: number, deduct: boolean): { qty: string; amount: string } {
  const qty = deduct ? D(headcount).minus(D(shortfall).div(daysInMonth)) : D(headcount);
  const q = qty.lt(0) ? D(0) : qty;
  return { qty: q.toDecimalPlaces(4).toFixed(4), amount: q.toDecimalPlaces(4).times(rate).toFixed(2) };
}
