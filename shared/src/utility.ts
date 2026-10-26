/**
 * Layanan utilitas (air, listrik, internet, kebersihan): tarif, perhitungan tagihan, denda, dan penanda kejanggalan meter.
 * Dipakai server (penagihan) dan layar (simulasi tarif) agar angkanya sama. Hitungan memakai sen bulat agar tidak ada selisih pembulatan.
 */

export const UTILITY_SERVICE_TYPES = ['AIR', 'LISTRIK', 'INTERNET', 'GAS', 'TV_KABEL', 'KEBERSIHAN'] as const;
export type UtilityServiceType = (typeof UTILITY_SERVICE_TYPES)[number];

export const UTILITY_SERVICE_LABELS: Record<UtilityServiceType, string> = {
  AIR: 'Air bersih',
  LISTRIK: 'Listrik',
  INTERNET: 'Internet',
  GAS: 'Gas pipa',
  TV_KABEL: 'TV kabel',
  KEBERSIHAN: 'Kebersihan & keamanan (iuran)',
};

/** Satuan bawaan dan apakah layanan memakai meter (pemakaian terukur) atau tarif tetap per periode */
export const UTILITY_SERVICE_DEFAULTS: Record<UtilityServiceType, { unit: string; metered: boolean }> = {
  AIR: { unit: 'm³', metered: true },
  LISTRIK: { unit: 'kWh', metered: true },
  GAS: { unit: 'm³', metered: true },
  INTERNET: { unit: 'bulan', metered: false },
  TV_KABEL: { unit: 'bulan', metered: false },
  KEBERSIHAN: { unit: 'bulan', metered: false },
};

export const UTILITY_CONNECTION_STATUS = ['ACTIVE', 'SUSPENDED', 'DISCONNECTED'] as const;
export type UtilityConnectionStatus = (typeof UTILITY_CONNECTION_STATUS)[number];
export const UTILITY_CONNECTION_LABELS: Record<UtilityConnectionStatus, string> = {
  ACTIVE: 'Aktif',
  SUSPENDED: 'Diputus sementara',
  DISCONNECTED: 'Dibongkar / berhenti',
};

export const UTILITY_READING_STATUS = ['ENTERED', 'VERIFIED', 'BILLED', 'REJECTED'] as const;
export type UtilityReadingStatus = (typeof UTILITY_READING_STATUS)[number];
export const UTILITY_READING_LABELS: Record<UtilityReadingStatus, string> = {
  ENTERED: 'Menunggu verifikasi',
  VERIFIED: 'Terverifikasi',
  BILLED: 'Sudah ditagih',
  REJECTED: 'Ditolak',
};

/** Blok tarif progresif: pemakaian sampai `upTo` (null = tanpa batas) dikenai `price` per satuan */
export interface TariffBlock {
  upTo: number | null;
  price: number;
}

export interface UtilityTariffInput {
  /** Abonemen / biaya tetap per periode */
  fixedFee: number;
  /** Biaya administrasi per tagihan */
  adminFee: number;
  /** Pemakaian minimum yang ditagih (0 = tidak ada) */
  minUsage: number;
  blocks: TariffBlock[];
}

export interface BillLine {
  kind: 'FIXED' | 'USAGE' | 'ADMIN' | 'LATE_FEE';
  description: string;
  qty: number;
  price: number;
  amount: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** Periksa blok tarif: naik berurutan, hanya blok terakhir tanpa batas, harga tidak negatif. Mengembalikan daftar masalah. */
export function validateBlocks(blocks: TariffBlock[], metered: boolean): string[] {
  const out: string[] = [];
  if (!metered) {
    if (blocks.length) out.push('Layanan tarif tetap tidak memakai blok pemakaian.');
    return out;
  }
  if (!blocks.length) return ['Layanan terukur butuh minimal satu blok tarif.'];
  let prev = 0;
  blocks.forEach((b, i) => {
    if (!(b.price >= 0)) out.push(`Blok ${i + 1}: harga tidak boleh negatif.`);
    const last = i === blocks.length - 1;
    if (b.upTo === null) {
      if (!last) out.push(`Blok ${i + 1}: hanya blok terakhir yang boleh tanpa batas.`);
    } else {
      if (!(b.upTo > prev)) out.push(`Blok ${i + 1}: batas harus lebih besar dari blok sebelumnya (${prev}).`);
      prev = b.upTo;
      if (last) out.push('Blok terakhir harus tanpa batas atas (kosongkan "sampai").');
    }
  });
  return out;
}

/** Hitung baris tagihan untuk satu periode. `usage` = null untuk layanan tarif tetap. */
export function computeBill(t: UtilityTariffInput, usage: number | null, unit: string): { lines: BillLine[]; subtotal: number } {
  const lines: BillLine[] = [];
  if (t.fixedFee > 0) lines.push({ kind: 'FIXED', description: 'Abonemen / biaya tetap', qty: 1, price: cents(t.fixedFee), amount: cents(t.fixedFee) });
  if (usage !== null) {
    const billable = Math.max(usage, t.minUsage);
    let from = 0;
    for (const b of t.blocks) {
      if (billable <= from) break;
      const to = b.upTo === null ? billable : Math.min(b.upTo, billable);
      const qty = cents(to - from);
      if (qty > 0) lines.push({ kind: 'USAGE', description: `Pemakaian ${from}–${b.upTo === null ? '∞' : b.upTo} ${unit}`, qty, price: cents(b.price), amount: cents(qty * b.price) });
      from = b.upTo === null ? billable : b.upTo;
    }
  }
  if (t.adminFee > 0) lines.push({ kind: 'ADMIN', description: 'Biaya administrasi', qty: 1, price: cents(t.adminFee), amount: cents(t.adminFee) });
  return { lines, subtotal: cents(lines.reduce((s, l) => s + l.amount, 0)) };
}

export interface UtilityRules {
  /** Hari setelah jatuh tempo sebelum denda dikenakan */
  graceDays: number;
  /** Denda keterlambatan, % dari sisa tagihan (sekali per tagihan) */
  lateFeePct: number;
  /** Batas denda per tagihan, % dari nilai tagihan */
  lateFeeCapPct: number;
  /** Usulan putus bila tagihan telat lebih dari sekian hari dari jatuh tempo */
  suspendAfterDays: number;
  /** Pemakaian dianggap janggal bila lebih dari sekian kali rata-rata 3 periode terakhir */
  spikeFactor: number;
  /** Abaikan lonjakan bila pemakaiannya masih di bawah ini (satuan tarif) */
  spikeMinUsage: number;
  /** Tagihan jatuh tempo sekian hari setelah terbit */
  dueDays: number;
  /** Penerimaan loket hanya non-tunai (transfer, QRIS, virtual account, EDC); setoran kas loket tidak dipakai */
  cashless: boolean;
}
export const DEFAULT_UTILITY_RULES: UtilityRules = { graceDays: 7, lateFeePct: 2, lateFeeCapPct: 10, suspendAfterDays: 30, spikeFactor: 3, spikeMinUsage: 5, dueDays: 20, cashless: true };

export function validateRules(r: UtilityRules): string[] {
  const out: string[] = [];
  if (!(r.graceDays >= 0 && r.graceDays <= 60)) out.push('Hari toleransi 0–60.');
  if (!(r.lateFeePct >= 0 && r.lateFeePct <= 10)) out.push('Denda maksimal 10% per tagihan.');
  if (!(r.lateFeeCapPct >= r.lateFeePct && r.lateFeeCapPct <= 25)) out.push('Batas denda harus ≥ denda dan ≤ 25%.');
  if (!(r.suspendAfterDays >= 14 && r.suspendAfterDays <= 180)) out.push('Usulan putus 14–180 hari setelah jatuh tempo.');
  if (!(r.spikeFactor >= 1.5 && r.spikeFactor <= 10)) out.push('Faktor lonjakan 1,5–10.');
  if (!(r.dueDays >= 5 && r.dueDays <= 60)) out.push('Jatuh tempo 5–60 hari.');
  return out;
}

/** Denda keterlambatan untuk satu tagihan (sekali), dibatasi persen maksimal dari nilai tagihan */
export function lateFee(billTotal: number, outstanding: number, daysLate: number, r: UtilityRules): number {
  if (daysLate <= r.graceDays || outstanding <= 0 || r.lateFeePct <= 0) return 0;
  const fee = cents((outstanding * r.lateFeePct) / 100);
  const cap = cents((billTotal * r.lateFeeCapPct) / 100);
  return Math.min(fee, cap);
}

export type ReadingFlag = 'LONJAKAN' | 'NOL' | 'METER_DIGANTI' | 'DI_BAWAH_SEBELUMNYA' | 'JAUH_DARI_LOKASI';
export const READING_FLAG_LABELS: Record<ReadingFlag, string> = {
  LONJAKAN: 'Pemakaian melonjak dibanding rata-rata',
  NOL: 'Pemakaian nol (meter macet / tidak dipakai?)',
  METER_DIGANTI: 'Meter diganti',
  DI_BAWAH_SEBELUMNYA: 'Angka di bawah catatan sebelumnya',
  JAUH_DARI_LOKASI: 'Dicatat jauh dari lokasi pelanggan',
};

/** Tandai kejanggalan satu pencatatan. `history` = pemakaian periode sebelumnya (terbaru dulu). */
export function flagReading(usage: number, history: number[], r: UtilityRules, meterReplaced: boolean): ReadingFlag[] {
  const flags: ReadingFlag[] = [];
  if (meterReplaced) flags.push('METER_DIGANTI');
  if (usage === 0) flags.push('NOL');
  const recent = history.slice(0, 3);
  if (recent.length >= 2) {
    const avg = recent.reduce((s, x) => s + x, 0) / recent.length;
    if (avg > 0 && usage >= r.spikeMinUsage && usage > avg * r.spikeFactor) flags.push('LONJAKAN');
  }
  return flags;
}

/** Periode bulanan 'YYYY-MM' */
export const isPeriod = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** Kanal penerimaan non-tunai di loket (semuanya masuk rekening bank; tidak ada uang tunai di loket) */
export const COUNTER_CHANNELS = ['TRANSFER', 'QRIS', 'VA', 'EDC', 'EWALLET'] as const;
export type CounterChannel = (typeof COUNTER_CHANNELS)[number];
export const COUNTER_CHANNEL_LABELS: Record<CounterChannel, string> = {
  TRANSFER: 'Transfer bank',
  QRIS: 'QRIS',
  VA: 'Virtual account',
  EDC: 'Kartu debit/kredit (EDC)',
  EWALLET: 'Dompet digital',
};

/** Pendapatan air (pemakaian dan abonemen) dipisahkan dari pendapatan non-air (administrasi, sambung, denda, material, dan lain-lain) */
export const AIR_REVENUE_KEYS = ['UTILITY_USAGE_REVENUE', 'UTILITY_FIXED_REVENUE'] as const;
export const NON_AIR_REVENUE_KEYS = ['UTILITY_ADMIN_REVENUE', 'UTILITY_CONNECTION_REVENUE', 'UTILITY_RECONNECT_REVENUE', 'UTILITY_MATERIAL_REVENUE', 'UTILITY_LATE_FEE_REVENUE', 'UTILITY_OTHER_REVENUE'] as const;
export const NON_AIR_CHARGE_KEYS = ['UTILITY_ADMIN_REVENUE', 'UTILITY_CONNECTION_REVENUE', 'UTILITY_RECONNECT_REVENUE', 'UTILITY_MATERIAL_REVENUE', 'UTILITY_OTHER_REVENUE'] as const;
export type NonAirChargeKey = (typeof NON_AIR_CHARGE_KEYS)[number];
export const REVENUE_KEY_LABELS: Record<string, string> = {
  UTILITY_USAGE_REVENUE: 'Penjualan air (pemakaian)',
  UTILITY_FIXED_REVENUE: 'Abonemen air',
  UTILITY_ADMIN_REVENUE: 'Biaya administrasi',
  UTILITY_CONNECTION_REVENUE: 'Biaya sambung baru',
  UTILITY_RECONNECT_REVENUE: 'Sambung kembali & penyegelan',
  UTILITY_MATERIAL_REVENUE: 'Penggantian meter & material',
  UTILITY_LATE_FEE_REVENUE: 'Denda keterlambatan',
  UTILITY_OTHER_REVENUE: 'Non-air lainnya',
};
/** Layanan non-air bawaan untuk katalog perusahaan baru (harga dapat diubah) */
export const DEFAULT_NON_AIR_CHARGES: { name: string; price: number; revenueKey: NonAirChargeKey }[] = [
  { name: 'Biaya sambung baru', price: 1_500_000, revenueKey: 'UTILITY_CONNECTION_REVENUE' },
  { name: 'Sambung kembali setelah pemutusan', price: 150_000, revenueKey: 'UTILITY_RECONNECT_REVENUE' },
  { name: 'Penggantian meter air', price: 350_000, revenueKey: 'UTILITY_MATERIAL_REVENUE' },
  { name: 'Biaya administrasi pendaftaran', price: 50_000, revenueKey: 'UTILITY_ADMIN_REVENUE' },
  { name: 'Layanan non-air lainnya', price: 0, revenueKey: 'UTILITY_OTHER_REVENUE' },
];
