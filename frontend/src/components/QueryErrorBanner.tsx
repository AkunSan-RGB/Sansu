import { type Query, useQueryClient } from '@tanstack/react-query';
import { Alert, Button } from 'antd';
import { useSyncExternalStore } from 'react';
import { ApiError } from '@/api/client';

/**
 * Data di halaman yang sedang dibuka yang GAGAL dimuat (dan masih dipakai tampilan). Dikecualikan: pemeriksaan server
 * (ditangani ServerStatus), 401 (dialihkan ke login), 403 (peran memang tidak boleh membaca data pelengkap), dan 503 (server menyala).
 */
export function failedQueries(queries: Query[]): Query[] {
  return queries.filter((q) => {
    if (q.state.status !== 'error' || q.getObserversCount() === 0) return false;
    if (String(q.queryKey[0]).startsWith('__')) return false;
    const e = q.state.error;
    return !(e instanceof ApiError && [401, 403, 503].includes(e.status));
  });
}

/**
 * Satu tempat untuk semua halaman: tanpa banner ini, halaman yang tidak menangani galat sendiri tampil kosong tanpa penjelasan
 * (hanya toast sesaat). Banner bertahan sampai data berhasil dimuat dan menyediakan tombol coba lagi.
 */
export default function QueryErrorBanner() {
  const qc = useQueryClient();
  const cache = qc.getQueryCache();
  // jumlah + pesan pertama cukup sebagai cuplikan yang stabil untuk useSyncExternalStore
  const snapshot = useSyncExternalStore(
    (cb) => cache.subscribe(cb),
    () => {
      const f = failedQueries(cache.getAll());
      return f.length ? `${f.length}|${f[0].state.error?.message ?? ''}` : '';
    },
  );
  if (!snapshot) return null;
  const [count, ...rest] = snapshot.split('|');
  const retry = () => void Promise.all(failedQueries(cache.getAll()).map((q) => q.fetch().catch(() => undefined)));
  return (
    <Alert
      type="error"
      showIcon
      banner
      style={{ marginBottom: 16 }}
      message={Number(count) > 1 ? `${count} bagian data di halaman ini gagal dimuat` : 'Sebagian data di halaman ini gagal dimuat'}
      description={`${rest.join('|') || 'Tidak ada keterangan dari server.'} Angka atau daftar di bawah mungkin belum lengkap.`}
      action={
        <Button size="small" danger onClick={retry}>
          Coba lagi
        </Button>
      }
    />
  );
}
