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
  // FMCG: volume tinggi, margin tipis, pengiriman ke outlet harus segera ditagih; penyesuaian stok (rusak/kedaluwarsa) lebih sering wajar
  FMCG: { bankOutDays: 3, bankInDays: 5, bookNotInBankDays: 14, branchNoSalesDays: 14, branchMarginGapPts: 8, deliveryNotBilledDays: 3, grniDays: 14, adjOutRepeat: 4, posOpenHours: 30 },
  MANUFAKTUR: { bankOutDays: 3, bankInDays: 7, bookNotInBankDays: 30, branchNoSalesDays: 45, branchMarginGapPts: 15, deliveryNotBilledDays: 14, grniDays: 60, adjOutRepeat: 4, posOpenHours: 30 },
  // F&B: bahan cepat habis/basi, penjualan harian lewat kasir, shift kasir pendek; penyesuaian stok (bahan terbuang) lebih sering wajar
  FNB: { bankOutDays: 2, bankInDays: 3, bookNotInBankDays: 14, branchNoSalesDays: 3, branchMarginGapPts: 12, deliveryNotBilledDays: null, grniDays: 7, adjOutRepeat: 5, posOpenHours: 20 },
  // Utilitas: tagihan berkala ke ribuan sambungan; tunggakan dan penyambungan kembali harus cepat terlihat, tidak ada kasir/pengiriman
  UTILITAS: { bankOutDays: 3, bankInDays: 5, bookNotInBankDays: 14, branchNoSalesDays: 30, branchMarginGapPts: 15, deliveryNotBilledDays: null, grniDays: 30, adjOutRepeat: 4, posOpenHours: 30 },
  JASA: { bankOutDays: 5, bankInDays: 14, bookNotInBankDays: 30, branchNoSalesDays: 60, branchMarginGapPts: 25, deliveryNotBilledDays: null, grniDays: null, adjOutRepeat: null, posOpenHours: 30 },
};

/** Akun beban/pendapatan yang disarankan masuk anggaran, menurut jenis usaha (kode bagan akun bawaan) */
export const BUDGET_SUGGESTED_CODES: Record<BusinessModel, string[]> = {
  RITEL: ['4-1000', '5-1000', '5-1300', '6-1000', '6-1100', '6-3000', '6-4000', '6-2100', '6-2450', '6-2500', '6-2600', '6-7000', '6-6000', '8-1100'],
  DAGANG: ['4-1000', '5-1000', '5-1100', '6-1000', '6-1100', '6-3000', '6-4000', '6-2000', '6-2100', '6-2300', '6-2350', '6-7000', '6-7100', '8-1100'],
  UTILITAS: ['4-2300', '4-2310', '4-2320', '4-2330', '5-1550', '5-1560', '6-1000', '6-1100', '6-3000', '6-4000', '6-2000', '6-7000', '6-7100', '8-1100'],
  JASA: ['4-2000', '4-2100', '5-1500', '5-1600', '5-1700', '5-1800', '5-1900', '6-1000', '6-1100', '6-3000', '6-4000', '6-3600', '6-3700', '6-3800', '6-7200', '8-1100'],
  FMCG: ['4-1000', '4-1200', '5-1000', '6-1000', '6-1100', '6-3000', '6-4000', '6-2100', '6-2150', '6-2160', '6-2200', '6-2700', '6-7000', '8-1100'],
  MANUFAKTUR: ['4-1000', '5-1000', '5-4100', '5-4200', '5-4300', '5-4500', '5-4600', '5-4700', '5-4950', '6-1000', '6-1100', '6-3000', '6-4000', '6-2700', '6-7000', '8-1100'],
  FNB: ['4-1000', '5-1000', '5-1350', '5-1450', '6-1000', '6-1100', '6-3000', '6-4000', '6-2450', '6-2460', '6-2500', '6-7000', '6-6000', '8-1100'],
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
  UTILITAS: [...COMMON_RULES, { name: 'Pembelian listrik (PLN) untuk operasional', keyword: 'PLN', direction: 'OUT', accountCode: '5-1560', maxAmount: 50_000_000 }, { name: 'Pembelian air baku', keyword: 'AIR BAKU', direction: 'OUT', accountCode: '5-1550', maxAmount: 50_000_000 }],
  JASA: [...COMMON_RULES, { name: 'Langganan perangkat lunak', keyword: 'SUBSCRIPTION', direction: 'OUT', accountCode: '6-3700', maxAmount: 3_000_000 }],
  FMCG: [...COMMON_RULES, { name: 'Ongkos kirim ekspedisi', keyword: 'EKSPEDISI', direction: 'OUT', accountCode: '6-2700', maxAmount: 25_000_000 }],
  MANUFAKTUR: [...COMMON_RULES, { name: 'Listrik pabrik (PLN)', keyword: 'PLN', direction: 'OUT', accountCode: '5-4500', maxAmount: 10_000_000 }],
  FNB: [...COMMON_RULES, { name: 'Biaya MDR QRIS / kartu', keyword: 'MDR', direction: 'OUT', accountCode: '6-2450', maxAmount: 5_000_000 }, { name: 'Biaya QRIS', keyword: 'BIAYA QRIS', direction: 'OUT', accountCode: '6-2450', maxAmount: 5_000_000 }, { name: 'Komisi platform pesan-antar', keyword: 'KOMISI', direction: 'OUT', accountCode: '6-2460', maxAmount: 10_000_000 }],
};
