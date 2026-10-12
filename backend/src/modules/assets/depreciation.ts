/**
 * Perhitungan penyusutan aset tetap (fungsi murni, dites di depreciation.spec.ts).
 *  - Komersial (SAK EP/EMKM): bulanan, garis lurus atau saldo menurun ganda, sampai nilai residu.
 *  - Fiskal (Pasal 11 UU PPh): tahunan per kelompok harta, mulai bulan perolehan.
 */
import { FISCAL_ASSET_GROUP_INFO, type FiscalAssetGroup } from '@sansu/shared';
import { D, Dec, Decimal, money, ZERO } from '../../common/utils/money';

/** 'YYYY-MM' → indeks bulan absolut */
export const monthIndex = (p: string) => Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7)) - 1;
export const periodOf = (idx: number) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
export const lastDay = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

export interface DepInput {
  cost: string;
  residualValue: string;
  usefulLifeMonths: number;
  method: string;
  depreciationStart: string; // YYYY-MM-DD
}

/**
 * Penyusutan satu bulan.
 * `accumulated` = akumulasi sebelum bulan ini; `period` = 'YYYY-MM'.
 */
export function monthlyDepreciation(a: DepInput, accumulated: Dec, period: string): Dec {
  if (a.method === 'NONE' || a.usefulLifeMonths <= 0) return ZERO;
  const start = monthIndex(a.depreciationStart.slice(0, 7));
  const n = monthIndex(period) - start; // 0 = bulan pertama
  if (n < 0) return ZERO;
  const cost = D(a.cost);
  const residual = D(a.residualValue);
  const remainingValue = cost.minus(residual).minus(accumulated);
  if (remainingValue.lte(0)) return ZERO;
  // Bulan terakhir masa manfaat: habiskan sisa
  if (n >= a.usefulLifeMonths - 1) return money(remainingValue);
  let amount: Dec;
  if (a.method === 'DECLINING_BALANCE') {
    const nbv = cost.minus(accumulated);
    const annualRate = D(2).div(D(a.usefulLifeMonths).div(12));
    amount = money(nbv.times(annualRate).div(12));
    // Beralih ke garis lurus bila lebih besar (praktik umum agar habis tepat waktu)
    const sl = money(remainingValue.div(a.usefulLifeMonths - n));
    if (sl.gt(amount)) amount = sl;
  } else {
    amount = money(cost.minus(residual).div(a.usefulLifeMonths));
  }
  return Decimal.min(amount, remainingValue);
}

/** Akumulasi komersial s/d akhir periode tertentu (simulasi dari awal penyusutan) */
export function accumulatedThrough(a: DepInput, openingAccumulated: Dec, period: string, startFrom?: string) {
  let acc = openingAccumulated;
  const from = monthIndex((startFrom ?? a.depreciationStart).slice(0, 7));
  for (let i = from; i <= monthIndex(period); i++) acc = acc.plus(monthlyDepreciation(a, acc, periodOf(i)));
  return acc;
}

/**
 * Penyusutan fiskal per tahun pajak (Pasal 11 UU PPh).
 * Garis lurus: harga perolehan × tarif × bulan/12; saldo menurun: nilai sisa buku × tarif × bulan/12,
 * dan sisa nilai buku disusutkan sekaligus di akhir masa manfaat.
 */
export function fiscalDepreciation(cost: string, acquisitionDate: string, group: FiscalAssetGroup, method: string, year: number, disposalDate?: string | null) {
  const info = FISCAL_ASSET_GROUP_INFO[group];
  const c = D(cost);
  if (!info || info.years === 0) return { amount: ZERO, accumulatedEnd: ZERO };
  const useDb = method === 'DECLINING_BALANCE' && info.dbRate != null;
  const rate = D(useDb ? info.dbRate! : info.slRate).div(100);
  const acqY = Number(acquisitionDate.slice(0, 4));
  const acqM = Number(acquisitionDate.slice(5, 7));
  const lastYear = acqY + info.years; // tahun terakhir (bulan sisa)
  let accumulated: Dec = ZERO;
  let amountInYear: Dec = ZERO;
  const dispY = disposalDate ? Number(disposalDate.slice(0, 4)) : null;
  const dispM = disposalDate ? Number(disposalDate.slice(5, 7)) : null;
  for (let y = acqY; y <= Math.min(year, lastYear); y++) {
    if (dispY != null && y > dispY) break;
    let months = y === acqY ? 12 - acqM + 1 : 12;
    // Tahun pelepasan: disusutkan s/d bulan sebelum pelepasan
    if (dispY != null && y === dispY) months = Math.max(0, (dispM! - 1) - (y === acqY ? acqM - 1 : 0));
    const nbv = c.minus(accumulated);
    let dep = useDb ? money(nbv.times(rate).times(months).div(12)) : money(c.times(rate).times(months).div(12));
    // Akhir masa manfaat: sisa nilai buku dibebankan seluruhnya
    const finalYear = y === lastYear || (useDb && y === acqY + info.years - (acqM === 1 ? 1 : 0));
    if (finalYear && !(dispY != null && y === dispY)) dep = nbv;
    dep = Decimal.min(dep, nbv);
    accumulated = accumulated.plus(dep);
    if (y === year) amountInYear = dep;
  }
  return { amount: amountInYear, accumulatedEnd: accumulated };
}
