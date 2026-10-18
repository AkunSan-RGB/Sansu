/**
 * Sumber uang masuk di luar penjualan, dalam bahasa kegiatan usaha (bukan akun pembukuan).
 * Keuangan memilih sumbernya; sistem yang menentukan akun dan membuat jurnalnya. Pembayaran pelanggan TIDAK termasuk
 * di sini: itu lewat Faktur & piutang (atau kasir) agar piutang ikut berkurang.
 */
export const CASH_IN_SOURCES = [
  { key: 'OWNER_CAPITAL', label: 'Modal dari pemilik', hint: 'Pemilik menyetor uang ke usaha (bukan pendapatan)', code: '3-1000', needsRef: true },
  { key: 'LOAN_BANK', label: 'Pinjaman bank diterima', hint: 'Pencairan kredit/pinjaman dari bank (bukan pendapatan)', code: '2-1800', needsRef: true },
  { key: 'LOAN_OTHER', label: 'Pinjaman dari pihak lain / pemilik', hint: 'Uang pinjaman yang harus dikembalikan (bukan pendapatan)', code: '2-1150', needsRef: true },
  { key: 'INTEREST', label: 'Bunga / jasa giro bank', hint: 'Bunga dari bank', code: '4-9100', needsRef: false },
  { key: 'RENT_INCOME', label: 'Pendapatan sewa', hint: 'Sewa atas aset yang Anda sewakan', code: '4-2200', needsRef: true },
  { key: 'OTHER_INCOME', label: 'Pendapatan lain-lain', hint: 'Penerimaan lain yang bukan penjualan; wajib ada bukti', code: '4-9000', needsRef: true },
] as const;
export type CashInSourceKey = (typeof CASH_IN_SOURCES)[number]['key'];
export const CASH_IN_SOURCE_KEYS = CASH_IN_SOURCES.map((s) => s.key) as unknown as readonly CashInSourceKey[];
export const cashInSource = (key: string | null | undefined) => CASH_IN_SOURCES.find((s) => s.key === key);
/** Sumber yang mengubah modal/utang: pemilik dan Akuntan perlu diberi tahu agar bisa memverifikasi */
export const CASH_IN_SOURCES_TO_VERIFY: readonly CashInSourceKey[] = ['OWNER_CAPITAL', 'LOAN_BANK', 'LOAN_OTHER', 'OTHER_INCOME'];

/**
 * Jenis uang keluar (biaya) dalam bahasa kegiatan usaha. Keuangan memilih jenisnya; sistem menentukan akun beban dan jurnalnya.
 * Pengeluaran yang bukan biaya (prive, bayar utang, pajak, aset) tidak ada di sini: itu lewat dokumennya atau dicatat Pemilik/Admin.
 */
export const CASH_OUT_SOURCES = [
  { key: 'OUT_ELECTRICITY', label: 'Listrik', hint: 'Tagihan listrik (PLN, token)', code: '6-4000', needsRef: false },
  { key: 'OUT_WATER', label: 'Air', hint: 'Tagihan air (PDAM, galon kantor)', code: '6-4100', needsRef: false },
  { key: 'OUT_PHONE', label: 'Telepon', hint: 'Tagihan telepon, pulsa', code: '6-4200', needsRef: false },
  { key: 'OUT_INTERNET', label: 'Internet', hint: 'Langganan internet/wifi', code: '6-4300', needsRef: false },
  { key: 'OUT_RENT', label: 'Sewa tempat', hint: 'Sewa toko, kantor, gudang', code: '6-3000', needsRef: true },
  { key: 'OUT_FUEL', label: 'Bensin / BBM', hint: 'Bahan bakar kendaraan operasional', code: '6-2000', needsRef: false },
  { key: 'OUT_PARKING', label: 'Parkir', hint: 'Biaya parkir', code: '6-2010', needsRef: false },
  { key: 'OUT_TOLL', label: 'Tol', hint: 'Biaya jalan tol', code: '6-2020', needsRef: false },
  { key: 'OUT_TRANSPORT', label: 'Ongkos transportasi', hint: 'Taksi/ojek online, angkutan umum', code: '6-2030', needsRef: false },
  { key: 'OUT_OFFICE', label: 'Perlengkapan kantor (ATK)', hint: 'Alat tulis, kertas, perlengkapan habis pakai', code: '6-6000', needsRef: false },
  { key: 'OUT_REPAIR', label: 'Perbaikan', hint: 'Perbaikan kerusakan', code: '6-7000', needsRef: false },
  { key: 'OUT_MAINTENANCE', label: 'Pemeliharaan', hint: 'Servis berkala, perawatan rutin', code: '6-7010', needsRef: false },
  { key: 'OUT_ADS', label: 'Iklan', hint: 'Pasang iklan', code: '6-2100', needsRef: false },
  { key: 'OUT_PROMO', label: 'Promosi', hint: 'Cetak brosur, hadiah, kegiatan promosi', code: '6-2105', needsRef: false },
  { key: 'OUT_INSURANCE', label: 'Asuransi', hint: 'Premi asuransi', code: '6-7100', needsRef: true },
  { key: 'OUT_PROFESSIONAL', label: 'Jasa profesional', hint: 'Akuntan, konsultan, notaris, pengacara', code: '6-7200', needsRef: true },
  { key: 'OUT_OTHER', label: 'Biaya lain-lain', hint: 'Biaya operasional lain; wajib ada bukti', code: '6-9000', needsRef: true },
] as const;
export type CashOutSourceKey = (typeof CASH_OUT_SOURCES)[number]['key'];
export const CASH_OUT_SOURCE_KEYS = CASH_OUT_SOURCES.map((s) => s.key) as unknown as readonly CashOutSourceKey[];
export const cashOutSource = (key: string | null | undefined) => CASH_OUT_SOURCES.find((s) => s.key === key);
/** Semua kunci sumber (masuk + keluar) yang diterima API */
export const CASH_SOURCE_KEYS = [...CASH_IN_SOURCE_KEYS, ...CASH_OUT_SOURCE_KEYS] as readonly (CashInSourceKey | CashOutSourceKey)[];
