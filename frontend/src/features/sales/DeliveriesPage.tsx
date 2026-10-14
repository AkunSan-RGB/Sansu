import { useQuery } from '@tanstack/react-query';
import { Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { get } from '@/api/client';
import ListPage from '@/components/ListPage';
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
    <ListPage<Delivery>
      title="Surat jalan"
      rows={q.data}
      loading={q.isLoading}
      summary={(rows) => {
        const live = rows.filter((r) => r.status !== 'CANCELLED');
        const open = live.filter((r) => !r.invoice);
        return [
          { label: 'Pengiriman', value: String(live.length), hint: 'tidak termasuk yang batal' },
          { label: 'Belum difakturkan', value: String(open.length), hint: 'segera tagihkan ke pelanggan', tone: open.length ? 'warn' : 'neutral' },
          { label: 'Nilai HPP terkirim', value: fmtMoney(live.reduce((a, r) => a + Number(r.cogsAmount), 0)) },
        ];
      }}
      views={[
        { value: 'ALL', label: 'Semua', test: () => true },
        { value: 'OPEN', label: 'Belum difakturkan', test: (r) => r.status !== 'CANCELLED' && !r.invoice },
        { value: 'INVOICED', label: 'Sudah difakturkan', test: (r) => !!r.invoice },
        { value: 'CANCELLED', label: 'Batal', test: (r) => r.status === 'CANCELLED' },
      ]}
      searchText={(r) => `${r.number} ${r.customer.name} ${r.salesOrder.number}`}
      searchPlaceholder={`Cari ${t('Pelanggan').toLowerCase()} atau nomor`}
      emptyText="Belum ada surat jalan"
      onRowClick={(r) => navigate(`/deliveries/${r.id}`)}
      columns={[
        { title: 'Surat jalan', dataIndex: 'number', render: (n: string, r) => <div><div>{n}</div><span style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(r.date)}</span></div> },
        { title: t('Pelanggan'), render: (_: unknown, r) => r.customer.name },
        { title: t('Sales Order'), render: (_: unknown, r) => r.salesOrder.number },
        { title: t('Faktur'), render: (_: unknown, r) => r.invoice?.number ?? <Tag>Belum difakturkan</Tag> },
        { title: 'HPP', dataIndex: 'cogsAmount', align: 'right', render: fmtMoney },
        { title: 'Status', dataIndex: 'status', render: (s: string) => (s === 'CANCELLED' ? <Tag color="red">Batal</Tag> : <Tag color="cyan">Terkirim</Tag>) },
      ]}
    />
  );
}
