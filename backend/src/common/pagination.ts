/** Paginasi sejati di server: daftar besar dimuat per halaman, bukan dipotong diam-diam di jumlah tetap. */
export interface PageQuery {
  page?: number | string;
  pageSize?: number | string;
}
export interface Paged<T> {
  rows: T[];
  /** jumlah seluruh baris yang cocok (bukan hanya halaman ini) */
  total: number;
  page: number;
  pageSize: number;
}
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export function normalizePage(q: PageQuery): { page: number; limit: number; offset: number } {
  const page = Math.max(1, Math.floor(Number(q.page)) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(q.pageSize)) || DEFAULT_PAGE_SIZE));
  return { page, limit, offset: (page - 1) * limit };
}

/** Ada parameter halaman pada permintaan? (tanpa parameter, respons lama berupa larik tetap berlaku) */
export const wantsPage = (q: PageQuery): boolean => q.page !== undefined && q.page !== '';
