import { ToolOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Radio, Select, Space, Tabs, Tag } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, qs } from '@/api/client';
import type { ScheduleOverview, ScheduleOverviewItem } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import QueryState from '@/components/QueryState';
import ResponsiveTable from '@/components/ResponsiveTable';
import SummaryCards from '@/components/SummaryCards';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney } from '@/lib/format';
import FixedAssetsManager from '../fixed-assets/FixedAssetsManager';
import ScheduleDetail from './ScheduleDetail';
import ContractsTab from './ContractsTab';
import SnapshotsTab from './SnapshotsTab';

const KIND_LABEL: Record<string, string> = {
  CASH: 'Kas & bank',
  RECEIVABLE: 'Piutang per pelanggan',
  PAYABLE: 'Utang per pemasok',
  INVENTORY: 'Persediaan per produk',
  FIXED_ASSET_COST: 'Aset tetap: perolehan',
  FIXED_ASSET_ACCUMULATED: 'Aset tetap: akumulasi',
  DEPRECIATION_EXPENSE: 'Aset tetap: beban penyusutan',
  TAX: 'Pajak',
  EQUITY: 'Ekuitas',
  UNCLOSED_EARNINGS: 'Laba berjalan',
  REVENUE: 'Pendapatan',
  COST_OF_SALES: 'Harga pokok',
  EXPENSE: 'Beban',
  GENERIC: 'Mutasi bulanan (umum)',
};
const isAsset = (k: string) => k.startsWith('FIXED_ASSET') || k === 'DEPRECIATION_EXPENSE';
type Filter = 'ALL' | 'UNMATCHED' | 'DEFINE' | 'FINDING';

/**
 * Menu khusus rincian, perhitungan, dan metode setiap akun yang tampil di laporan keuangan (neraca dan laba rugi).
 * Saldo akhir tiap rincian dicocokkan dengan angka akun itu di laporan keuangan. Kelola aset tetap ada di tab sebelahnya.
 */
export default function AccountSchedulesPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const thisYear = new Date().getFullYear();
  const year = Number(params.get('year')) || thisYear;
  const account = params.get('account');
  const tab = params.get('manage') ? 'assets' : params.get('view') === 'snapshots' ? 'snapshots' : params.get('view') === 'contracts' ? 'contracts' : 'accounts';
  const [filter, setFilter] = useState<Filter>('ALL');
  const detailRef = useRef<HTMLDivElement>(null);
  // rincian dibuka di bawah daftar yang panjang: gulirkan ke sana agar langsung terlihat
  useEffect(() => {
    if (account) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [account]);
  const set = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v === null ? n.delete(k) : n.set(k, v);
    setParams(n, { replace: true });
  };
  const ov = useQuery({ queryKey: ['account-schedules', 'overview', year], queryFn: () => get<ScheduleOverview>(`/account-schedules${qs({ year: String(year) })}`) });
  const rows = useMemo(() => {
    const items = ov.data?.items ?? [];
    return items.filter((i) => filter === 'ALL' || (filter === 'UNMATCHED' && !i.matches) || (filter === 'DEFINE' && i.needsDefinition) || (filter === 'FINDING' && i.findings > 0));
  }, [ov.data, filter]);

  const accounts = (
    <QueryState q={ov}>
      {(d) => (
        <>
          <SummaryCards
            items={[
              { label: 'Akun di laporan keuangan', value: d.summary.accounts, onClick: () => setFilter('ALL'), active: filter === 'ALL' },
              { label: 'Cocok dengan laporan', value: d.summary.matched, tone: 'good' },
              { label: 'Tidak cocok', value: d.summary.unmatched, tone: d.summary.unmatched ? 'bad' : 'neutral', onClick: () => setFilter('UNMATCHED'), active: filter === 'UNMATCHED' },
              { label: 'Metode perlu ditentukan', value: d.summary.needsDefinition, tone: d.summary.needsDefinition ? 'warn' : 'neutral', onClick: () => setFilter('DEFINE'), active: filter === 'DEFINE' },
            ]}
          />
          <Space style={{ marginBottom: 12 }} wrap>
            <Radio.Group value={filter} onChange={(e) => setFilter(e.target.value)} optionType="button" buttonStyle="solid" size="small">
              <Radio.Button value="ALL">Semua</Radio.Button>
              <Radio.Button value="UNMATCHED">Tidak cocok</Radio.Button>
              <Radio.Button value="FINDING">Ada catatan</Radio.Button>
              <Radio.Button value="DEFINE">Perlu ditentukan</Radio.Button>
            </Radio.Group>
          </Space>
          <ResponsiveTable<ScheduleOverviewItem>
            size="small"
            rowKey="accountId"
            dataSource={rows}
            pagination={{ pageSize: 25, hideOnSinglePage: true }}
            onRow={(r) => ({ onClick: () => set({ account: r.accountId }), style: { cursor: 'pointer', background: r.accountId === account ? '#F0F7FF' : undefined } })}
            onMobileClick={(r) => set({ account: r.accountId })}
            columns={[
              { title: 'Kode', dataIndex: 'code', width: 90 },
              { title: 'Akun', dataIndex: 'name' },
              { title: 'Jenis rincian', dataIndex: 'kind', render: (k: string, r) => <Tag color={r.needsDefinition ? 'orange' : 'blue'}>{KIND_LABEL[k] ?? k}</Tag> },
              { title: 'Saldo di laporan', dataIndex: 'reported', align: 'right', render: fmtMoney },
              { title: 'Saldo rincian', dataIndex: 'computed', align: 'right', render: fmtMoney },
              {
                title: 'Status',
                align: 'center',
                render: (_: unknown, r) => (r.matches ? <Tag color="green">Cocok{r.findings ? ` · ${r.findings} catatan` : ''}</Tag> : <Tag color="red">Selisih {fmtMoney(r.difference)}</Tag>),
              },
            ]}
          />
          {account && (
            <Card ref={detailRef} style={{ marginTop: 16 }} extra={<Button size="small" onClick={() => set({ account: null })}>Tutup</Button>}>
              <ScheduleDetail
                accountId={account}
                year={year}
                company={me?.tenantName}
                extra={
                  isAsset(d.items.find((i) => i.accountId === account)?.kind ?? '') ? (
                    <Button icon={<ToolOutlined />} onClick={() => set({ manage: '1' })}>
                      Kelola aset tetap
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          )}
        </>
      )}
    </QueryState>
  );

  return (
    <>
      <PageHeader
        title="Rincian & Perhitungan Akun"
        extra={
          <Select
            value={year}
            style={{ width: 140 }}
            onChange={(y) => set({ year: String(y), account: null })}
            options={Array.from({ length: 6 }, (_, i) => thisYear - i).map((y) => ({ value: y, label: `Tahun ${y}` }))}
          />
        }
      />
      <Tabs
        activeKey={tab}
        onChange={(k) => set({ manage: k === 'assets' ? '1' : null, view: k === 'snapshots' || k === 'contracts' ? k : null })}
        items={[
          { key: 'accounts', label: 'Rincian per akun', children: accounts },
          { key: 'contracts', label: 'Kontrak & pinjaman', children: <ContractsTab year={year} /> },
          { key: 'snapshots', label: 'Laporan dibekukan', children: <SnapshotsTab year={year} /> },
          { key: 'assets', label: 'Kelola aset tetap', children: <FixedAssetsManager /> },
        ]}
      />
    </>
  );
}
