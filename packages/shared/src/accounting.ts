/**
 * Klasifikasi akun untuk penyajian laporan keuangan SAK EP / SAK EMKM dan rekonsiliasi fiskal.
 * Setiap akun buku besar memiliki satu "kelompok laporan" yang menentukan:
 *  - letak di Laporan Posisi Keuangan (lancar / tidak lancar) atau baris Laporan Laba Rugi
 *  - perlakuan di Laporan Arus Kas metode tidak langsung
 */
import type { AccountType } from './domain.js';

export const REPORTING_FRAMEWORKS = ['SAK_EP', 'SAK_EMKM'] as const;
export type ReportingFramework = (typeof REPORTING_FRAMEWORKS)[number];
export const REPORTING_FRAMEWORK_LABELS: Record<ReportingFramework, string> = {
  SAK_EP: 'SAK Entitas Privat (SAK EP)',
  SAK_EMKM: 'SAK EMKM',
};

/** Bagian laporan */
export type StatementSection =
  | 'CURRENT_ASSET'
  | 'NONCURRENT_ASSET'
  | 'CURRENT_LIABILITY'
  | 'NONCURRENT_LIABILITY'
  | 'EQUITY'
  | 'REVENUE'
  | 'COST_OF_SALES'
  | 'OPERATING_EXPENSE'
  | 'OTHER_INCOME_EXPENSE'
  | 'FINANCE'
  | 'TAX';

/** Perlakuan di arus kas tidak langsung */
export type CashFlowClass = 'CASH' | 'WORKING_CAPITAL' | 'NONCURRENT' | 'DEPRECIATION' | 'FINANCING' | 'RETAINED' | 'PROFIT_LOSS';

export interface ReportGroupInfo {
  label: string;
  type: AccountType;
  section: StatementSection;
  cashFlow: CashFlowClass;
  /** Akun kontra (saldo berlawanan dengan tipe), mis. akumulasi penyusutan */
  contra?: boolean;
  order: number;
}

export const REPORT_GROUPS = {
  // Aset lancar
  CASH_EQUIVALENT: { label: 'Kas dan setara kas', type: 'ASSET', section: 'CURRENT_ASSET', cashFlow: 'CASH', order: 10 },
  TRADE_RECEIVABLE: { label: 'Piutang usaha', type: 'ASSET', section: 'CURRENT_ASSET', cashFlow: 'WORKING_CAPITAL', order: 11 },
  ALLOWANCE_RECEIVABLE: { label: 'Cadangan kerugian piutang', type: 'ASSET', section: 'CURRENT_ASSET', cashFlow: 'WORKING_CAPITAL', contra: true, order: 12 },
  OTHER_RECEIVABLE: { label: 'Piutang lain-lain', type: 'ASSET', section: 'CURRENT_ASSET', cashFlow: 'WORKING_CAPITAL', order: 13 },
  INVENTORY: { label: 'Persediaan', type: 'ASSET', section: 'CURRENT_ASSET', cashFlow: 'WORKING_CAPITAL', order: 14 },
  PREPAID: { label: 'Biaya dibayar dimuka dan uang muka', type: 'ASSET', section: 'CURRENT_ASSET', cashFlow: 'WORKING_CAPITAL', order: 15 },
  PREPAID_TAX: { label: 'Pajak dibayar dimuka', type: 'ASSET', section: 'CURRENT_ASSET', cashFlow: 'WORKING_CAPITAL', order: 16 },
  OTHER_CURRENT_ASSET: { label: 'Aset lancar lainnya', type: 'ASSET', section: 'CURRENT_ASSET', cashFlow: 'WORKING_CAPITAL', order: 17 },
  // Aset tidak lancar
  FIXED_ASSET: { label: 'Aset tetap', type: 'ASSET', section: 'NONCURRENT_ASSET', cashFlow: 'NONCURRENT', order: 20 },
  ACCUMULATED_DEPRECIATION: { label: 'Akumulasi penyusutan', type: 'ASSET', section: 'NONCURRENT_ASSET', cashFlow: 'DEPRECIATION', contra: true, order: 21 },
  INTANGIBLE_ASSET: { label: 'Aset takberwujud', type: 'ASSET', section: 'NONCURRENT_ASSET', cashFlow: 'NONCURRENT', order: 22 },
  ACCUMULATED_AMORTIZATION: { label: 'Akumulasi amortisasi', type: 'ASSET', section: 'NONCURRENT_ASSET', cashFlow: 'DEPRECIATION', contra: true, order: 23 },
  DEFERRED_TAX_ASSET: { label: 'Aset pajak tangguhan', type: 'ASSET', section: 'NONCURRENT_ASSET', cashFlow: 'WORKING_CAPITAL', order: 24 },
  OTHER_NONCURRENT_ASSET: { label: 'Aset tidak lancar lainnya', type: 'ASSET', section: 'NONCURRENT_ASSET', cashFlow: 'NONCURRENT', order: 25 },
  // Liabilitas jangka pendek
  TRADE_PAYABLE: { label: 'Utang usaha', type: 'LIABILITY', section: 'CURRENT_LIABILITY', cashFlow: 'WORKING_CAPITAL', order: 30 },
  OTHER_PAYABLE: { label: 'Utang lain-lain', type: 'LIABILITY', section: 'CURRENT_LIABILITY', cashFlow: 'WORKING_CAPITAL', order: 31 },
  TAX_PAYABLE: { label: 'Utang pajak', type: 'LIABILITY', section: 'CURRENT_LIABILITY', cashFlow: 'WORKING_CAPITAL', order: 32 },
  ACCRUED_EXPENSE: { label: 'Beban akrual', type: 'LIABILITY', section: 'CURRENT_LIABILITY', cashFlow: 'WORKING_CAPITAL', order: 33 },
  UNEARNED_REVENUE: { label: 'Pendapatan diterima dimuka dan uang muka pelanggan', type: 'LIABILITY', section: 'CURRENT_LIABILITY', cashFlow: 'WORKING_CAPITAL', order: 34 },
  SHORT_TERM_LOAN: { label: 'Utang bank jangka pendek', type: 'LIABILITY', section: 'CURRENT_LIABILITY', cashFlow: 'FINANCING', order: 35 },
  // Liabilitas jangka panjang
  LONG_TERM_LOAN: { label: 'Utang bank jangka panjang', type: 'LIABILITY', section: 'NONCURRENT_LIABILITY', cashFlow: 'FINANCING', order: 40 },
  EMPLOYEE_BENEFIT: { label: 'Liabilitas imbalan kerja', type: 'LIABILITY', section: 'NONCURRENT_LIABILITY', cashFlow: 'WORKING_CAPITAL', order: 41 },
  DEFERRED_TAX_LIABILITY: { label: 'Liabilitas pajak tangguhan', type: 'LIABILITY', section: 'NONCURRENT_LIABILITY', cashFlow: 'WORKING_CAPITAL', order: 42 },
  OTHER_NONCURRENT_LIABILITY: { label: 'Liabilitas jangka panjang lainnya', type: 'LIABILITY', section: 'NONCURRENT_LIABILITY', cashFlow: 'FINANCING', order: 43 },
  // Ekuitas
  SHARE_CAPITAL: { label: 'Modal disetor', type: 'EQUITY', section: 'EQUITY', cashFlow: 'FINANCING', order: 50 },
  ADDITIONAL_CAPITAL: { label: 'Tambahan modal disetor', type: 'EQUITY', section: 'EQUITY', cashFlow: 'FINANCING', order: 51 },
  RETAINED_EARNINGS: { label: 'Saldo laba', type: 'EQUITY', section: 'EQUITY', cashFlow: 'RETAINED', order: 52 },
  DIVIDEND: { label: 'Dividen / prive', type: 'EQUITY', section: 'EQUITY', cashFlow: 'FINANCING', contra: true, order: 53 },
  OTHER_EQUITY: { label: 'Ekuitas lainnya', type: 'EQUITY', section: 'EQUITY', cashFlow: 'FINANCING', order: 54 },
  // Laba rugi
  SALES_REVENUE: { label: 'Pendapatan usaha', type: 'REVENUE', section: 'REVENUE', cashFlow: 'PROFIT_LOSS', order: 60 },
  SALES_DEDUCTION: { label: 'Retur dan potongan penjualan', type: 'REVENUE', section: 'REVENUE', cashFlow: 'PROFIT_LOSS', contra: true, order: 61 },
  COST_OF_SALES: { label: 'Beban pokok penjualan', type: 'EXPENSE', section: 'COST_OF_SALES', cashFlow: 'PROFIT_LOSS', order: 70 },
  SELLING_EXPENSE: { label: 'Beban penjualan', type: 'EXPENSE', section: 'OPERATING_EXPENSE', cashFlow: 'PROFIT_LOSS', order: 80 },
  ADMIN_EXPENSE: { label: 'Beban umum dan administrasi', type: 'EXPENSE', section: 'OPERATING_EXPENSE', cashFlow: 'PROFIT_LOSS', order: 81 },
  OTHER_INCOME: { label: 'Pendapatan lain-lain', type: 'REVENUE', section: 'OTHER_INCOME_EXPENSE', cashFlow: 'PROFIT_LOSS', order: 90 },
  OTHER_EXPENSE: { label: 'Beban lain-lain', type: 'EXPENSE', section: 'OTHER_INCOME_EXPENSE', cashFlow: 'PROFIT_LOSS', order: 91 },
  FINANCE_INCOME: { label: 'Pendapatan keuangan', type: 'REVENUE', section: 'FINANCE', cashFlow: 'PROFIT_LOSS', order: 95 },
  FINANCE_COST: { label: 'Beban keuangan', type: 'EXPENSE', section: 'FINANCE', cashFlow: 'PROFIT_LOSS', order: 96 },
  INCOME_TAX: { label: 'Beban pajak penghasilan', type: 'EXPENSE', section: 'TAX', cashFlow: 'PROFIT_LOSS', order: 99 },
} as const satisfies Record<string, ReportGroupInfo>;

export type ReportGroup = keyof typeof REPORT_GROUPS;
export const REPORT_GROUP_KEYS = Object.keys(REPORT_GROUPS) as ReportGroup[];

/** Kelompok laporan yang boleh dipilih untuk tipe akun tertentu */
export const reportGroupsFor = (type: AccountType) => REPORT_GROUP_KEYS.filter((k) => REPORT_GROUPS[k].type === type);

/** Kelompok bawaan bila akun belum diklasifikasi */
export const DEFAULT_REPORT_GROUP: Record<AccountType, ReportGroup> = {
  ASSET: 'OTHER_CURRENT_ASSET',
  LIABILITY: 'OTHER_PAYABLE',
  EQUITY: 'OTHER_EQUITY',
  REVENUE: 'OTHER_INCOME',
  EXPENSE: 'ADMIN_EXPENSE',
};

export const SECTION_LABELS: Record<StatementSection, string> = {
  CURRENT_ASSET: 'Aset lancar',
  NONCURRENT_ASSET: 'Aset tidak lancar',
  CURRENT_LIABILITY: 'Liabilitas jangka pendek',
  NONCURRENT_LIABILITY: 'Liabilitas jangka panjang',
  EQUITY: 'Ekuitas',
  REVENUE: 'Pendapatan',
  COST_OF_SALES: 'Beban pokok penjualan',
  OPERATING_EXPENSE: 'Beban usaha',
  OTHER_INCOME_EXPENSE: 'Pendapatan (beban) lain-lain',
  FINANCE: 'Pendapatan (beban) keuangan',
  TAX: 'Pajak penghasilan',
};

// ---------- Fiskal ----------
export const FISCAL_TREATMENTS = ['NORMAL', 'NON_DEDUCTIBLE', 'FINAL_INCOME', 'NON_TAXABLE'] as const;
export type FiscalTreatment = (typeof FISCAL_TREATMENTS)[number];
export const FISCAL_TREATMENT_LABELS: Record<FiscalTreatment, string> = {
  NORMAL: 'Normal (diakui fiskal)',
  NON_DEDUCTIBLE: 'Tidak dapat dikurangkan → koreksi positif',
  FINAL_INCOME: 'Penghasilan sudah PPh final → koreksi negatif',
  NON_TAXABLE: 'Bukan objek pajak → koreksi negatif',
};

export const TAX_SCHEMES = ['GENERAL', 'FINAL_UMKM'] as const;
export type TaxScheme = (typeof TAX_SCHEMES)[number];
export const TAX_SCHEME_LABELS: Record<TaxScheme, string> = {
  GENERAL: 'Tarif umum Pasal 17 (22%) + fasilitas Pasal 31E',
  FINAL_UMKM: 'PPh final UMKM 0,5% dari peredaran bruto',
};

export const LEGAL_FORMS = ['PT', 'PT_PERORANGAN', 'CV', 'FIRMA', 'KOPERASI', 'UD', 'PERORANGAN'] as const;
export type LegalForm = (typeof LEGAL_FORMS)[number];
export const LEGAL_FORM_LABELS: Record<LegalForm, string> = {
  PT: 'Perseroan Terbatas (PT)',
  PT_PERORANGAN: 'PT Perorangan',
  CV: 'Persekutuan Komanditer (CV)',
  FIRMA: 'Firma',
  KOPERASI: 'Koperasi',
  UD: 'Usaha Dagang (UD) / orang pribadi',
  PERORANGAN: 'Orang pribadi',
};

// ---------- Aset tetap ----------
export const DEPRECIATION_METHODS = ['STRAIGHT_LINE', 'DECLINING_BALANCE', 'NONE'] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];
export const DEPRECIATION_METHOD_LABELS: Record<DepreciationMethod, string> = {
  STRAIGHT_LINE: 'Garis lurus',
  DECLINING_BALANCE: 'Saldo menurun ganda',
  NONE: 'Tidak disusutkan (tanah)',
};

/** Kelompok harta untuk penyusutan fiskal (Pasal 11 UU PPh) */
export const FISCAL_ASSET_GROUPS = ['GROUP_1', 'GROUP_2', 'GROUP_3', 'GROUP_4', 'BUILDING_PERMANENT', 'BUILDING_NON_PERMANENT', 'LAND'] as const;
export type FiscalAssetGroup = (typeof FISCAL_ASSET_GROUPS)[number];
export const FISCAL_ASSET_GROUP_INFO: Record<FiscalAssetGroup, { label: string; years: number; slRate: number; dbRate: number | null }> = {
  GROUP_1: { label: 'Kelompok 1 (4 tahun)', years: 4, slRate: 25, dbRate: 50 },
  GROUP_2: { label: 'Kelompok 2 (8 tahun)', years: 8, slRate: 12.5, dbRate: 25 },
  GROUP_3: { label: 'Kelompok 3 (16 tahun)', years: 16, slRate: 6.25, dbRate: 12.5 },
  GROUP_4: { label: 'Kelompok 4 (20 tahun)', years: 20, slRate: 5, dbRate: 10 },
  BUILDING_PERMANENT: { label: 'Bangunan permanen (20 tahun)', years: 20, slRate: 5, dbRate: null },
  BUILDING_NON_PERMANENT: { label: 'Bangunan tidak permanen (10 tahun)', years: 10, slRate: 10, dbRate: null },
  LAND: { label: 'Tanah (tidak disusutkan)', years: 0, slRate: 0, dbRate: null },
};

export const ASSET_STATUSES = ['ACTIVE', 'DISPOSED'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const RECURRING_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];
export const RECURRING_FREQUENCY_LABELS: Record<RecurringFrequency, string> = { MONTHLY: 'Bulanan', QUARTERLY: 'Triwulanan', YEARLY: 'Tahunan' };

// ---------- Setoran pajak ----------
export const TAX_PAYMENT_TYPES = ['PPN', 'PPH21', 'PPH23', 'PPH4_2', 'PPH25', 'PPH29', 'PPH_FINAL', 'BPJS'] as const;
export type TaxPaymentType = (typeof TAX_PAYMENT_TYPES)[number];
export const TAX_PAYMENT_LABELS: Record<TaxPaymentType, string> = {
  PPN: 'PPN',
  PPH21: 'PPh Pasal 21',
  PPH23: 'PPh Pasal 23',
  PPH4_2: 'PPh Pasal 4 ayat 2',
  PPH25: 'PPh Pasal 25 (angsuran)',
  PPH29: 'PPh Pasal 29 (tahunan)',
  PPH_FINAL: 'PPh final UMKM 0,5%',
  BPJS: 'Iuran BPJS',
};
export const WITHHOLDING_TYPES = ['PPH23', 'PPH4_2'] as const;
export const WITHHOLDING_LABELS: Record<(typeof WITHHOLDING_TYPES)[number], string> = {
  PPH23: 'PPh 23 (jasa 2%)',
  PPH4_2: 'PPh 4(2) (sewa bangunan 10%)',
};

/**
 * Batas akhir setor pajak untuk satu masa (period = 'YYYY-MM'), format YYYY-MM-DD.
 *  - PPh 21, 23, 4(2): tanggal 10 bulan berikutnya
 *  - PPh 25 dan PPh final UMKM: tanggal 15 bulan berikutnya
 *  - PPN: akhir bulan berikutnya (sebelum SPT Masa PPN)
 *  - PPh 29 badan (period = tahun pajak 'YYYY' atau 'YYYY-MM'): 30 April tahun berikutnya
 *  - BPJS: tanggal 10 bulan berikutnya (Kesehatan; Ketenagakerjaan tanggal 15 ditampilkan di rekap BPJS)
 * Ini tanggal nominal menurut peraturan; tenggat efektif (geser ke hari kerja berikutnya) ada di taxDeadline.
 */
export function taxDueDate(type: TaxPaymentType, period: string): string {
  const y = Number(period.slice(0, 4));
  if (type === 'PPH29') return `${y + 1}-04-30`;
  const m = Number(period.slice(5, 7));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const ym = `${ny}-${String(nm).padStart(2, '0')}`;
  if (type === 'PPN') {
    const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    return `${ym}-${String(last).padStart(2, '0')}`;
  }
  if (type === 'PPH25' || type === 'PPH_FINAL') return `${ym}-15`;
  return `${ym}-10`;
}

/**
 * Hari kerja pada atau setelah tanggal ini: lewati Sabtu, Minggu, dan hari libur yang diberikan (YYYY-MM-DD).
 * Dasar: bila batas waktu jatuh pada hari libur, penyetoran dan pelaporan dapat dilakukan pada hari kerja berikutnya.
 */
export function nextWorkday(date: string, holidays: readonly string[] = []): string {
  const off = new Set(holidays);
  const d = new Date(`${date}T00:00:00Z`);
  for (let i = 0; i < 31; i++) {
    const dow = d.getUTCDay();
    const iso = d.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !off.has(iso)) return iso;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return date;
}

/** Tenggat efektif setor/lapor: tanggal nominal (taxDueDate) digeser ke hari kerja berikutnya bila jatuh di akhir pekan atau hari libur */
export function taxDeadline(type: TaxPaymentType, period: string, holidays: readonly string[] = []): string {
  return nextWorkday(taxDueDate(type, period), holidays);
}
