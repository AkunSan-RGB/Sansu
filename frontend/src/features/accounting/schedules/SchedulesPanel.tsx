import { InfoCircleOutlined, SearchOutlined, ToolOutlined } from '@ant-design/icons';
import { REPORT_GROUPS, type ReportGroup } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Checkbox, Input, Radio, Space, Tag, Tooltip, Typography } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, qs } from '@/api/client';
import type { ScheduleOverview, ScheduleOverviewItem } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import QueryState from '@/components/QueryState';
import ResponsiveTable from '@/components/ResponsiveTable';
import SummaryCards from '@/components/SummaryCards';
import { fmtMoney } from '@/lib/format';
import FixedAssetsManager from '../fixed-assets/FixedAssetsManager';
import ContractsTab from './ContractsTab';
import ScheduleDetail from './ScheduleDetail';
import SnapshotsTab from './SnapshotsTab';

export type ScheduleSection = 'rincian' | 'kontrak' | 'beku' | 'aset';

/** Nama jenis rincian dalam bahasa pemakai, dan satu kalimat tentang isinya */
const KIND_LABEL: Record<string, { label: string; hint: string }> = {
  CASH: { label: 'Kas', hint: 'Penerimaan dan pengeluaran tiap bulan.' },
  BANK: { label: 'Rekonsiliasi bank', hint: 'Saldo buku dicocokkan dengan rekening koran.' },
  RECEIVABLE: { label: 'Piutang per pelanggan', hint: 'Saldo awal, faktur, pembayaran, dan retur tiap pelanggan.' },
  PAYABLE: { label: 'Utang per pemasok', hint: 'Saldo awal, tagihan, pembayaran, dan retur tiap pemasok.' },
  INVENTORY: { label: 'Persediaan per produk', hint: 'Kartu stok: jumlah dan nilai tiap produk.' },
  FIXED_ASSET_COST: { label: 'Aset tetap: harga perolehan', hint: 'Perolehan dan pelepasan tiap aset.' },
  FIXED_ASSET_ACCUMULATED: { label: 'Aset tetap: akumulasi', hint: 'Akumulasi penyusutan tiap aset.' },
  DEPRECIATION_EXPENSE: { label: 'Aset tetap: beban penyusutan', hint: 'Perhitungan penyusutan tiap bulan.' },
  TAX: { label: 'Pajak', hint: 'Pemungutan dan penyetoran tiap bulan.' },
  PREPAID: { label: 'Dibayar di muka', hint: 'Pembayaran, amortisasi, dan jadwalnya.' },
  ACCRUAL: { label: 'Beban akrual', hint: 'Akrual, pembayaran, dan jurnal balik.' },
  DEFERRED_REVENUE: { label: 'Diterima di muka', hint: 'Penerimaan dan pengakuan pendapatan.' },
  LOAN: { label: 'Pinjaman', hint: 'Pencairan, angsuran, dan bunga.' },
  LEASE: { label: 'Sewa pembiayaan', hint: 'Liabilitas sewa, pokok, dan bunga.' },
  EQUITY: { label: 'Ekuitas', hint: 'Setoran, pengambilan, dan penutupan laba.' },
  UNCLOSED_EARNINGS: { label: 'Laba berjalan', hint: 'Laba rugi per bulan sebelum ditutup.' },
  REVENUE: { label: 'Pendapatan', hint: 'Jumlah tiap bulan dan akumulasi.' },
  COST_OF_SALES: { label: 'Harga pokok', hint: 'Beban pokok tiap bulan.' },
  EXPENSE: { label: 'Beban', hint: 'Jumlah tiap bulan dan akumulasi.' },
  GENERIC: { label: 'Daftar transaksi', hint: 'Transaksi tahun ini; metode belum ditentukan.' },
};
export const isAssetKind = (k: string) => k.startsWith('FIXED_ASSET') || k === 'DEPRECIATION_EXPENSE';
type Filter = 'ALL' | 'UNMATCHED' | 'DEFINE' | 'FINDING';
type Part = 'ALL' | 'BS' | 'PL';
const partOf = (type: string): Part => (type === 'REVENUE' || type === 'EXPENSE' ? 'PL' : 'BS');
const groupLabel = (g: string) => REPORT_GROUPS[g as ReportGroup]?.label ?? g;

/** Daftar akun yang punya angka di laporan keuangan, dicocokkan dengan saldo akhirnya; klik akun untuk membuka rinciannya */
function AccountList({ year }: { year: number }) {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const account = params.get('account');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [part, setPart] = useState<Part>('ALL');
  const [search, setSearch] = useState('');
  const [showEmpty, setShowEmpty] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (account) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [account]);
  const pick = (id: string | null) => {
    const n = new URLSearchParams(params);
    id ? n.set('account', id) : n.delete('account');
    setParams(n, { replace: true });
  };
  const goAssets = () => {
    const n = new URLSearchParams(params);
    n.set('kind', 'aset');
    n.delete('account');
    setParams(n, { replace: true });
  };
  const ov = useQuery({
    queryKey: ['account-schedules', 'overview', year, showEmpty],
    queryFn: () => get<ScheduleOverview>(`/account-schedules${qs({ year: String(year), includeEmpty: showEmpty ? '1' : undefined })}`),
  });
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (ov.data?.items ?? []).filter(
      (i) =>
        (part === 'ALL' || partOf(i.type) === part) &&
        (filter === 'ALL' || (filter === 'UNMATCHED' && !i.matches) || (filter === 'DEFINE' && i.needsDefinition) || (filter === 'FINDING' && i.findings > 0)) &&
        (!term || `${i.code} ${i.name}`.toLowerCase().includes(term)),
    );
  }, [ov.data, filter, part, search]);
  const selected = ov.data?.items.find((i) => i.accountId === account);

  return (
    <QueryState q={ov}>
      {(d) => (
        <>
          <SummaryCards
            items={[
              { label: 'Akun yang tampil di laporan', value: d.summary.accounts, hint: 'Hanya akun yang punya saldo atau mutasi', onClick: () => setFilter('ALL'), active: filter === 'ALL' },
              { label: 'Cocok dengan laporan keuangan', value: d.summary.matched, tone: 'good' },
              { label: 'Tidak cocok', value: d.summary.unmatched, tone: d.summary.unmatched ? 'bad' : 'neutral', hint: 'Saldo rincian berbeda dari laporan', onClick: () => setFilter('UNMATCHED'), active: filter === 'UNMATCHED' },
              { label: 'Metode belum ditentukan', value: d.summary.needsDefinition, tone: d.summary.needsDefinition ? 'warn' : 'neutral', hint: 'Memakai daftar transaksi umum', onClick: () => setFilter('DEFINE'), active: filter === 'DEFINE' },
            ]}
          />
          <Space wrap size={[12, 8]} style={{ marginBottom: 12 }}>
            <Radio.Group value={part} onChange={(e) => setPart(e.target.value)} optionType="button" buttonStyle="solid" size="small">
              <Radio.Button value="ALL">Semua</Radio.Button>
              <Radio.Button value="BS">Neraca</Radio.Button>
              <Radio.Button value="PL">Laba rugi</Radio.Button>
            </Radio.Group>
            <Radio.Group value={filter} onChange={(e) => setFilter(e.target.value)} optionType="button" size="small">
              <Radio.Button value="ALL">Semua status</Radio.Button>
              <Radio.Button value="UNMATCHED">Tidak cocok</Radio.Button>
              <Radio.Button value="FINDING">Ada catatan</Radio.Button>
              <Radio.Button value="DEFINE">Perlu ditentukan</Radio.Button>
            </Radio.Group>
            <Input allowClear size="small" prefix={<SearchOutlined />} placeholder="Cari kode atau nama akun" style={{ width: 240 }} value={search} onChange={(e) => setSearch(e.target.value)} />
            <Tooltip title="Akun bagan akun yang aktif untuk jenis usaha ini tetapi belum punya saldo atau mutasi tahun ini">
              <Checkbox checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)}>
                Tampilkan akun relevan yang masih kosong
              </Checkbox>
            </Tooltip>
          </Space>
          <ResponsiveTable<ScheduleOverviewItem>
            size="small"
            rowKey="accountId"
            dataSource={rows}
            pagination={{ pageSize: 30, hideOnSinglePage: true, showSizeChanger: false }}
            locale={{ emptyText: 'Tidak ada akun yang cocok dengan penyaring ini' }}
            onRow={(r) => ({ onClick: () => pick(r.accountId), style: { cursor: 'pointer', background: r.accountId === account ? '#F0F7FF' : undefined } })}
            onMobileClick={(r) => pick(r.accountId)}
            columns={[
              { title: 'Kode', dataIndex: 'code', width: 84 },
              {
                title: 'Akun',
                dataIndex: 'name',
                render: (n: string, r) => (
                  <div>
                    <Typography.Text strong={r.accountId === account}>{n}</Typography.Text>
                    <div style={{ fontSize: 12, color: '#8c8c8c' }}>{groupLabel(r.reportGroup)}</div>
                  </div>
                ),
              },
              {
                title: 'Isi rincian',
                dataIndex: 'kind',
                render: (k: string, r) => (
                  <Tooltip title={KIND_LABEL[k]?.hint}>
                    <Tag color={r.needsDefinition ? 'orange' : 'blue'} style={{ marginInlineEnd: 0 }}>
                      {KIND_LABEL[k]?.label ?? k}
                    </Tag>
                  </Tooltip>
                ),
              },
              { title: 'Saldo di laporan', dataIndex: 'reported', align: 'right', render: fmtMoney },
              { title: 'Saldo rincian', dataIndex: 'computed', align: 'right', render: fmtMoney },
              {
                title: 'Status',
                align: 'center',
                width: 150,
                render: (_: unknown, r) => (
                  <Space size={4} wrap style={{ justifyContent: 'center' }}>
                    {r.matches ? <Tag color="green" style={{ marginInlineEnd: 0 }}>Cocok</Tag> : <Tag color="red" style={{ marginInlineEnd: 0 }}>Selisih {fmtMoney(r.difference)}</Tag>}
                    {r.findings > 0 && (
                      <Tooltip title="Buka rincian untuk membaca catatannya">
                        <Tag icon={<InfoCircleOutlined />} color="gold" style={{ marginInlineEnd: 0 }}>{r.findings}</Tag>
                      </Tooltip>
                    )}
                  </Space>
                ),
              },
            ]}
          />
          {account && (
            <div ref={detailRef} style={{ scrollMarginTop: 12 }}>
              <Card style={{ marginTop: 16 }} extra={<Button size="small" onClick={() => pick(null)}>Tutup</Button>}>
                <ScheduleDetail
                  accountId={account}
                  year={year}
                  company={me?.tenantName}
                  extra={
                    selected && isAssetKind(selected.kind) ? (
                      <Button icon={<ToolOutlined />} onClick={goAssets}>
                        Kelola aset tetap
                      </Button>
                    ) : undefined
                  }
                />
              </Card>
            </div>
          )}
        </>
      )}
    </QueryState>
  );
}

/** Isi tab rincian & perhitungan akun di halaman Laporan pendukung */
export default function SchedulesPanel({ section, year }: { section: ScheduleSection; year: number }) {
  if (section === 'kontrak') return <ContractsTab year={year} />;
  if (section === 'beku') return <SnapshotsTab year={year} />;
  if (section === 'aset') return <FixedAssetsManager />;
  return <AccountList year={year} />;
}
