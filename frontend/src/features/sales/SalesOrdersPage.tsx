import { PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Select, Space } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, qs } from '@/api/client';
import type { SalesOrder } from '@/api/types';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';
import { SO_STATUS_OPTIONS, SalesOrderStatusTag } from './status';
import ResponsiveTable from '@/components/ResponsiveTable';
import { t } from '@/lib/terms';

export default function SalesOrdersPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<string>();
  const { data, isLoading } = useQuery({
    queryKey: ['sales-orders', status],
    queryFn: () => get<SalesOrder[]>(`/sales-orders${qs({ status })}`),
  });

  return (
    <>
      <PageHeader
        title={t('Sales Order')}
        extra={
          <Space wrap>
            <Select allowClear placeholder="Semua status" style={{ width: 180 }} options={SO_STATUS_OPTIONS} onChange={setStatus} />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/sales-orders/new')}>
              Order baru
            </Button>
          </Space>
        }
      />
      <Card>
        <ResponsiveTable
          rowKey="id"
          loading={isLoading}
          dataSource={data}
          scroll={{ x: 700 }}
          onRow={(r) => ({ onClick: () => navigate(`/sales-orders/${r.id}`), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Nomor', dataIndex: 'number' },
            { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
            { title: t('Pelanggan'), render: (_, o) => `${o.customer.code} · ${o.customer.name}` },
            { title: 'Total', dataIndex: 'total', align: 'right', render: fmtMoney },
            { title: 'Status', dataIndex: 'status', render: (s) => <SalesOrderStatusTag status={s} /> },
            { title: t('Faktur'), render: (_, o) => o.invoice?.number ?? '-' },
          ]}
        />
      </Card>
    </>
  );
}
