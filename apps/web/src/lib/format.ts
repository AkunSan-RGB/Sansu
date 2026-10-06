import dayjs from 'dayjs';

const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 4 });

/** Rp 1.234.567 */
export const fmtMoney = (v: string | number | null | undefined) => rupiah.format(Number(v ?? 0));
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
