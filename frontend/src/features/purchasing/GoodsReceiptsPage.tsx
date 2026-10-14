import { useQuery } from '@tanstack/react-query';
import { Alert, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { get } from '@/api/client';
import type { GoodsReceipt } from '@/api/types';
import ListPage from '@/components/ListPage';
import { fmtDate, fmtMoney } from '@/lib/format';
import { t } from '@/lib/terms';

export const ReceiptStatusTag = ({ r }: { r: Pick<GoodsReceipt, 'status' | 'autoInvoiceId'> }) =>
  r.status === 'CANCELLED' ? <Tag color="red">Batal</Tag> : r.autoInvoiceId ? <Tag color="green">Bersama faktur</Tag> : <Tag color="cyan">Diterima</Tag>;

/** Daftar penerimaan barang atas pesanan pembelian */
export default function GoodsReceiptsPage() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['goods-receipts'], queryFn: () => get<GoodsReceipt[]>('/goods-receipts') });
  return (
    <ListPage<GoodsReceipt>
      title="Penerimaan barang"
      rows={q.data}
      loading={q.isLoading}
      below={<Alert type="info" showIcon style={{ marginBottom: 12 }} message="Catat di sini saat barang pesanan tiba (stok langsung bertambah, bisa bertahap). Tagihan pemasok diinput terpisah di Faktur & hutang. Pembelian cepat sudah mencakup penerimaan." />}
      summary={(rows) => {
        const live = rows.filter((r) => r.status !== 'CANCELLED');
        const unbilled = live.filter((r) => !r.autoInvoiceId);
        return [
          { label: 'Penerimaan', value: String(live.length), hint: 'tidak termasuk yang batal' },
          { label: 'Nilai barang diterima', value: fmtMoney(live.reduce((a, r) => a + Number(r.value), 0)) },
          { label: 'Belum bersama faktur', value: String(unbilled.length), hint: 'pastikan tagihan supplier dicatat', tone: unbilled.length ? 'warn' : 'neutral' },
        ];
      }}
      views={[
        { value: 'ALL', label: 'Semua', test: () => true },
        { value: 'RECEIVED', label: 'Diterima', test: (r) => r.status !== 'CANCELLED' },
        { value: 'CANCELLED', label: 'Batal', test: (r) => r.status === 'CANCELLED' },
      ]}
      searchText={(r) => `${r.number} ${r.supplier.name} ${r.order.number} ${r.supplierDeliveryNo ?? ''}`}
      searchPlaceholder={`Cari ${t('Supplier').toLowerCase()} atau nomor`}
      emptyText="Belum ada penerimaan barang"
      onRowClick={(r) => navigate(`/goods-receipts/${r.id}`)}
      columns={[
        { title: 'Penerimaan', dataIndex: 'number', render: (n: string, r) => <div><div>{n}</div><span style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(r.date)}</span></div> },
        { title: t('Supplier'), render: (_: unknown, r) => r.supplier.name },
        { title: t('Purchase Order'), render: (_: unknown, r) => r.order.number },
        { title: 'Surat jalan supplier', dataIndex: 'supplierDeliveryNo', render: (v: string | null) => v ?? '-' },
        { title: 'Nilai', dataIndex: 'value', align: 'right', render: fmtMoney },
        { title: 'Status', render: (_: unknown, r) => <ReceiptStatusTag r={r} /> },
      ]}
    />
  );
}
