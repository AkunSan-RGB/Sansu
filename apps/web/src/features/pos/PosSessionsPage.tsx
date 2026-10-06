import { DollarOutlined } from '@ant-design/icons';
import { POS_PAYMENT_LABELS, type PosPaymentMethod } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Modal, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, qs } from '@/api/client';
import type { PosOrder, PosSession } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney } from '@/lib/format';
import Receipt, { printReceipt } from './Receipt';
import { t } from '@/lib/terms';

const dt = (v?: string | null) => (v ? dayjs(v).format('DD MMM YYYY HH:mm') : '-');

function SessionOrders({ sessionId, onOpen }: { sessionId: string; onOpen: (id: string) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['pos-orders', sessionId], queryFn: () => get<PosOrder[]>(`/pos/orders${qs({ sessionId })}`) });
  return (
    <Table
      rowKey="id"
      size="small"
      loading={isLoading}
      dataSource={data}
      pagination={{ pageSize: 20, hideOnSinglePage: true }}
      onRow={(o) => ({ onClick: () => onOpen(o.id), style: { cursor: 'pointer' } })}
      columns={[
        { title: 'Nomor', dataIndex: 'number' },
        { title: 'Waktu', dataIndex: 'createdAt', render: (v) => dayjs(v).format('HH:mm') },
        { title: t('Pelanggan'), render: (_, o) => o.customer?.name ?? 'Umum' },
        { title: 'Bayar', render: (_, o) => o.payments.map((p) => <Tag key={p.id}>{POS_PAYMENT_LABELS[p.method as PosPaymentMethod]}</Tag>) },
        { title: 'Total', dataIndex: 'total', align: 'right', render: fmtMoney },
      ]}
    />
  );
}

export default function PosSessionsPage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const [orderId, setOrderId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['pos-sessions'], queryFn: () => get<PosSession[]>('/pos/sessions') });
  const order = useQuery({ queryKey: ['pos-order', orderId], queryFn: () => get<PosOrder>(`/pos/orders/${orderId}`), enabled: !!orderId });

  return (
    <>
      <PageHeader
        title="Riwayat sesi kasir"
        extra={
          <Button type="primary" icon={<DollarOutlined />} onClick={() => navigate('/pos')}>
            Buka layar kasir
          </Button>
        }
      />
      <Card>
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={data}
          scroll={{ x: 1000 }}
          expandable={{ expandedRowRender: (s) => <SessionOrders sessionId={s.id} onOpen={setOrderId} />, rowExpandable: (s) => (s.orderCount ?? 0) > 0 }}
          columns={[
            { title: 'Sesi', dataIndex: 'number' },
            { title: 'Kasir', render: (_, s) => s.user?.name },
            { title: 'Toko', render: (_, s) => s.warehouse.name },
            { title: 'Buka', dataIndex: 'openedAt', render: dt },
            { title: 'Tutup', dataIndex: 'closedAt', render: dt },
            { title: 'Status', dataIndex: 'status', render: (s) => (s === 'OPEN' ? <Tag color="green">Buka</Tag> : <Tag>Tutup</Tag>) },
            { title: 'Transaksi', dataIndex: 'orderCount', align: 'right' },
            { title: t('Penjualan'), dataIndex: 'totalSales', align: 'right', render: fmtMoney },
            {
              title: 'Selisih kas',
              dataIndex: 'difference',
              align: 'right',
              render: (v) =>
                v == null ? '-' : <Typography.Text type={Number(v) < 0 ? 'danger' : Number(v) > 0 ? 'warning' : 'success'}>{fmtMoney(v)}</Typography.Text>,
            },
          ]}
        />
      </Card>
      <Modal
        open={!!orderId}
        title={order.data?.number}
        onCancel={() => setOrderId(null)}
        width={380}
        footer={
          <Button icon={<DollarOutlined />} onClick={printReceipt}>
            Cetak ulang struk
          </Button>
        }
      >
        {order.data && (
          <Receipt
            order={order.data}
            company={me?.tenantName ?? ''}
            cashier={order.data.session?.user.name ?? ''}
            warehouse={order.data.session?.warehouse.name ?? ''}
          />
        )}
      </Modal>
    </>
  );
}
