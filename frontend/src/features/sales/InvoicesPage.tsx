import { PlusOutlined } from '@ant-design/icons';
import { canHandleMoney, isForeignCurrency } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Empty, Input, Segmented, Space, Tabs, Tag, Tooltip, Typography } from 'antd';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { get, qs } from '@/api/client';
import type { AgingRow, Invoice } from '@/api/types';
import AgingTable from '@/components/AgingTable';
import PageHeader from '@/layout/PageHeader';
import { fmtCurrency, fmtDate, fmtMoney, today } from '@/lib/format';
import { InvoiceStatusTag } from './status';
import SummaryCards from '@/components/SummaryCards';
import { DueLabel } from '@/lib/due';
import PaymentModal, { outstanding } from './PaymentModal';
import ResponsiveTable from '@/components/ResponsiveTable';
import { t } from '@/lib/terms';
import { useAuth } from '@/auth/AuthContext';

export default function InvoicesPage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const [view, setView] = useState<'OPEN' | 'OVERDUE' | 'PAID' | 'ALL'>('OPEN');
  const [search, setSearch] = useState('');
  const [paying, setPaying] = useState<Invoice | null>(null);

  const invoices = useQuery({ queryKey: ['invoices', 'all'], queryFn: () => get<Invoice[]>(`/invoices${qs({})}`) });
  const aging = useQuery({ queryKey: ['invoices', 'aging'], queryFn: () => get<AgingRow[]>('/invoices/reports/ar-aging') });


  const isOverdue = (i: Invoice) => i.status !== 'PAID' && i.dueDate < today();
  const all = invoices.data ?? [];
  const open = all.filter((i) => i.status !== 'PAID');
  const sum = (xs: Invoice[]) => xs.reduce((a, i) => a + outstanding(i), 0);
  const overdue = open.filter(isOverdue);
  const soon = open.filter((i) => !isOverdue(i) && i.dueDate <= dayjs(today()).add(7, 'day').format('YYYY-MM-DD'));
  const shown = all.filter((i) => {
    const q = search.trim().toLowerCase();
    const okView = view === 'ALL' || (view === 'OPEN' && i.status !== 'PAID') || (view === 'OVERDUE' && isOverdue(i)) || (view === 'PAID' && i.status === 'PAID');
    return okView && (!q || `${i.number} ${i.customer.name}`.toLowerCase().includes(q));
  });

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
              label: 'Faktur penjualan',
              children: (
                <>
                  <SummaryCards
                    items={[
                      { label: `Total piutang dari ${t('Pelanggan').toLowerCase()}`, value: fmtMoney(sum(open)), hint: `${open.length} faktur belum lunas`, onClick: () => setView('OPEN'), active: view === 'OPEN' },
                      { label: 'Sudah lewat jatuh tempo', value: fmtMoney(sum(overdue)), hint: `${overdue.length} faktur — perlu ditagih`, tone: overdue.length ? 'bad' : 'neutral', onClick: () => setView('OVERDUE'), active: view === 'OVERDUE' },
                      { label: 'Jatuh tempo 7 hari ke depan', value: fmtMoney(sum(soon)), hint: `${soon.length} faktur`, tone: soon.length ? 'warn' : 'neutral' },
                    ]}
                  />
                  <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
                    <Segmented
                      value={view}
                      onChange={(v) => setView(v as typeof view)}
                      options={[{ value: 'OPEN', label: 'Belum lunas' }, { value: 'OVERDUE', label: 'Telat' }, { value: 'PAID', label: 'Lunas' }, { value: 'ALL', label: 'Semua' }]}
                    />
                    <Input.Search allowClear placeholder={`Cari ${t('Pelanggan').toLowerCase()} atau nomor faktur`} style={{ width: 260 }} onChange={(e) => setSearch(e.target.value)} />
                  </Space>
                  <ResponsiveTable
                    rowKey="id"
                    loading={invoices.isLoading}
                    dataSource={shown}
                    scroll={{ x: 760 }}
                    locale={{ emptyText: <Empty description={view === 'OPEN' ? 'Tidak ada piutang yang belum lunas' : 'Tidak ada faktur pada pilihan ini'} /> }}
                    columns={[
                      {
                        title: 'Faktur',
                        dataIndex: 'number',
                        render: (n: string, i: Invoice) => (
                          <div>
                            <Space size={4}>
                              <a onClick={() => navigate(`/invoices/${i.id}`)}>{n}</a>
                              {i.isOpening && (
                                <Tooltip title="Piutang dari sistem lama (saldo awal)">
                                  <Tag color="gold">Saldo awal</Tag>
                                </Tooltip>
                              )}
                            </Space>
                            <div>
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{fmtDate(i.date)}</Typography.Text>
                            </div>
                          </div>
                        ),
                      },
                      { title: t('Pelanggan'), render: (_: unknown, i: Invoice) => i.customer.name },
                      { title: 'Jatuh tempo', dataIndex: 'dueDate', render: (d: string, i: Invoice) => <DueLabel dueDate={d} paid={i.status === 'PAID'} /> },
                      {
                        title: 'Total',
                        dataIndex: 'total',
                        align: 'right',
                        render: (v: string, i: Invoice) =>
                          isForeignCurrency(i.currency) ? (
                            <>
                              {fmtMoney(v)}
                              <div style={{ fontSize: 11, color: '#64748b' }}>{fmtCurrency(i.totalForeign, i.currency)}</div>
                            </>
                          ) : (
                            fmtMoney(v)
                          ),
                      },
                      {
                        title: 'Sisa piutang',
                        align: 'right',
                        render: (_: unknown, i: Invoice) => (i.status === 'PAID' ? <InvoiceStatusTag status={i.status} /> : <Typography.Text strong type={isOverdue(i) ? 'danger' : undefined}>{fmtMoney(outstanding(i))}</Typography.Text>),
                      },
                      {
                        title: '',
                        render: (_: unknown, i: Invoice) =>
                          i.status !== 'PAID' && (
                            <Space>
                              {canHandleMoney(me?.role) && (
                                <Button size="small" type="primary" onClick={() => setPaying(i)}>
                                  Terima bayar
                                </Button>
                              )}
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
