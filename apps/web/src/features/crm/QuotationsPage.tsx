import { PlusOutlined } from '@ant-design/icons';
import { QUOTATION_STATUS_LABELS, type QuotationStatus, toOptions } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Select, Tag } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, qs } from '@/api/client';
import type { Quotation } from '@/api/types';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import ResponsiveTable from '@/components/ResponsiveTable';
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
  const [status, setStatus] = useState<string>();
  const { data, isLoading } = useQuery({ queryKey: ['quotations', status], queryFn: () => get<Quotation[]>(`/crm/quotations${qs({ status })}`) });
  return (
    <>
      <PageHeader
        title="Penawaran harga"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/quotations/new')}>
            Penawaran baru
          </Button>
        }
      />
      <Card>
        <Select allowClear placeholder="Semua status" style={{ width: 200, marginBottom: 12 }} options={toOptions(QUOTATION_STATUS_LABELS)} onChange={setStatus} />
        <ResponsiveTable
          rowKey="id"
          loading={isLoading}
          dataSource={data}
          scroll={{ x: 800 }}
          onRow={(q) => ({ onClick: () => navigate(`/quotations/${q.id}`), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Nomor', dataIndex: 'number' },
            { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
            { title: 'Berlaku s/d', dataIndex: 'validUntil', render: fmtDate },
            { title: t('Pelanggan'), render: (_, q) => q.customer.name },
            { title: 'Total', dataIndex: 'total', align: 'right', render: fmtMoney },
            { title: 'Status', render: (_, q) => <QuotationStatusTag q={q} /> },
            { title: 'Sales Order', render: (_, q) => q.salesOrder?.number ?? '-' },
          ]}
        />
      </Card>
    </>
  );
}
