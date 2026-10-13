/**
 * Ambang temuan kontrol menurut jenis usaha. Toko berputar harian (temuan cepat dan ketat), dagang & produksi mingguan–bulanan,
 * jasa berbasis proyek (lebih longgar dan tanpa temuan stok/pengiriman).
 */
import type { BusinessModel } from './apps.js';

export interface ControlProfile {
  /** Uang keluar di bank belum ada di buku: temuan setelah sekian hari */
  bankOutDays: number;
  /** Uang masuk di bank belum dicatat */
  bankInDays: number;
  /** Pembayaran di buku tidak muncul di bank */
  bookNotInBankDays: number;
  /** Cabang tanpa pendapatan selama sekian hari */
  branchNoSalesDays: number;
  /** Margin cabang di bawah rata-rata lebih dari sekian poin persen */
  branchMarginGapPts: number;
  /** Surat jalan belum difakturkan (null = tidak relevan) */
  deliveryNotBilledDays: number | null;
  /** Barang diterima belum ditagih pemasok (null = tidak relevan) */
  grniDays: number | null;
  /** Penyesuaian stok keluar berulang dalam 30 hari (null = tidak relevan) */
  adjOutRepeat: number | null;
  /** Sesi kasir terbuka lebih dari sekian jam */
  posOpenHours: number;
}

export const CONTROL_PROFILES: Record<BusinessModel, ControlProfile> = {
  RITEL: { bankOutDays: 2, bankInDays: 3, bookNotInBankDays: 14, branchNoSalesDays: 7, branchMarginGapPts: 10, deliveryNotBilledDays: 3, grniDays: 14, adjOutRepeat: 3, posOpenHours: 30 },
  DAGANG: { bankOutDays: 3, bankInDays: 7, bookNotInBankDays: 21, branchNoSalesDays: 30, branchMarginGapPts: 10, deliveryNotBilledDays: 7, grniDays: 30, adjOutRepeat: 3, posOpenHours: 30 },
  PRODUKSI: { bankOutDays: 3, bankInDays: 7, bookNotInBankDays: 21, branchNoSalesDays: 30, branchMarginGapPts: 15, deliveryNotBilledDays: 14, grniDays: 45, adjOutRepeat: 3, posOpenHours: 30 },
  MANUFAKTUR: { bankOutDays: 3, bankInDays: 7, bookNotInBankDays: 30, branchNoSalesDays: 45, branchMarginGapPts: 15, deliveryNotBilledDays: 14, grniDays: 60, adjOutRepeat: 4, posOpenHours: 30 },
  JASA: { bankOutDays: 5, bankInDays: 14, bookNotInBankDays: 30, branchNoSalesDays: 60, branchMarginGapPts: 25, deliveryNotBilledDays: null, grniDays: null, adjOutRepeat: null, posOpenHours: 30 },
};

/** Akun beban/pendapatan yang disarankan masuk anggaran, menurut jenis usaha (kode bagan akun bawaan) */
export const BUDGET_SUGGESTED_CODES: Record<BusinessModel, string[]> = {
  RITEL: ['4-1000', '5-1000', '5-1300', '6-1000', '6-1100', '6-3000', '6-4000', '6-2100', '6-2450', '6-2500', '6-2600', '6-7000', '6-6000', '8-1100'],
  DAGANG: ['4-1000', '5-1000', '5-1100', '6-1000', '6-1100', '6-3000', '6-4000', '6-2000', '6-2100', '6-2300', '6-2350', '6-7000', '6-7100', '8-1100'],
  JASA: ['4-2000', '4-2100', '5-1500', '5-1600', '5-1700', '5-1800', '5-1900', '6-1000', '6-1100', '6-3000', '6-4000', '6-3600', '6-3700', '6-3800', '6-7200', '8-1100'],
  PRODUKSI: ['4-1000', '5-1000', '5-4100', '5-4200', '5-4300', '5-4500', '5-4700', '6-1000', '6-1100', '6-3000', '6-4000', '6-2000', '6-2700', '6-7000', '8-1100'],
  MANUFAKTUR: ['4-1000', '5-1000', '5-4100', '5-4200', '5-4300', '5-4500', '5-4600', '5-4700', '5-4950', '6-1000', '6-1100', '6-3000', '6-4000', '6-2700', '6-7000', '8-1100'],
};

/** Aturan bank bawaan (kata kunci mutasi → akun lawan) menurut jenis usaha; hanya akun pendapatan/beban, dengan batas nilai */
export interface DefaultBankRule {
  name: string;
  keyword: string;
  direction: 'IN' | 'OUT' | 'ANY';
  accountCode: string;
  maxAmount: number;
}
const COMMON_RULES: DefaultBankRule[] = [
  { name: 'Biaya administrasi bank', keyword: 'BIAYA ADM', direction: 'OUT', accountCode: '8-1100', maxAmount: 150_000 },
  { name: 'Biaya administrasi bank (ADM)', keyword: 'ADM BULANAN', direction: 'OUT', accountCode: '8-1100', maxAmount: 150_000 },
  { name: 'Bunga / jasa giro', keyword: 'BUNGA', direction: 'IN', accountCode: '4-9100', maxAmount: 25_000_000 },
  { name: 'Jasa giro', keyword: 'JASA GIRO', direction: 'IN', accountCode: '4-9100', maxAmount: 25_000_000 },
];
export const DEFAULT_BANK_RULES: Record<BusinessModel, DefaultBankRule[]> = {
  RITEL: [...COMMON_RULES, { name: 'Biaya MDR QRIS / kartu', keyword: 'MDR', direction: 'OUT', accountCode: '6-2450', maxAmount: 5_000_000 }, { name: 'Biaya QRIS', keyword: 'BIAYA QRIS', direction: 'OUT', accountCode: '6-2450', maxAmount: 5_000_000 }],
  DAGANG: COMMON_RULES,
  JASA: [...COMMON_RULES, { name: 'Langganan perangkat lunak', keyword: 'SUBSCRIPTION', direction: 'OUT', accountCode: '6-3700', maxAmount: 3_000_000 }],
  PRODUKSI: [...COMMON_RULES, { name: 'Listrik pabrik (PLN)', keyword: 'PLN', direction: 'OUT', accountCode: '5-4500', maxAmount: 10_000_000 }],
  MANUFAKTUR: [...COMMON_RULES, { name: 'Listrik pabrik (PLN)', keyword: 'PLN', direction: 'OUT', accountCode: '5-4500', maxAmount: 10_000_000 }],
};
