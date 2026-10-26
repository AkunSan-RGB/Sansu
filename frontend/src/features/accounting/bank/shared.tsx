import { LEDGER_KEYS } from '@/api/queries';
import { fmtCurrency } from '@/lib/format';

export const KEYS = ['bank', ...LEDGER_KEYS];

/**
 * Mata uang rekening yang sedang dibuka di halaman Bank. Angka mutasi/saldo/rekonsiliasi mengikuti mata uang rekening
 * (rekening valas menampilkan USD, bukan Rupiah). Diset BankPage saat render sebelum anak-anaknya, jadi pemformat di sini
 * (yang dipakai juga oleh fungsi render tabel biasa) selalu membaca nilai yang benar.
 */
let current = 'IDR';
export const setBankCurrency = (code: string | undefined) => {
  current = code || 'IDR';
};
export const bankMoney = (v: string | number | null | undefined) => fmtCurrency(v, current);

export const signed = (v: string | number) => {
  const n = Number(v);
  return <span style={{ color: n < 0 ? '#cf1322' : '#389e0d', whiteSpace: 'nowrap' }}>{n < 0 ? `− ${bankMoney(-n)}` : `+ ${bankMoney(n)}`}</span>;
};
