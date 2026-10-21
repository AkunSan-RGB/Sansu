import dayjs from 'dayjs';

const rupiahWhole = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const rupiahSen = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 4 });

/** Rp 1.234.567 (bulat) atau Rp 1.234.567,50 (bila ada sen: selalu dua digit, agar ",5" tidak terbaca 5 sen) */
export const fmtMoney = (v: string | number | null | undefined) => {
  const n = Math.round(Number(v ?? 0) * 100) / 100;
  return (Number.isInteger(n) ? rupiahWhole : rupiahSen).format(n);
};
/** Nominal dalam mata uang dokumen, mis. US$1.234,50 (IDR memakai format Rupiah) */
export const fmtCurrency = (v: string | number | null | undefined, code?: string | null) => {
  if (!code || code === 'IDR') return fmtMoney(v);
  try {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: code, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(v ?? 0));
  } catch {
    return `${code} ${number.format(Number(v ?? 0))}`;
  }
};
/** Kurs: 16.250,5 */
export const fmtRate = (v: string | number | null | undefined) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 6 }).format(Number(v ?? 0));
/** Properti InputNumber untuk nominal rupiah: pemisah ribuan titik (4.000.000.000), tanpa desimal */
export const rupiahInput = {
  precision: 0,
  formatter: (v?: string | number) => `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.'),
  parser: (v?: string) => Number((v ?? '').replace(/\./g, '')),
};
/** 1.234,5 */
export const fmtQty = (v: string | number | null | undefined) => number.format(Number(v ?? 0));
/** 03 Okt 2026 */
export const fmtDate = (v: string | null | undefined) => (v ? dayjs(v).format('DD MMM YYYY') : '-');

export const today = () => dayjs().format('YYYY-MM-DD');
