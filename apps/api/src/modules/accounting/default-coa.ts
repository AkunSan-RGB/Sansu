import type { BusinessModel, FiscalTreatment, ReportGroup, ReportingFramework } from '@sansu/shared';
import { AccountType } from '../../db/schema';

/** Kunci akun sistem yang dipakai jurnal otomatis. */
export const SYS = {
  CASH: 'CASH',
  BANK: 'BANK',
  AR: 'AR',
  INVENTORY: 'INVENTORY',
  INVENTORY_SEMI: 'INVENTORY_SEMI',
  VAT_IN: 'VAT_IN',
  AP: 'AP',
  VAT_OUT: 'VAT_OUT',
  EQUITY: 'EQUITY',
  RETAINED: 'RETAINED',
  OPENING_EQUITY: 'OPENING_EQUITY',
  SALES: 'SALES',
  COGS: 'COGS',
  INVENTORY_ADJ: 'INVENTORY_ADJ',
  INVENTORY_WRITEDOWN: 'INVENTORY_WRITEDOWN',
  INVENTORY_TRANSIT: 'INVENTORY_TRANSIT',
  SALES_RETURN: 'SALES_RETURN',
  EMPLOYEE_RECEIVABLE: 'EMPLOYEE_RECEIVABLE',
  SALARY_PAYABLE: 'SALARY_PAYABLE',
  BPJS_PAYABLE: 'BPJS_PAYABLE',
  PPH21_PAYABLE: 'PPH21_PAYABLE',
  SALARY_EXPENSE: 'SALARY_EXPENSE',
  BPJS_EXPENSE: 'BPJS_EXPENSE',
  CASH_DIFF: 'CASH_DIFF',
  PREPAID_TAX: 'PREPAID_TAX',
  OTHER_PAYABLE: 'OTHER_PAYABLE',
  GRNI: 'GRNI',
  CORPORATE_TAX_PAYABLE: 'CORPORATE_TAX_PAYABLE',
  DEFERRED_TAX_ASSET: 'DEFERRED_TAX_ASSET',
  DEFERRED_TAX_LIABILITY: 'DEFERRED_TAX_LIABILITY',
  DEPRECIATION_EXPENSE: 'DEPRECIATION_EXPENSE',
  ASSET_DISPOSAL_GAIN: 'ASSET_DISPOSAL_GAIN',
  ASSET_DISPOSAL_LOSS: 'ASSET_DISPOSAL_LOSS',
  CURRENT_TAX_EXPENSE: 'CURRENT_TAX_EXPENSE',
  DEFERRED_TAX_EXPENSE: 'DEFERRED_TAX_EXPENSE',
  DIVIDEND: 'DIVIDEND',
  PPH23_PAYABLE: 'PPH23_PAYABLE',
  PPH4_2_PAYABLE: 'PPH4_2_PAYABLE',
  BANK_CHARGES: 'BANK_CHARGES',
  INTEREST_INCOME: 'INTEREST_INCOME',
  FINAL_TAX_EXPENSE: 'FINAL_TAX_EXPENSE',
  MARKETPLACE_FEE: 'MARKETPLACE_FEE',
  SERVICE_REVENUE: 'SERVICE_REVENUE',
  CONSTRUCTION_REVENUE: 'CONSTRUCTION_REVENUE',
  RENTAL_REVENUE: 'RENTAL_REVENUE',
  CUSTOMER_DEPOSIT: 'CUSTOMER_DEPOSIT',
  FINAL_TAX_WITHHELD: 'FINAL_TAX_WITHHELD',
  UNBILLED_REVENUE: 'UNBILLED_REVENUE',
  CONTRACT_LIABILITY: 'CONTRACT_LIABILITY',
  WIP: 'WIP',
  DIRECT_LABOR: 'DIRECT_LABOR',
  FACTORY_OVERHEAD: 'FACTORY_OVERHEAD',
  APPLIED_PRODUCTION_COST: 'APPLIED_PRODUCTION_COST',
  SMALL_ASSET_EXPENSE: 'SMALL_ASSET_EXPENSE',
} as const;
export type SystemKey = (typeof SYS)[keyof typeof SYS];

export interface CoaRow {
  code: string;
  name: string;
  type: AccountType;
  parent?: string;
  header?: boolean;
  key?: SystemKey;
  /** Akun kas / bank */
  cash?: boolean;
  /** Kelompok penyajian laporan keuangan (SAK EP) */
  group?: ReportGroup;
  fiscal?: FiscalTreatment;
  /** Akun khusus jenis usaha: hanya dibuat untuk model ini (kosong = semua model). Tidak pernah dihapus bila model diganti. */
  models?: BusinessModel[];
  /** Nama khusus jenis usaha untuk akun inti (bila tidak ada: pakai `name`). Hanya menggantikan nama bawaan, tidak pernah nama yang sudah diubah pengguna. */
  names?: Partial<Record<BusinessModel, string>>;
  /** Akun bukan-sistem yang tidak relevan untuk jenis usaha ini: tidak dibuat (yang sudah ada dibiarkan) */
  skip?: BusinessModel[];
}

/** Nama akun untuk satu jenis usaha */
export const coaName = (row: CoaRow, model: BusinessModel) => row.names?.[model] ?? row.name;
/** Semua nama bawaan yang pernah dipakai sebuah akun: dipakai untuk memastikan hanya nama bawaan yang diganti */
export const coaNameVariants = (row: CoaRow) => new Set([row.name, ...Object.values(row.names ?? {})]);

/**
 * Bagan akun standar perusahaan dagang/distribusi, disusun mengikuti struktur
 * laporan posisi keuangan & laba rugi SAK EP (lancar / tidak lancar, fungsi beban).
 * Urutan wajib induk → anak. Kode lama tidak diubah agar data perusahaan lama tetap valid.
 */
export const DEFAULT_COA: CoaRow[] = [
  // ===== 1 ASET =====
  { code: '1-0000', name: 'Aset', type: 'ASSET', header: true },
  { code: '1-1000', name: 'Aset Lancar', type: 'ASSET', parent: '1-0000', header: true },
  { code: '1-1100', name: 'Kas', type: 'ASSET', parent: '1-1000', key: SYS.CASH, cash: true, group: 'CASH_EQUIVALENT' },
  { code: '1-1110', name: 'Kas Kecil', type: 'ASSET', parent: '1-1000', cash: true, group: 'CASH_EQUIVALENT' },
  { code: '1-1200', name: 'Bank', type: 'ASSET', parent: '1-1000', key: SYS.BANK, cash: true, group: 'CASH_EQUIVALENT' },
  { code: '1-1300', name: 'Piutang Usaha', type: 'ASSET', parent: '1-1000', key: SYS.AR, group: 'TRADE_RECEIVABLE' },
  { code: '1-1310', name: 'Cadangan Kerugian Penurunan Nilai Piutang', type: 'ASSET', parent: '1-1000', group: 'ALLOWANCE_RECEIVABLE' },
  { code: '1-1350', name: 'Piutang Lain-lain', type: 'ASSET', parent: '1-1000', group: 'OTHER_RECEIVABLE' },
  { code: '1-1360', name: 'Pendapatan Belum Ditagih (Aset Kontrak)', type: 'ASSET', parent: '1-1000', key: SYS.UNBILLED_REVENUE, group: 'OTHER_CURRENT_ASSET' },
  { code: '1-1130', name: 'Piutang Pembayaran Digital (QRIS & Kartu, Belum Cair)', type: 'ASSET', parent: '1-1000', group: 'OTHER_RECEIVABLE', models: ['RITEL'] },
  { code: '1-1380', name: 'Piutang Retensi Proyek', type: 'ASSET', parent: '1-1000', group: 'OTHER_RECEIVABLE', models: ['JASA'] },
  { code: '1-1400', name: 'Persediaan Barang Dagang', type: 'ASSET', parent: '1-1000', key: SYS.INVENTORY, group: 'INVENTORY', names: { PRODUKSI: 'Persediaan Bahan Baku & Barang Jadi', MANUFAKTUR: 'Persediaan Bahan Baku & Barang Jadi', JASA: 'Persediaan Bahan & Perlengkapan' } },
  { code: '1-1410', name: 'Persediaan dalam Perjalanan', type: 'ASSET', parent: '1-1000', key: SYS.INVENTORY_TRANSIT, group: 'INVENTORY' },
  { code: '1-1430', name: 'Persediaan Barang Setengah Jadi', type: 'ASSET', parent: '1-1000', key: SYS.INVENTORY_SEMI, group: 'INVENTORY' },
  { code: '1-1420', name: 'Barang dalam Proses Produksi', type: 'ASSET', parent: '1-1000', key: SYS.WIP, group: 'INVENTORY' },
  { code: '1-1500', name: 'PPN Masukan', type: 'ASSET', parent: '1-1000', key: SYS.VAT_IN, group: 'PREPAID_TAX' },
  { code: '1-1510', name: 'Pajak Dibayar Dimuka (PPh 22, 23, 25)', type: 'ASSET', parent: '1-1000', key: SYS.PREPAID_TAX, group: 'PREPAID_TAX' },
  { code: '1-1600', name: 'Piutang Karyawan (Kasbon)', type: 'ASSET', parent: '1-1000', key: SYS.EMPLOYEE_RECEIVABLE, group: 'OTHER_RECEIVABLE' },
  { code: '1-1700', name: 'Sewa Dibayar Dimuka', type: 'ASSET', parent: '1-1000', group: 'PREPAID' },
  { code: '1-1710', name: 'Asuransi Dibayar Dimuka', type: 'ASSET', parent: '1-1000', group: 'PREPAID' },
  { code: '1-1720', name: 'Uang Muka Pembelian', type: 'ASSET', parent: '1-1000', group: 'PREPAID' },

  { code: '1-2000', name: 'Aset Tidak Lancar', type: 'ASSET', parent: '1-0000', header: true },
  { code: '1-2050', name: 'Tanah', type: 'ASSET', parent: '1-2000', group: 'FIXED_ASSET' },
  { code: '1-2060', name: 'Bangunan', type: 'ASSET', parent: '1-2000', group: 'FIXED_ASSET' },
  { code: '1-2100', name: 'Kendaraan', type: 'ASSET', parent: '1-2000', group: 'FIXED_ASSET' },
  { code: '1-2200', name: 'Peralatan Gudang & Mesin', type: 'ASSET', parent: '1-2000', group: 'FIXED_ASSET', names: { PRODUKSI: 'Mesin & Peralatan Produksi', MANUFAKTUR: 'Mesin & Peralatan Produksi', RITEL: 'Peralatan Toko & Rak', JASA: 'Peralatan & Perkakas Kerja' } },
  { code: '1-2300', name: 'Inventaris Kantor', type: 'ASSET', parent: '1-2000', group: 'FIXED_ASSET' },
  { code: '1-2500', name: 'Aset Takberwujud (Perangkat Lunak)', type: 'ASSET', parent: '1-2000', group: 'INTANGIBLE_ASSET' },
  { code: '1-2600', name: 'Aset Pajak Tangguhan', type: 'ASSET', parent: '1-2000', key: SYS.DEFERRED_TAX_ASSET, group: 'DEFERRED_TAX_ASSET' },
  { code: '1-2700', name: 'Uang Jaminan', type: 'ASSET', parent: '1-2000', group: 'OTHER_NONCURRENT_ASSET' },
  { code: '1-2900', name: 'Akumulasi Penyusutan Kendaraan', type: 'ASSET', parent: '1-2000', group: 'ACCUMULATED_DEPRECIATION' },
  { code: '1-2910', name: 'Akumulasi Penyusutan Bangunan', type: 'ASSET', parent: '1-2000', group: 'ACCUMULATED_DEPRECIATION' },
  { code: '1-2920', name: 'Akumulasi Penyusutan Peralatan & Mesin', type: 'ASSET', parent: '1-2000', group: 'ACCUMULATED_DEPRECIATION' },
  { code: '1-2930', name: 'Akumulasi Penyusutan Inventaris Kantor', type: 'ASSET', parent: '1-2000', group: 'ACCUMULATED_DEPRECIATION' },
  { code: '1-2950', name: 'Akumulasi Amortisasi', type: 'ASSET', parent: '1-2000', group: 'ACCUMULATED_AMORTIZATION' },

  // ===== 2 LIABILITAS =====
  { code: '2-0000', name: 'Liabilitas', type: 'LIABILITY', header: true },
  { code: '2-1000', name: 'Liabilitas Jangka Pendek', type: 'LIABILITY', parent: '2-0000', header: true },
  { code: '2-1100', name: 'Utang Usaha', type: 'LIABILITY', parent: '2-1000', key: SYS.AP, group: 'TRADE_PAYABLE' },
  { code: '2-1150', name: 'Utang Lain-lain', type: 'LIABILITY', parent: '2-1000', key: SYS.OTHER_PAYABLE, group: 'OTHER_PAYABLE' },
  { code: '2-1160', name: 'Barang Diterima Belum Ditagih', type: 'LIABILITY', parent: '2-1000', key: SYS.GRNI, group: 'ACCRUED_EXPENSE' },
  { code: '2-1200', name: 'PPN Keluaran', type: 'LIABILITY', parent: '2-1000', key: SYS.VAT_OUT, group: 'TAX_PAYABLE' },
  { code: '2-1300', name: 'Utang Pajak Lainnya', type: 'LIABILITY', parent: '2-1000', group: 'TAX_PAYABLE' },
  { code: '2-1310', name: 'Utang PPh Pasal 21', type: 'LIABILITY', parent: '2-1000', key: SYS.PPH21_PAYABLE, group: 'TAX_PAYABLE' },
  { code: '2-1320', name: 'Utang PPh Pasal 23', type: 'LIABILITY', parent: '2-1000', key: SYS.PPH23_PAYABLE, group: 'TAX_PAYABLE' },
  { code: '2-1340', name: 'Utang PPh Pasal 4 ayat 2', type: 'LIABILITY', parent: '2-1000', key: SYS.PPH4_2_PAYABLE, group: 'TAX_PAYABLE' },
  { code: '2-1330', name: 'Utang PPh Badan (Pasal 29)', type: 'LIABILITY', parent: '2-1000', key: SYS.CORPORATE_TAX_PAYABLE, group: 'TAX_PAYABLE' },
  { code: '2-1400', name: 'Utang Gaji', type: 'LIABILITY', parent: '2-1000', key: SYS.SALARY_PAYABLE, group: 'ACCRUED_EXPENSE' },
  { code: '2-1500', name: 'Utang BPJS', type: 'LIABILITY', parent: '2-1000', key: SYS.BPJS_PAYABLE, group: 'ACCRUED_EXPENSE' },
  { code: '2-1600', name: 'Beban Masih Harus Dibayar', type: 'LIABILITY', parent: '2-1000', group: 'ACCRUED_EXPENSE' },
  { code: '2-1700', name: 'Uang Muka Pelanggan', type: 'LIABILITY', parent: '2-1000', key: SYS.CUSTOMER_DEPOSIT, group: 'UNEARNED_REVENUE' },
  { code: '2-1750', name: 'Pendapatan Diterima Dimuka (Liabilitas Kontrak)', type: 'LIABILITY', parent: '2-1000', key: SYS.CONTRACT_LIABILITY, group: 'UNEARNED_REVENUE' },
  { code: '2-1760', name: 'Utang Retensi Proyek (Ditahan)', type: 'LIABILITY', parent: '2-1000', group: 'OTHER_PAYABLE', models: ['JASA'] },
  { code: '2-1800', name: 'Utang Bank Jangka Pendek', type: 'LIABILITY', parent: '2-1000', group: 'SHORT_TERM_LOAN' },
  { code: '2-2000', name: 'Liabilitas Jangka Panjang', type: 'LIABILITY', parent: '2-0000', header: true },
  { code: '2-2100', name: 'Utang Bank Jangka Panjang', type: 'LIABILITY', parent: '2-2000', group: 'LONG_TERM_LOAN' },
  { code: '2-2200', name: 'Liabilitas Imbalan Kerja', type: 'LIABILITY', parent: '2-2000', group: 'EMPLOYEE_BENEFIT' },
  { code: '2-2300', name: 'Liabilitas Pajak Tangguhan', type: 'LIABILITY', parent: '2-2000', key: SYS.DEFERRED_TAX_LIABILITY, group: 'DEFERRED_TAX_LIABILITY' },

  // ===== 3 EKUITAS =====
  { code: '3-0000', name: 'Ekuitas', type: 'EQUITY', header: true },
  { code: '3-1000', name: 'Modal Disetor', type: 'EQUITY', parent: '3-0000', key: SYS.EQUITY, group: 'SHARE_CAPITAL' },
  { code: '3-1100', name: 'Tambahan Modal Disetor', type: 'EQUITY', parent: '3-0000', group: 'ADDITIONAL_CAPITAL' },
  { code: '3-2000', name: 'Saldo Laba', type: 'EQUITY', parent: '3-0000', key: SYS.RETAINED, group: 'RETAINED_EARNINGS' },
  { code: '3-3000', name: 'Dividen / Prive', type: 'EQUITY', parent: '3-0000', key: SYS.DIVIDEND, group: 'DIVIDEND' },
  { code: '3-9000', name: 'Ekuitas Saldo Awal', type: 'EQUITY', parent: '3-0000', key: SYS.OPENING_EQUITY, group: 'OTHER_EQUITY' },

  // ===== 4 PENDAPATAN =====
  { code: '4-0000', name: 'Pendapatan', type: 'REVENUE', header: true },
  { code: '4-1000', name: 'Penjualan', type: 'REVENUE', parent: '4-0000', key: SYS.SALES, group: 'SALES_REVENUE', names: { RITEL: 'Penjualan Toko (Kasir)', PRODUKSI: 'Penjualan Hasil Produksi', MANUFAKTUR: 'Penjualan Hasil Produksi', JASA: 'Penjualan Barang & Material' } },
  { code: '4-1100', name: 'Retur Penjualan', type: 'REVENUE', parent: '4-0000', key: SYS.SALES_RETURN, group: 'SALES_DEDUCTION' },
  { code: '4-1200', name: 'Potongan Penjualan', type: 'REVENUE', parent: '4-0000', group: 'SALES_DEDUCTION' },
  { code: '4-2000', name: 'Pendapatan Jasa', type: 'REVENUE', parent: '4-0000', key: SYS.SERVICE_REVENUE, group: 'SALES_REVENUE' },
  { code: '4-2100', name: 'Pendapatan Jasa Konstruksi (PPh Final)', type: 'REVENUE', parent: '4-0000', key: SYS.CONSTRUCTION_REVENUE, group: 'SALES_REVENUE', fiscal: 'FINAL_INCOME' },
  { code: '4-2200', name: 'Pendapatan Sewa (PPh Final)', type: 'REVENUE', parent: '4-0000', key: SYS.RENTAL_REVENUE, group: 'SALES_REVENUE', fiscal: 'FINAL_INCOME' },
  { code: '4-9000', name: 'Pendapatan Lain-lain', type: 'REVENUE', parent: '4-0000', group: 'OTHER_INCOME' },
  { code: '4-9100', name: 'Pendapatan Bunga / Jasa Giro', type: 'REVENUE', parent: '4-0000', key: SYS.INTEREST_INCOME, group: 'FINANCE_INCOME', fiscal: 'FINAL_INCOME' },
  { code: '4-9200', name: 'Laba Pelepasan Aset Tetap', type: 'REVENUE', parent: '4-0000', key: SYS.ASSET_DISPOSAL_GAIN, group: 'OTHER_INCOME' },

  // ===== 5 BEBAN POKOK =====
  { code: '5-0000', name: 'Beban Pokok', type: 'EXPENSE', header: true },
  { code: '5-1000', name: 'Harga Pokok Penjualan', type: 'EXPENSE', parent: '5-0000', key: SYS.COGS, group: 'COST_OF_SALES', names: { PRODUKSI: 'Harga Pokok Penjualan (Produk Jadi)', MANUFAKTUR: 'Harga Pokok Penjualan (Produk Jadi)', JASA: 'Beban Pokok Pendapatan (Barang & Material)' } },
  { code: '5-2000', name: 'Selisih Persediaan', type: 'EXPENSE', parent: '5-0000', key: SYS.INVENTORY_ADJ, group: 'COST_OF_SALES' },
  { code: '5-4100', name: 'Upah Langsung Produksi', type: 'EXPENSE', parent: '5-0000', key: SYS.DIRECT_LABOR, group: 'COST_OF_SALES' },
  { code: '5-4200', name: 'Overhead Pabrik (listrik, penyusutan mesin, dll.)', type: 'EXPENSE', parent: '5-0000', key: SYS.FACTORY_OVERHEAD, group: 'COST_OF_SALES' },
  { code: '5-4900', name: 'Biaya Produksi Dibebankan ke Persediaan', type: 'EXPENSE', parent: '5-0000', key: SYS.APPLIED_PRODUCTION_COST, group: 'COST_OF_SALES' },
  { code: '5-1500', name: 'Beban Subkontraktor', type: 'EXPENSE', parent: '5-0000', group: 'COST_OF_SALES', models: ['JASA'] },
  { code: '5-1600', name: 'Beban Bahan & Material Proyek', type: 'EXPENSE', parent: '5-0000', group: 'COST_OF_SALES', models: ['JASA'] },
  { code: '5-1700', name: 'Upah Langsung Proyek', type: 'EXPENSE', parent: '5-0000', group: 'COST_OF_SALES', models: ['JASA'] },
  { code: '5-4300', name: 'Beban Bahan Penolong & Kemasan Produksi', type: 'EXPENSE', parent: '5-0000', group: 'COST_OF_SALES', models: ['PRODUKSI', 'MANUFAKTUR'] },
  { code: '5-4400', name: 'Beban Pemeliharaan Mesin Produksi', type: 'EXPENSE', parent: '5-0000', group: 'COST_OF_SALES', models: ['PRODUKSI', 'MANUFAKTUR'] },
  { code: '5-1100', name: 'Beban Angkut Pembelian', type: 'EXPENSE', parent: '5-0000', group: 'COST_OF_SALES', models: ['DAGANG'] },
  { code: '5-1200', name: 'Potongan & Retur Pembelian', type: 'EXPENSE', parent: '5-0000', group: 'COST_OF_SALES', models: ['DAGANG'] },
  { code: '5-1300', name: 'Kerugian Susut & Barang Rusak Toko', type: 'EXPENSE', parent: '5-0000', group: 'COST_OF_SALES', models: ['RITEL'] },
  { code: '5-1800', name: 'Beban Tenaga Ahli & Konsultan Eksternal', type: 'EXPENSE', parent: '5-0000', group: 'COST_OF_SALES', models: ['JASA'] },
  { code: '5-1900', name: 'Beban Sewa Alat & Peralatan Proyek', type: 'EXPENSE', parent: '5-0000', group: 'COST_OF_SALES', models: ['JASA'] },
  { code: '5-4500', name: 'Beban Energi Produksi (Listrik, Gas, BBM)', type: 'EXPENSE', parent: '5-0000', group: 'COST_OF_SALES', models: ['PRODUKSI', 'MANUFAKTUR'] },
  { code: '5-4600', name: 'Beban Pengujian & Pengendalian Mutu', type: 'EXPENSE', parent: '5-0000', group: 'COST_OF_SALES', models: ['PRODUKSI', 'MANUFAKTUR'] },
  { code: '5-4700', name: 'Beban Kemasan Produk Jadi', type: 'EXPENSE', parent: '5-0000', group: 'COST_OF_SALES', models: ['PRODUKSI', 'MANUFAKTUR'] },
  { code: '5-4800', name: 'Selisih Hasil Produksi (Susut & Cacat)', type: 'EXPENSE', parent: '5-0000', group: 'COST_OF_SALES', models: ['PRODUKSI', 'MANUFAKTUR'] },
  { code: '5-4950', name: 'Beban Jasa Maklon (Subkontrak Produksi)', type: 'EXPENSE', parent: '5-0000', group: 'COST_OF_SALES', models: ['MANUFAKTUR'] },
  { code: '5-3000', name: 'Kerugian Penurunan Nilai Persediaan', type: 'EXPENSE', parent: '5-0000', key: SYS.INVENTORY_WRITEDOWN, group: 'COST_OF_SALES', fiscal: 'NON_DEDUCTIBLE' },

  // ===== 6 BEBAN USAHA =====
  { code: '6-0000', name: 'Beban Usaha', type: 'EXPENSE', header: true },
  { code: '6-1000', name: 'Beban Gaji & Tunjangan', type: 'EXPENSE', parent: '6-0000', key: SYS.SALARY_EXPENSE, group: 'ADMIN_EXPENSE' },
  { code: '6-1100', name: 'Beban BPJS Perusahaan', type: 'EXPENSE', parent: '6-0000', key: SYS.BPJS_EXPENSE, group: 'ADMIN_EXPENSE' },
  { code: '6-2000', name: 'Beban Transportasi & BBM', type: 'EXPENSE', parent: '6-0000', group: 'SELLING_EXPENSE' },
  { code: '6-2100', name: 'Beban Iklan & Promosi', type: 'EXPENSE', parent: '6-0000', group: 'SELLING_EXPENSE' },
  { code: '6-2200', name: 'Beban Komisi Penjualan', type: 'EXPENSE', parent: '6-0000', group: 'SELLING_EXPENSE', skip: ['RITEL'] },
  { code: '6-2300', name: 'Beban Pengiriman', type: 'EXPENSE', parent: '6-0000', group: 'SELLING_EXPENSE', skip: ['JASA'] },
  { code: '6-2400', name: 'Beban Komisi & Layanan Marketplace', type: 'EXPENSE', parent: '6-0000', key: SYS.MARKETPLACE_FEE, group: 'SELLING_EXPENSE' },
  { code: '6-3000', name: 'Beban Sewa', type: 'EXPENSE', parent: '6-0000', group: 'ADMIN_EXPENSE' },
  { code: '6-4000', name: 'Beban Listrik, Air & Telepon', type: 'EXPENSE', parent: '6-0000', group: 'ADMIN_EXPENSE' },
  { code: '6-5000', name: 'Beban Penyusutan', type: 'EXPENSE', parent: '6-0000', key: SYS.DEPRECIATION_EXPENSE, group: 'ADMIN_EXPENSE' },
  { code: '6-5100', name: 'Beban Amortisasi', type: 'EXPENSE', parent: '6-0000', group: 'ADMIN_EXPENSE' },
  { code: '6-6000', name: 'Beban Perlengkapan Kantor', type: 'EXPENSE', parent: '6-0000', group: 'ADMIN_EXPENSE' },
  { code: '6-6100', name: 'Beban Peralatan Kecil (di Bawah Batas Kapitalisasi)', type: 'EXPENSE', parent: '6-0000', key: SYS.SMALL_ASSET_EXPENSE, group: 'ADMIN_EXPENSE' },
  // --- Akun khusus jenis usaha ---
  { code: '6-2350', name: 'Beban Bongkar Muat & Pengemasan', type: 'EXPENSE', parent: '6-0000', group: 'SELLING_EXPENSE', models: ['DAGANG'] },
  { code: '6-2450', name: 'Beban Biaya Pembayaran Digital (MDR QRIS & Kartu)', type: 'EXPENSE', parent: '6-0000', group: 'SELLING_EXPENSE', models: ['RITEL'] },
  { code: '6-2500', name: 'Beban Kantong & Kemasan Toko', type: 'EXPENSE', parent: '6-0000', group: 'SELLING_EXPENSE', models: ['RITEL'] },
  { code: '6-2600', name: 'Beban Keamanan & Kebersihan Toko', type: 'EXPENSE', parent: '6-0000', group: 'ADMIN_EXPENSE', models: ['RITEL'] },
  { code: '6-2700', name: 'Beban Distribusi Hasil Produksi', type: 'EXPENSE', parent: '6-0000', group: 'SELLING_EXPENSE', models: ['PRODUKSI', 'MANUFAKTUR'] },
  { code: '6-3700', name: 'Beban Lisensi & Langganan Perangkat Lunak', type: 'EXPENSE', parent: '6-0000', group: 'ADMIN_EXPENSE', models: ['JASA'] },
  { code: '6-3800', name: 'Beban Pelatihan & Sertifikasi', type: 'EXPENSE', parent: '6-0000', group: 'ADMIN_EXPENSE', models: ['JASA'] },
  { code: '6-3600', name: 'Beban Perjalanan Dinas', type: 'EXPENSE', parent: '6-0000', group: 'ADMIN_EXPENSE', models: ['JASA'] },
  { code: '6-7000', name: 'Beban Perbaikan & Pemeliharaan', type: 'EXPENSE', parent: '6-0000', group: 'ADMIN_EXPENSE' },
  { code: '6-7100', name: 'Beban Asuransi', type: 'EXPENSE', parent: '6-0000', group: 'ADMIN_EXPENSE' },
  { code: '6-7200', name: 'Beban Jasa Profesional', type: 'EXPENSE', parent: '6-0000', group: 'ADMIN_EXPENSE' },
  { code: '6-7300', name: 'Beban Kerugian Penurunan Nilai Piutang', type: 'EXPENSE', parent: '6-0000', group: 'ADMIN_EXPENSE', fiscal: 'NON_DEDUCTIBLE' },
  { code: '6-8000', name: 'Beban Jamuan & Representasi', type: 'EXPENSE', parent: '6-0000', group: 'ADMIN_EXPENSE', fiscal: 'NON_DEDUCTIBLE' },
  { code: '6-8100', name: 'Beban Sumbangan', type: 'EXPENSE', parent: '6-0000', group: 'ADMIN_EXPENSE', fiscal: 'NON_DEDUCTIBLE' },
  { code: '6-8200', name: 'Beban Pajak, Denda & Sanksi', type: 'EXPENSE', parent: '6-0000', group: 'ADMIN_EXPENSE', fiscal: 'NON_DEDUCTIBLE' },
  { code: '6-9000', name: 'Beban Lain-lain', type: 'EXPENSE', parent: '6-0000', group: 'ADMIN_EXPENSE' },
  { code: '6-9100', name: 'Selisih Kas Kasir', type: 'EXPENSE', parent: '6-0000', key: SYS.CASH_DIFF, group: 'OTHER_EXPENSE' },

  // ===== 8 BEBAN LAIN & KEUANGAN =====
  { code: '8-0000', name: 'Beban Lain-lain & Keuangan', type: 'EXPENSE', header: true },
  { code: '8-1000', name: 'Beban Bunga Pinjaman', type: 'EXPENSE', parent: '8-0000', group: 'FINANCE_COST' },
  { code: '8-1100', name: 'Beban Administrasi Bank', type: 'EXPENSE', parent: '8-0000', key: SYS.BANK_CHARGES, group: 'FINANCE_COST' },
  { code: '8-2000', name: 'Rugi Pelepasan Aset Tetap', type: 'EXPENSE', parent: '8-0000', key: SYS.ASSET_DISPOSAL_LOSS, group: 'OTHER_EXPENSE' },
  { code: '8-3000', name: 'Rugi Selisih Kurs', type: 'EXPENSE', parent: '8-0000', group: 'OTHER_EXPENSE' },

  // ===== 9 PAJAK PENGHASILAN =====
  { code: '9-0000', name: 'Pajak Penghasilan', type: 'EXPENSE', header: true },
  { code: '9-1000', name: 'Beban Pajak Kini', type: 'EXPENSE', parent: '9-0000', key: SYS.CURRENT_TAX_EXPENSE, group: 'INCOME_TAX', fiscal: 'NON_DEDUCTIBLE' },
  { code: '9-1100', name: 'Beban (Manfaat) Pajak Tangguhan', type: 'EXPENSE', parent: '9-0000', key: SYS.DEFERRED_TAX_EXPENSE, group: 'INCOME_TAX', fiscal: 'NON_DEDUCTIBLE' },
  { code: '9-1200', name: 'Beban PPh Final (UMKM 0,5%)', type: 'EXPENSE', parent: '9-0000', key: SYS.FINAL_TAX_EXPENSE, group: 'INCOME_TAX', fiscal: 'NON_DEDUCTIBLE' },
  { code: '9-1300', name: 'Beban PPh Final Pasal 4(2) Dipotong Pelanggan', type: 'EXPENSE', parent: '9-0000', key: SYS.FINAL_TAX_WITHHELD, group: 'INCOME_TAX', fiscal: 'NON_DEDUCTIBLE' },
];

/** Tebakan kelompok laporan untuk akun buatan pengguna yang belum diklasifikasi */
export function guessReportGroup(code: string, type: AccountType): ReportGroup {
  const p2 = code.slice(0, 3);
  switch (type) {
    case 'ASSET':
      return p2 === '1-2' ? 'FIXED_ASSET' : 'OTHER_CURRENT_ASSET';
    case 'LIABILITY':
      return p2 === '2-2' ? 'OTHER_NONCURRENT_LIABILITY' : 'OTHER_PAYABLE';
    case 'EQUITY':
      return 'OTHER_EQUITY';
    case 'REVENUE':
      return code.startsWith('4-1') ? 'SALES_REVENUE' : 'OTHER_INCOME';
    default:
      if (code.startsWith('5-')) return 'COST_OF_SALES';
      if (code.startsWith('8-')) return 'OTHER_EXPENSE';
      if (code.startsWith('9-')) return 'INCOME_TAX';
      return 'ADMIN_EXPENSE';
  }
}


/** Penanda pada keterangan akun yang dinonaktifkan otomatis karena tidak relevan untuk jenis usaha (agar bisa dibedakan dari nonaktif buatan pengguna) */
export const COA_UNUSED_MARK = 'Tidak dipakai pada jenis usaha ini. Aktifkan bila diperlukan.';

/**
 * Kelompok akun yang hanya relevan untuk jenis usaha, aplikasi, atau standar pelaporan (SAK EP / SAK EMKM) tertentu. Akun di luar relevansi dinonaktifkan
 * (tersembunyi dari pilihan jurnal manual dan bagan akun) selama belum pernah dipakai; jurnal otomatis tetap bisa memakainya.
 */
export const COA_FAMILIES: { name: string; codes: string[]; relevant: (model: BusinessModel, apps: ReadonlySet<string>, framework: ReportingFramework) => boolean }[] = [
  { name: 'Persediaan', codes: ['1-1400', '1-1410', '5-2000', '2-1160'], relevant: (m, a) => m !== 'JASA' || a.has('inventory') },
  // ED SAK EMKM Bab 9: persediaan diukur sebesar biaya perolehan, tanpa penurunan ke nilai realisasi neto
  { name: 'Penurunan nilai persediaan', codes: ['5-3000'], relevant: (m, a, fw) => fw !== 'SAK_EMKM' && (m !== 'JASA' || a.has('inventory')) },
  // ED SAK EMKM Bab 8: piutang dicatat sebesar jumlah tagihan; tidak ada cadangan kerugian penurunan nilai (kerugian diakui saat dihapus)
  { name: 'Penurunan nilai piutang', codes: ['1-1310', '6-7300'], relevant: (_m, _a, fw) => fw !== 'SAK_EMKM' },
  { name: 'Produksi', codes: ['1-1420', '1-1430', '5-4100', '5-4200', '5-4900'], relevant: (m) => m === 'PRODUKSI' || m === 'MANUFAKTUR' },
  { name: 'Manufaktur', codes: ['5-4950'], relevant: (m) => m === 'MANUFAKTUR' },
  { name: 'Kontrak jasa & proyek', codes: ['4-2100'], relevant: (m, a) => m === 'JASA' || a.has('crm') },
  // Aset/liabilitas kontrak hanya timbul dari pengakuan pendapatan berdasarkan persentase penyelesaian (SAK EP); EMKM mengakui sebesar tagihan (ED 14.5)
  { name: 'Aset & liabilitas kontrak', codes: ['1-1360', '2-1750'], relevant: (m, a, fw) => fw !== 'SAK_EMKM' && (m === 'JASA' || a.has('crm')) },
  { name: 'Marketplace', codes: ['6-2400'], relevant: (m) => m !== 'JASA' },
  { name: 'Kasir', codes: ['6-9100'], relevant: (m, a) => m === 'RITEL' || a.has('pos') },
  // SAK EMKM tidak mengakui pajak tangguhan (pajak penghasilan diakui sebesar pajak kini)
  { name: 'Pajak tangguhan', codes: ['1-2600', '2-2300', '9-1100'], relevant: (_m, _a, fw) => fw !== 'SAK_EMKM' },
  // SAK EMKM tidak memiliki bab imbalan kerja dan tidak mengakui provisi: gaji dan tunjangan diakui sebagai beban pada saat terjadi (akrual),
  // sehingga liabilitas imbalan pascakerja hasil perhitungan aktuaria hanya untuk SAK EP
  { name: 'Imbalan kerja jangka panjang', codes: ['2-2200'], relevant: (_m, _a, fw) => fw !== 'SAK_EMKM' },
];
