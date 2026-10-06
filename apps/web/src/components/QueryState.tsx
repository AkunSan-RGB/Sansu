import { ReloadOutlined } from '@ant-design/icons';
import type { UseQueryResult } from '@tanstack/react-query';
import { Alert, Button, Empty, Spin } from 'antd';
import type { ReactNode } from 'react';

/**
 * Tampilkan isi query dengan status yang jelas: memuat, gagal (dengan pesan & tombol coba lagi), atau kosong.
 * Mencegah halaman tampak "kosong tanpa penjelasan" saat server belum siap atau terjadi error.
 */
export default function QueryState<T>({ q, children, empty }: { q: UseQueryResult<T>; children: (data: T) => ReactNode; empty?: string }) {
  if (q.isError)
    return (
      <Alert
        type="error"
        showIcon
        message="Data gagal dimuat"
        description={`${(q.error as Error)?.message ?? 'Server tidak menjawab'}. Pastikan jendela SANSU masih berjalan, lalu coba lagi.`}
        action={
          <Button icon={<ReloadOutlined />} onClick={() => q.refetch()} loading={q.isFetching}>
            Coba lagi
          </Button>
        }
      />
    );
  if (q.isPending || q.data === undefined)
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin tip="Menyusun laporan…">
          <div style={{ minHeight: 40 }} />
        </Spin>
      </div>
    );
  if (empty && Array.isArray(q.data) && !q.data.length) return <Empty description={empty} />;
  return <>{children(q.data)}</>;
}
