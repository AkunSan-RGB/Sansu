import { PlusOutlined } from '@ant-design/icons';
import { isForeignCurrency } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Select, Space, Tabs, Tag, Tooltip } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { get, qs } from '@/api/client';
import type { AgingRow, Invoice } from '@/api/types';
import AgingTable from '@/components/AgingTable';
import PageHeader from '@/layout/PageHeader';
import { fmtCurrency, fmtDate, fmtMoney, today } from '@/lib/format';
import { INV_STATUS_OPTIONS, InvoiceStatusTag } from './status';
import PaymentModal, { outstanding } from './PaymentModal';
import ResponsiveTable from '@/components/ResponsiveTable';
import { t } from '@/lib/terms';
import { useAuth } from '@/auth/AuthContext';

export default function InvoicesPage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const [status, setStatus] = useState<string>();
  const [paying, setPaying] = useState<Invoice | null>(null);

  const invoices = useQuery({ queryKey: ['invoices', status], queryFn: () => get<Invoice[]>(`/invoices${qs({ status })}`) });
  const aging = useQuery({ queryKey: ['invoices', 'aging'], queryFn: () => get<AgingRow[]>('/invoices/reports/ar-aging') });


  const isOverdue = (i: Invoice) => i.status !== 'PAID' && i.dueDate < today();

  return (
    <>
      <PageHeader
        title={t('Faktur & Piutang')}
        extra={
          me?.businessModel === 'RITEL' ? undefined : (
            <Button icon={<PlusOutlined />} onClick={() => navigate('/invoices/services/new')}>
              {me?.businessModel === 'JASA' ? 'Tagihan jasa' : 'Faktur jasa'}
            </Button>
          )
        }
      />
      <Card>
        <Tabs
          items={[
            {
              key: 'list',
              label: t('Daftar faktur'),
              children: (
                <>
                  <Select allowClear placeholder="Semua status" style={{ width: 200, marginBottom: 12 }} options={INV_STATUS_OPTIONS} onChange={setStatus} />
                  <ResponsiveTable
                    rowKey="id"
                    loading={invoices.isLoading}
                    dataSource={invoices.data}
                    scroll={{ x: 900 }}
                    columns={[
                      {
                        title: 'Nomor',
                        dataIndex: 'number',
                        render: (n, i) =>
                          i.isOpening ? (
                            <Space size={4}>
                              <a onClick={() => navigate(`/invoices/${i.id}`)}>{n}</a>
                              <Tooltip title="Piutang dari sistem lama (saldo awal)">
                                <Tag color="gold">Saldo awal</Tag>
                              </Tooltip>
                            </Space>
                          ) : (
                            <a onClick={() => navigate(`/invoices/${i.id}`)}>{n}</a>
                          ),
                      },
                      { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
                      {
                        title: 'Jatuh tempo',
                        dataIndex: 'dueDate',
                        render: (d, i) => (isOverdue(i) ? <Tag color="red">{fmtDate(d)}</Tag> : fmtDate(d)),
                      },
                      { title: t('Pelanggan'), render: (_, i) => i.customer.name },
                      {
                        title: 'Total',
                        dataIndex: 'total',
                        align: 'right',
                        render: (v, i) =>
                          isForeignCurrency(i.currency) ? (
                            <>
                              {fmtMoney(v)}
                              <div style={{ fontSize: 11, color: '#64748b' }}>{fmtCurrency(i.totalForeign, i.currency)}</div>
                            </>
                          ) : (
                            fmtMoney(v)
                          ),
                      },
                      { title: 'Sisa', align: 'right', render: (_, i) => fmtMoney(outstanding(i)) },
                      { title: 'Status', dataIndex: 'status', render: (s) => <InvoiceStatusTag status={s} /> },
                      {
                        render: (_, i) =>
                          i.status !== 'PAID' && (
                            <Space>
                              <Button
                                size="small"
                                type="primary"
                                onClick={() => setPaying(i)}
                              >
                                Terima bayar
                              </Button>
                              {!i.isOpening && (
                                <Button size="small" onClick={() => navigate(`/returns?tab=sales&invoice=${i.id}`)}>
                                  Retur
                                </Button>
                              )}
                            </Space>
                          ),
                      },
                    ]}
                  />
                </>
              ),
            },
            {
              key: 'aging',
              label: 'Umur piutang',
              children: <AgingTable rows={aging.data} loading={aging.isLoading} partyLabel="Pelanggan" />,
            },
          ]}
        />
      </Card>

      <PaymentModal invoice={paying} onClose={() => setPaying(null)} />
    </>
  );
}
