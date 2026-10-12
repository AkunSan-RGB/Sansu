/**
 * PPh Pasal 21 pegawai tetap — PP 58/2023 & PMK 168/2023.
 *  * Januari–November: bruto bulanan × tarif efektif rata-rata (TER) bulanan kategori A/B/C.
 *  * Desember (atau bulan terakhir bekerja): PPh setahun dengan tarif Pasal 17 dikurangi PPh yang sudah dipotong.
 * Semua nilai rupiah dihitung dengan decimal.js, dibulatkan ke bawah per rupiah.
 */
import { D, Dec, Decimal, ZERO } from '../../common/utils/money';

export type TerCategory = 'A' | 'B' | 'C';

/** [batas atas bruto bulanan (inklusif), tarif %]; baris terakhir = di atasnya */
type TerTable = [number, number][];

const TER_A: TerTable = [
  [5_400_000, 0], [5_650_000, 0.25], [5_950_000, 0.5], [6_300_000, 0.75], [6_750_000, 1], [7_500_000, 1.25],
  [8_550_000, 1.5], [9_650_000, 1.75], [10_050_000, 2], [10_350_000, 2.25], [10_700_000, 2.5], [11_050_000, 3],
  [11_600_000, 3.5], [12_500_000, 4], [13_750_000, 5], [15_100_000, 6], [16_950_000, 7], [19_750_000, 8],
  [24_150_000, 9], [26_450_000, 10], [28_000_000, 11], [30_050_000, 12], [32_400_000, 13], [35_400_000, 14],
  [39_100_000, 15], [43_850_000, 16], [47_800_000, 17], [51_400_000, 18], [56_300_000, 19], [62_200_000, 20],
  [68_600_000, 21], [77_500_000, 22], [89_000_000, 23], [103_000_000, 24], [125_000_000, 25], [157_000_000, 26],
  [206_000_000, 27], [337_000_000, 28], [454_000_000, 29], [550_000_000, 30], [695_000_000, 31], [910_000_000, 32],
  [1_400_000_000, 33], [Infinity, 34],
];

const TER_B: TerTable = [
  [6_200_000, 0], [6_500_000, 0.25], [6_850_000, 0.5], [7_300_000, 0.75], [9_200_000, 1], [10_750_000, 1.5],
  [11_250_000, 2], [11_600_000, 2.5], [12_600_000, 3], [13_600_000, 4], [14_950_000, 5], [16_400_000, 6],
  [18_450_000, 7], [21_850_000, 8], [26_000_000, 9], [27_700_000, 10], [29_350_000, 11], [31_450_000, 12],
  [33_950_000, 13], [37_100_000, 14], [41_100_000, 15], [45_800_000, 16], [49_500_000, 17], [53_800_000, 18],
  [58_500_000, 19], [64_000_000, 20], [71_000_000, 21], [80_000_000, 22], [93_000_000, 23], [109_000_000, 24],
  [129_000_000, 25], [163_000_000, 26], [211_000_000, 27], [374_000_000, 28], [459_000_000, 29], [555_000_000, 30],
  [704_000_000, 31], [957_000_000, 32], [1_405_000_000, 33], [Infinity, 34],
];

const TER_C: TerTable = [
  [6_600_000, 0], [6_950_000, 0.25], [7_350_000, 0.5], [7_800_000, 0.75], [8_850_000, 1], [9_800_000, 1.25],
  [10_950_000, 1.5], [11_200_000, 1.75], [12_050_000, 2], [12_950_000, 3], [14_150_000, 4], [15_550_000, 5],
  [17_050_000, 6], [19_500_000, 7], [22_700_000, 8], [26_600_000, 9], [28_100_000, 10], [30_100_000, 11],
  [32_600_000, 12], [35_400_000, 13], [38_900_000, 14], [43_000_000, 15], [47_400_000, 16], [51_200_000, 17],
  [55_800_000, 18], [60_400_000, 19], [66_700_000, 20], [74_500_000, 21], [83_200_000, 22], [95_600_000, 23],
  [110_000_000, 24], [134_000_000, 25], [169_000_000, 26], [221_000_000, 27], [390_000_000, 28], [463_000_000, 29],
  [561_000_000, 30], [709_000_000, 31], [965_000_000, 32], [1_419_000_000, 33], [Infinity, 34],
];

const TABLES: Record<TerCategory, TerTable> = { A: TER_A, B: TER_B, C: TER_C };

/** Kategori TER dari status PTKP: A = TK/0, TK/1, K/0 · B = TK/2, TK/3, K/1, K/2 · C = K/3 */
export function terCategory(ptkp: string): TerCategory {
  if (['TK/0', 'TK/1', 'K/0'].includes(ptkp)) return 'A';
  if (['TK/2', 'TK/3', 'K/1', 'K/2'].includes(ptkp)) return 'B';
  if (ptkp === 'K/3') return 'C';
  throw new Error(`Status PTKP tidak dikenal: ${ptkp}`);
}

export function terRate(category: TerCategory, monthlyGross: Dec): number {
  const g = monthlyGross.toNumber();
  return TABLES[category].find(([upper]) => g <= upper)![1];
}

/** PPh 21 bulanan metode TER (dibulatkan ke bawah) */
export function pph21Ter(ptkp: string, monthlyGross: Dec) {
  const category = terCategory(ptkp);
  const rate = terRate(category, monthlyGross);
  return { category, rate, tax: monthlyGross.times(rate).div(100).floor() };
}

/** PTKP setahun: 54 jt + 4,5 jt kawin + 4,5 jt per tanggungan (maks 3) */
export function ptkpAmount(ptkp: string): Dec {
  const [status, dep] = ptkp.split('/');
  return D(54_000_000)
    .plus(status === 'K' ? 4_500_000 : 0)
    .plus(Math.min(3, Number(dep) || 0) * 4_500_000);
}

/** Tarif progresif Pasal 17 ayat (1) huruf a (UU HPP) */
const PASAL17: [number, number][] = [
  [60_000_000, 5],
  [250_000_000, 15],
  [500_000_000, 25],
  [5_000_000_000, 30],
  [Infinity, 35],
];

export function pasal17(pkp: Dec): Dec {
  let rest = pkp;
  let prev = 0;
  let tax: Dec = ZERO;
  for (const [upper, rate] of PASAL17) {
    if (rest.lte(0)) break;
    const slice = Decimal.min(rest, D(upper - prev));
    tax = tax.plus(slice.times(rate).div(100));
    rest = rest.minus(slice);
    prev = upper;
  }
  return tax.floor();
}

/**
 * PPh 21 masa pajak terakhir (Desember / bulan keluar):
 * bruto setahun − biaya jabatan (5%, maks 6 jt) − iuran JHT & JP pegawai − PTKP → PKP (dibulatkan ribuan ke bawah)
 * → Pasal 17 − PPh yang sudah dipotong bulan sebelumnya. Hasil negatif = kelebihan potong.
 */
export function pph21Annual(input: { ptkp: string; annualGross: Dec; annualPensionContrib: Dec; withheld: Dec; months?: number }) {
  const months = input.months ?? 12;
  const jobCost = Decimal.min(input.annualGross.times(5).div(100), D(500_000).times(months)).floor();
  const net = input.annualGross.minus(jobCost).minus(input.annualPensionContrib);
  const pkpRaw = net.minus(ptkpAmount(input.ptkp));
  const pkp = pkpRaw.gt(0) ? pkpRaw.div(1000).floor().times(1000) : ZERO;
  const annualTax = pasal17(pkp);
  return { jobCost, net, pkp, annualTax, tax: annualTax.minus(input.withheld) };
}
