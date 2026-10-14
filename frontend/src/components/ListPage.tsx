import { Card, Empty, Input, Segmented, Space } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { type ReactNode, useMemo, useState } from 'react';
import PageHeader from '@/layout/PageHeader';
import ResponsiveTable from './ResponsiveTable';
import SummaryCards, { type SummaryItem } from './SummaryCards';

export interface ListView<T> {
  value: string;
  label: string;
  test: (row: T) => boolean;
}

interface Props<T extends object> {
  title: string;
  /** Tombol aksi di pojok kanan atas (aksi utama paling kanan) */
  actions?: ReactNode;
  /** Kotak ringkasan di atas daftar (opsional, dihitung dari baris yang dimuat) */
  summary?: (rows: T[]) => SummaryItem[];
  rows?: T[];
  loading?: boolean;
  /** Pilihan cepat (mis. Semua / Belum lunas / Lunas); yang pertama jadi bawaan */
  views?: ListView<T>[];
  /** Teks yang dicari untuk satu baris; tanpa ini kolom cari tidak ditampilkan */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  columns: ColumnsType<T>;
  rowKey?: string;
  onRowClick?: (row: T) => void;
  scrollX?: number;
  emptyText?: string;
  /** Konten tambahan di bawah toolbar (mis. peringatan) */
  below?: ReactNode;
}

/**
 * Kerangka halaman daftar yang seragam di seluruh SANSU:
 * judul + aksi → kotak ringkasan → pilihan cepat + cari → tabel (kartu di HP) → tampilan kosong yang ramah.
 */
export default function ListPage<T extends object>({
  title,
  actions,
  summary,
  rows,
  loading,
  views,
  searchText,
  searchPlaceholder = 'Cari…',
  columns,
  rowKey = 'id',
  onRowClick,
  scrollX = 760,
  emptyText = 'Belum ada data',
  below,
}: Props<T>) {
  const [view, setView] = useState(views?.[0]?.value);
  const [q, setQ] = useState('');
  const all = rows ?? [];
  const shown = useMemo(() => {
    const v = views?.find((x) => x.value === view);
    const term = q.trim().toLowerCase();
    return all.filter((r) => (!v || v.test(r)) && (!term || !searchText || searchText(r).toLowerCase().includes(term)));
  }, [all, views, view, q, searchText]);

  return (
    <>
      <PageHeader title={title} extra={actions ? <Space wrap>{actions}</Space> : undefined} />
      {summary && !loading && all.length > 0 && <SummaryCards items={summary(all)} />}
      <Card>
        {(views || searchText) && (
          <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
            {views && (
              <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
                <Segmented
                  value={view}
                  onChange={(v) => setView(v as string)}
                  options={views.map((x) => ({ value: x.value, label: `${x.label} (${all.filter(x.test).length})` }))}
                />
              </div>
            )}
            {searchText && <Input.Search allowClear placeholder={searchPlaceholder} style={{ width: 260 }} onChange={(e) => setQ(e.target.value)} />}
          </Space>
        )}
        {below}
        <ResponsiveTable<T>
          rowKey={rowKey}
          loading={loading}
          dataSource={shown}
          scroll={{ x: scrollX }}
          locale={{ emptyText: <Empty description={q || (views && view !== views[0]?.value) ? 'Tidak ada data yang cocok dengan pilihan ini' : emptyText} /> }}
          onRow={onRowClick ? (r) => ({ onClick: () => onRowClick(r), style: { cursor: 'pointer' } }) : undefined}
          columns={columns}
        />
      </Card>
    </>
  );
}
