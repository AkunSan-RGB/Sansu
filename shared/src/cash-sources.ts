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
