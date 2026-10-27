import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { get } from '@/api/client';

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Daftar besar yang dimuat per halaman dari server (paginasi sejati): halaman, ukuran, dan total datang dari server,
 * bukan dipotong di jumlah tetap. Pindah penyaring mengembalikan ke halaman 1; halaman lama tetap tampil selagi halaman baru dimuat.
 */
export function usePaged<T>(key: readonly unknown[], path: string, params: Record<string, string | undefined> = {}, opts: { enabled?: boolean; pageSize?: number } = {}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(opts.pageSize ?? 25);
  const filterKey = JSON.stringify(params);
  useEffect(() => setPage(1), [filterKey]);
  const qs = new URLSearchParams({ ...(Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>), page: String(page), pageSize: String(pageSize) }).toString();
  const q = useQuery({ queryKey: [...key, filterKey, page, pageSize], queryFn: () => get<Paged<T>>(`${path}${path.includes('?') ? '&' : '?'}${qs}`), placeholderData: keepPreviousData, enabled: opts.enabled ?? true });
  return {
    ...q,
    rows: q.data?.rows ?? [],
    total: q.data?.total ?? 0,
    /** untuk properti `pagination` Table antd */
    pagination: { current: page, pageSize, total: q.data?.total ?? 0, showSizeChanger: true, pageSizeOptions: [25, 50, 100, 200], showTotal: (t: number) => `${t.toLocaleString('id-ID')} baris`, onChange: (p: number, s: number) => { setPage(p); setPageSize(s); } },
  };
}
