import { PlusOutlined } from '@ant-design/icons';
import { QUOTATION_STATUS_LABELS, type QuotationStatus } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { get } from '@/api/client';
import type { Quotation } from '@/api/types';
import ListPage from '@/components/ListPage';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import { t } from '@/lib/terms';

export const QUOTATION_COLOR: Record<QuotationStatus, string> = { DRAFT: 'default', SENT: 'blue', ACCEPTED: 'green', REJECTED: 'red', CANCELLED: 'default' };
export const QuotationStatusTag = ({ q }: { q: Pick<Quotation, 'status' | 'validUntil'> }) =>
  (q.status === 'SENT' || q.status === 'DRAFT') && q.validUntil < today() ? (
    <Tag color="orange">Kedaluwarsa</Tag>
  ) : (
    <Tag color={QUOTATION_COLOR[q.status]}>{QUOTATION_STATUS_LABELS[q.status]}</Tag>
  );

export default function QuotationsPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['quotations', 'all'], queryFn: () => get<Quotation[]>('/crm/quotations') });
  const expired = (q: Quotation) => (q.status === 'SENT' || q.status === 'DRAFT') && q.validUntil < today();
  return (
    <ListPage<Quotation>
      title="Penawaran harga"
      actions={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/quotations/new')}>
          Penawaran baru
        </Button>
      }
      rows={data}
      loading={isLoading}
      summary={(rows) => {
        const active = rows.filter((q) => (q.status === 'SENT' || q.status === 'DRAFT') && !expired(q));
        const won = rows.filter((q) => q.status === 'ACCEPTED');
        return [
          { label: 'Penawaran aktif', value: fmtMoney(active.reduce((a, q) => a + Number(q.total), 0)), hint: `${active.length} penawaran menunggu keputusan` },
          { label: 'Disetujui pelanggan', value: fmtMoney(won.reduce((a, q) => a + Number(q.total), 0)), hint: `${won.length} penawaran`, tone: 'good' },
          { label: 'Kedaluwarsa', value: String(rows.filter(expired).length), hint: 'perlu ditindaklanjuti', tone: rows.some(expired) ? 'warn' : 'neutral' },
        ];
      }}
      views={[
        { value: 'ALL', label: 'Semua', test: () => true },
        { value: 'ACTIVE', label: 'Menunggu', test: (q) => (q.status === 'SENT' || q.status === 'DRAFT') && !expired(q) },
        { value: 'ACCEPTED', label: 'Disetujui', test: (q) => q.status === 'ACCEPTED' },
        { value: 'LOST', label: 'Ditolak / batal', test: (q) => q.status === 'REJECTED' || q.status === 'CANCELLED' },
        { value: 'EXPIRED', label: 'Kedaluwarsa', test: expired },
      ]}
      searchText={(q) => `${q.number} ${q.customer.name} ${q.salesOrder?.number ?? ''}`}
      searchPlaceholder={`Cari ${t('Pelanggan').toLowerCase()} atau nomor`}
      emptyText="Belum ada penawaran"
      onRowClick={(q) => navigate(`/quotations/${q.id}`)}
      columns={[
        { title: 'Penawaran', dataIndex: 'number', render: (n: string, q) => <div><div>{n}</div><span style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(q.date)}</span></div> },
        { title: t('Pelanggan'), render: (_: unknown, q) => q.customer.name },
        { title: 'Berlaku s/d', dataIndex: 'validUntil', render: fmtDate },
        { title: 'Total', dataIndex: 'total', align: 'right', render: fmtMoney },
        { title: 'Status', render: (_: unknown, q) => <QuotationStatusTag q={q} /> },
        { title: t('Sales Order'), render: (_: unknown, q) => q.salesOrder?.number ?? '-' },
      ]}
    />
  );
}
