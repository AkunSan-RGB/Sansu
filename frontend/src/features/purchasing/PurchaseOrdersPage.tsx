import { PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Select, Space, Tag } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, qs } from '@/api/client';
import type { PurchaseOrder } from '@/api/types';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';
import { PO_STATUS_OPTIONS, PurchaseOrderStatusTag } from '../sales/status';
import ResponsiveTable from '@/components/ResponsiveTable';
import { t } from '@/lib/terms';

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<string>();
  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders', status],
    queryFn: () => get<PurchaseOrder[]>(`/purchase-orders${qs({ status })}`),
  });

  return (
    <>
      <PageHeader
        title={t('Purchase Order')}
        extra={
          <Space wrap>
            <Button icon={<ThunderboltOutlined />} onClick={() => navigate('/purchase-orders/quick')}>
              Pembelian cepat
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/purchase-orders/new')}>
              PO baru
            </Button>
          </Space>
        }
      />
      <Card>
        <Select allowClear placeholder="Semua status" style={{ width: 220, marginBottom: 12 }} options={PO_STATUS_OPTIONS} onChange={setStatus} />
        <ResponsiveTable
          rowKey="id"
          loading={isLoading}
          dataSource={data}
          scroll={{ x: 800 }}
          onRow={(r) => ({ onClick: () => navigate(`/purchase-orders/${r.id}`), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Nomor', dataIndex: 'number', render: (n, o) => (o.priceEstimate ? <Space size={4}>{n}<Tag color="orange">Harga estimasi</Tag></Space> : n) },
            { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
            { title: t('Supplier'), render: (_, o) => o.supplier.name },
            { title: 'Total', dataIndex: 'total', align: 'right', render: fmtMoney },
            { title: 'Status', dataIndex: 'status', render: (s) => <PurchaseOrderStatusTag status={s} /> },
            {
              title: 'Penerimaan',
              render: (_, o) =>
                o.status !== 'CONFIRMED' && o.status !== 'BILLED' ? '-' : o.receiptStatus === 'FULL' ? <Tag color="green">Lengkap</Tag> : o.receiptStatus === 'PARTIAL' ? <Tag color="gold">Sebagian</Tag> : <Tag>Belum</Tag>,
            },
            {
              title: t('Faktur'),
              render: (_, o) => (o.invoices?.length ? `${o.invoices[0].number}${o.invoices.length > 1 ? ` +${o.invoices.length - 1}` : ''}` : '-'),
            },
          ]}
        />
      </Card>
    </>
  );
}
