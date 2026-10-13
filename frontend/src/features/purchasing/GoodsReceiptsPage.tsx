import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { get } from '@/api/client';
import type { GoodsReceipt } from '@/api/types';
import ResponsiveTable from '@/components/ResponsiveTable';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';
import { t } from '@/lib/terms';

export const ReceiptStatusTag = ({ r }: { r: Pick<GoodsReceipt, 'status' | 'autoInvoiceId'> }) =>
  r.status === 'CANCELLED' ? <Tag color="red">Batal</Tag> : r.autoInvoiceId ? <Tag color="green">Bersama faktur</Tag> : <Tag color="cyan">Diterima</Tag>;

/** Daftar penerimaan barang atas pesanan pembelian */
export default function GoodsReceiptsPage() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['goods-receipts'], queryFn: () => get<GoodsReceipt[]>('/goods-receipts') });
  return (
    <>
      <PageHeader title="Penerimaan barang" />
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Catat di sini saat barang pesanan tiba (stok langsung bertambah, bisa bertahap). Tagihan pemasok diinput terpisah di Faktur & hutang. Pembelian cepat sudah mencakup penerimaan." />
      <Card>
        <ResponsiveTable
          rowKey="id"
          loading={q.isLoading}
          dataSource={q.data}
          scroll={{ x: 800 }}
          onRow={(r) => ({ onClick: () => navigate(`/goods-receipts/${r.id}`), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Nomor', dataIndex: 'number' },
            { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
            { title: t('Supplier'), render: (_, r) => r.supplier.name },
            { title: t('Purchase Order'), render: (_, r) => r.order.number },
            { title: 'Surat jalan supplier', dataIndex: 'supplierDeliveryNo', render: (v) => v ?? '-' },
            { title: 'Nilai', dataIndex: 'value', align: 'right', render: fmtMoney },
            { title: 'Status', render: (_, r) => <ReceiptStatusTag r={r} /> },
          ]}
        />
      </Card>
    </>
  );
}
