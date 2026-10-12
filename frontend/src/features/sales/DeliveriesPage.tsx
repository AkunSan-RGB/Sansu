import { useQuery } from '@tanstack/react-query';
import { Card, Table, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { get } from '@/api/client';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';
import { t } from '@/lib/terms';

export interface Delivery {
  id: string;
  number: string;
  date: string;
  status: 'DELIVERED' | 'CANCELLED';
  cogsAmount: string;
  notes: string | null;
  customer: { id: string; code: string; name: string; address?: string | null; phone?: string | null };
  salesOrder: { id: string; number: string };
  invoice: { id: string; number: string } | null;
  warehouse?: { id: string; code: string; name: string };
  lines?: { id: string; qty: string; uom: string; product: { id: string; sku: string; name: string } }[];
}

export default function DeliveriesPage() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['deliveries'], queryFn: () => get<Delivery[]>('/deliveries') });
  return (
    <>
      <PageHeader title="Surat jalan" />
      <Card>
        <Table
          rowKey="id"
          size="small"
          loading={q.isLoading}
          dataSource={q.data}
          scroll={{ x: 800 }}
          onRow={(r) => ({ onClick: () => navigate(`/deliveries/${r.id}`), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Nomor', dataIndex: 'number' },
            { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
            { title: t('Pelanggan'), render: (_, r) => r.customer.name },
            { title: t('Sales Order'), render: (_, r) => r.salesOrder.number },
            { title: t('Faktur'), render: (_, r) => r.invoice?.number ?? <Tag>Belum difakturkan</Tag> },
            { title: 'HPP', dataIndex: 'cogsAmount', align: 'right', render: fmtMoney },
            { title: 'Status', dataIndex: 'status', render: (s) => (s === 'CANCELLED' ? <Tag color="red">Batal</Tag> : <Tag color="cyan">Terkirim</Tag>) },
          ]}
        />
      </Card>
    </>
  );
}
