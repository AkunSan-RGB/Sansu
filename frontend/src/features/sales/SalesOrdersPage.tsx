import { PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import { get } from '@/api/client';
import type { SalesOrder } from '@/api/types';
import ListPage from '@/components/ListPage';
import { fmtDate, fmtMoney } from '@/lib/format';
import { SalesOrderStatusTag } from './status';
import { t } from '@/lib/terms';

const sum = (xs: SalesOrder[]) => xs.reduce((a, o) => a + Number(o.total), 0);

export default function SalesOrdersPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['sales-orders', 'all'], queryFn: () => get<SalesOrder[]>('/sales-orders') });
  return (
    <ListPage<SalesOrder>
      title={t('Sales Order')}
      actions={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/sales-orders/new')}>
          Order baru
        </Button>
      }
      rows={data}
      loading={isLoading}
      summary={(rows) => {
        const live = rows.filter((o) => o.status !== 'CANCELLED');
        const waiting = rows.filter((o) => o.status === 'CONFIRMED' || o.status === 'DELIVERED');
        return [
          { label: 'Nilai order (tidak termasuk batal)', value: fmtMoney(sum(live)), hint: `${live.length} order` },
          { label: 'Belum difakturkan', value: fmtMoney(sum(waiting)), hint: `${waiting.length} order menunggu`, tone: waiting.length ? 'warn' : 'neutral' },
          { label: 'Masih draf', value: String(rows.filter((o) => o.status === 'DRAFT').length), hint: 'belum dikonfirmasi' },
        ];
      }}
      views={[
        { value: 'ALL', label: 'Semua', test: () => true },
        { value: 'DRAFT', label: 'Draf', test: (o) => o.status === 'DRAFT' },
        { value: 'OPEN', label: 'Berjalan', test: (o) => o.status === 'CONFIRMED' || o.status === 'DELIVERED' },
        { value: 'DONE', label: 'Difakturkan', test: (o) => o.status === 'INVOICED' },
        { value: 'CANCELLED', label: 'Batal', test: (o) => o.status === 'CANCELLED' },
      ]}
      searchText={(o) => `${o.number} ${o.customer.code} ${o.customer.name} ${o.invoice?.number ?? ''}`}
      searchPlaceholder={`Cari ${t('Pelanggan').toLowerCase()} atau nomor order`}
      emptyText="Belum ada order penjualan"
      onRowClick={(o) => navigate(`/sales-orders/${o.id}`)}
      columns={[
        { title: 'Order', dataIndex: 'number', render: (n: string, o) => <div><div>{n}</div><span style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(o.date)}</span></div> },
        { title: t('Pelanggan'), render: (_: unknown, o) => o.customer.name },
        { title: 'Total', dataIndex: 'total', align: 'right', render: fmtMoney },
        { title: 'Status', dataIndex: 'status', render: (s) => <SalesOrderStatusTag status={s} /> },
        { title: t('Faktur'), render: (_: unknown, o) => o.invoice?.number ?? '-' },
      ]}
    />
  );
}
