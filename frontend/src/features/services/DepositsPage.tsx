import { PlusOutlined } from '@ant-design/icons';
import { type CustomerDeposit } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Empty, Input, Segmented, Space, Table, Tag } from 'antd';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, qs } from '@/api/client';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import SummaryCards from '@/components/SummaryCards';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';
import { t } from '@/lib/terms';
import { DepositModal } from './deposits/DepositModal';
import { ApplyDepositModal } from './deposits/ApplyDepositModal';

export default function DepositsPage() {
  const can = useCan();
  const [params] = useSearchParams();
  const [creating, setCreating] = useState(!!params.get('customerId'));
  const [applying, setApplying] = useState<CustomerDeposit | null>(null);
  const [openOnly, setOpenOnly] = useState(false);
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['deposits', 'all'],
    queryFn: () => get<CustomerDeposit[]>(`/services/deposits${qs({})}`),
  });
  const all = q.data ?? [];
  const term = search.trim().toLowerCase();
  const shown = all.filter(
    (r) => (!openOnly || Number(r.remaining) > 0) && (!term || `${r.number} ${r.customer.name} ${r.project?.name ?? ''}`.toLowerCase().includes(term)),
  );
  const left = all.filter((r) => Number(r.remaining) > 0);
  const sum = (xs: CustomerDeposit[], k: 'amount' | 'remaining') => xs.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  return (
    <>
      <PageHeader
        title={t('Uang muka pelanggan')}
        extra={
          can('POST', '/services/deposits') ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              Terima uang muka
            </Button>
          ) : undefined
        }
      />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Uang muka belum menjadi pendapatan"
        description={t('DP dicatat sebagai utang kepada pelanggan (Uang Muka Pelanggan) sampai pekerjaan ditagih. Bila PKP, PPN atas uang muka terutang saat uang diterima — terbitkan faktur pajak uang muka. Saat faktur termin terbit, pakai uang muka untuk mengurangi tagihan.')}
      />
      {!q.isLoading && all.length > 0 && (
        <SummaryCards
          items={[
            { label: 'Total uang muka diterima', value: fmtMoney(sum(all, 'amount')), hint: `${all.length} uang muka` },
            { label: 'Masih tersisa (belum dipakai)', value: fmtMoney(sum(left, 'remaining')), hint: `${left.length} uang muka`, tone: left.length ? 'warn' : 'neutral' },
            { label: 'Sudah terpakai', value: fmtMoney(sum(all, 'amount') - sum(all, 'remaining')), tone: 'good' },
          ]}
        />
      )}
      <Card>
        <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
          <Segmented
            value={openOnly ? 'OPEN' : 'ALL'}
            onChange={(v) => setOpenOnly(v === 'OPEN')}
            options={[
              { value: 'ALL', label: `Semua (${all.length})` },
              { value: 'OPEN', label: `Masih tersisa (${left.length})` },
            ]}
          />
          <Input.Search allowClear placeholder="Cari pelanggan, proyek, atau nomor" style={{ width: 260 }} onChange={(e) => setSearch(e.target.value)} />
        </Space>
        <ResponsiveTable<CustomerDeposit>
          rowKey="id"
          size="small"
          loading={q.isLoading}
          dataSource={shown}
          scroll={{ x: 800 }}
          locale={{ emptyText: <Empty description={search || openOnly ? 'Tidak ada data yang cocok dengan pilihan ini' : 'Belum ada uang muka'} /> }}
          expandable={{
            rowExpandable: (r) => !!r.applications?.length,
            expandedRowRender: (r) => (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={r.applications}
                columns={[
                  { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
                  { title: t('Dipakai untuk faktur'), render: (_, a) => a.invoice.number },
                  { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: fmtMoney },
                ]}
              />
            ),
          }}
          columns={[
            { title: 'No.', dataIndex: 'number' },
            { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
            { title: t('Pelanggan'), render: (_, r) => r.customer.name },
            { title: 'Proyek', render: (_, r) => r.project?.name ?? '-' },
            { title: 'Diterima', dataIndex: 'amount', align: 'right', render: fmtMoney },
            { title: 'PPN', dataIndex: 'taxAmount', align: 'right', render: fmtMoney },
            {
              title: 'Sisa',
              dataIndex: 'remaining',
              align: 'right',
              render: (v: string) => (Number(v) > 0 ? <b>{fmtMoney(v)}</b> : <Tag>Habis</Tag>),
            },
            {
              render: (_, r) =>
                Number(r.remaining) > 0 &&
                can('POST', '/services/deposits/:id/apply') && (
                  <Button size="small" onClick={() => setApplying(r)}>
                    Pakai untuk faktur
                  </Button>
                ),
            },
          ]}
        />
      </Card>
      <DepositModal
        open={creating}
        onClose={() => setCreating(false)}
        customerId={params.get('customerId') ?? undefined}
        projectId={params.get('projectId') ?? undefined}
      />
      <ApplyDepositModal deposit={applying} onClose={() => setApplying(null)} />
    </>
  );
}
