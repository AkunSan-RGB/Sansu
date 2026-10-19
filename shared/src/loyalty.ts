/** Program loyalitas ritel: poin diperoleh dari belanja, ditukar menjadi potongan, dan kedaluwarsa. Hitungan murni (tanpa basis data). */

export interface LoyaltySettings {
  enabled: boolean;
  /** Setiap kelipatan Rp ini (dari jumlah yang dibayar nyata) memberi 1 poin */
  earnPerRp: number;
  /** Nilai 1 poin saat ditukar (Rp) — juga nilai kewajiban yang dicatat */
  pointValueRp: number;
  /** Poin minimum sekali tukar */
  minRedeemPoints: number;
  /** Batas potongan poin terhadap total belanja (%) */
  maxRedeemPct: number;
  /** Poin kedaluwarsa setelah sekian bulan sejak diperoleh (0 = tidak kedaluwarsa) */
  expiryMonths: number;
}

export const DEFAULT_LOYALTY: LoyaltySettings = { enabled: false, earnPerRp: 10_000, pointValueRp: 100, minRedeemPoints: 50, maxRedeemPct: 50, expiryMonths: 12 };

/** Memeriksa pengaturan; mengembalikan daftar masalah (kosong = sah) */
export function validateLoyalty(s: LoyaltySettings): string[] {
  const e: string[] = [];
  if (!Number.isInteger(s.earnPerRp) || s.earnPerRp < 1000 || s.earnPerRp > 10_000_000) e.push('Kelipatan belanja per poin harus bilangan bulat Rp1.000 – Rp10.000.000');
  if (!Number.isInteger(s.pointValueRp) || s.pointValueRp < 1 || s.pointValueRp > 10_000) e.push('Nilai 1 poin harus bilangan bulat Rp1 – Rp10.000');
  // imbal hasil poin (nilai yang dikembalikan / belanja) tidak boleh ≥ 100%; peringatkan di atas 20%
  if (s.pointValueRp >= s.earnPerRp) e.push('Nilai 1 poin tidak boleh sama atau lebih besar dari belanja per poin (pengembalian ≥ 100%)');
  if (!Number.isInteger(s.minRedeemPoints) || s.minRedeemPoints < 1 || s.minRedeemPoints > 100_000) e.push('Poin minimum tukar harus 1 – 100.000');
  if (!(s.maxRedeemPct > 0 && s.maxRedeemPct <= 100)) e.push('Batas potongan harus lebih dari 0% dan paling banyak 100%');
  if (!Number.isInteger(s.expiryMonths) || s.expiryMonths < 0 || s.expiryMonths > 60) e.push('Masa berlaku poin 0 – 60 bulan');
  return e;
}

/** Poin yang diperoleh dari jumlah yang dibayar nyata (setelah potongan poin) */
export function earnPoints(paidRp: number, s: LoyaltySettings): number {
  if (!s.enabled || paidRp <= 0) return 0;
  return Math.floor(paidRp / s.earnPerRp);
}

/** Nilai rupiah dari sejumlah poin */
export const pointsValue = (points: number, s: LoyaltySettings) => points * s.pointValueRp;

/** Poin tertinggi yang boleh ditukar pada belanja senilai totalRp dengan saldo tertentu */
export function maxRedeemPoints(totalRp: number, balance: number, s: LoyaltySettings): number {
  if (!s.enabled || totalRp <= 0 || balance <= 0) return 0;
  const byPct = Math.floor((totalRp * (s.maxRedeemPct / 100)) / s.pointValueRp);
  return Math.max(0, Math.min(balance, byPct));
}

/** Tanggal kedaluwarsa (YYYY-MM-DD) poin yang diperoleh pada `date`; null bila tidak kedaluwarsa */
export function expiryDate(date: string, s: LoyaltySettings): string | null {
  if (!s.expiryMonths) return null;
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + s.expiryMonths);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/** MDR dibulatkan ke rupiah terdekat */
export const mdrAmount = (grossRp: number, pct: number) => Math.round((grossRp * pct) / 100);

export interface CardSettlementSettings {
  /** MDR QRIS (%) dan kartu debit (%) menurut kontrak dengan penyelenggara */
  qrisPct: number;
  debitPct: number;
  /** Hari sejak transaksi; lewat ini dan belum cair = peringatan */
  lateAfterDays: number;
  /** Selisih (Rp) di atas ini hanya boleh dicatat Admin/Pemilik */
  toleranceRp: number;
}
export const DEFAULT_CARD_SETTLEMENT: CardSettlementSettings = { qrisPct: 0.7, debitPct: 1, lateAfterDays: 4, toleranceRp: 5000 };

export function validateCardSettlement(s: CardSettlementSettings): string[] {
  const e: string[] = [];
  if (!(s.qrisPct >= 0 && s.qrisPct <= 10)) e.push('MDR QRIS 0% – 10%');
  if (!(s.debitPct >= 0 && s.debitPct <= 10)) e.push('MDR debit 0% – 10%');
  if (!Number.isInteger(s.lateAfterDays) || s.lateAfterDays < 1 || s.lateAfterDays > 30) e.push('Batas terlambat 1 – 30 hari');
  if (!(s.toleranceRp >= 0 && s.toleranceRp <= 10_000_000)) e.push('Toleransi selisih Rp0 – Rp10.000.000');
  return e;
}
