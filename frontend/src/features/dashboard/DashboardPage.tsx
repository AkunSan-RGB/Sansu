import { useQuery } from '@tanstack/react-query';
import { canViewFinancials } from '@sansu/shared';
import {
  BankOutlined,
  CheckCircleTwoTone,
  ClockCircleOutlined,
  CloseCircleFilled,
  ExclamationCircleFilled,
  InboxOutlined,
  InfoCircleFilled,
  LineChartOutlined,
  RightOutlined,
  ShoppingCartOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, List, Progress, Select, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, qs } from '@/api/client';
import { useBranches } from '@/api/queries';
import type { Dashboard } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';
import { InvoiceStatusTag } from '../sales/status';
import { t } from '@/lib/terms';
import DashboardHero from './DashboardHero';
import InsightPanel from './InsightPanel';
import KpiTiles, { type KpiTile } from './KpiTiles';
import ProfileKpiTiles from './ProfileKpiTiles';
import { quickActionsFor } from '@sansu/shared';
import { useVisibilityCtx, visibleLinks } from '@/lib/visibility';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const finance = canViewFinancials(me?.role);
  const ctx = useVisibilityCtx();
  // Jasa: pintasan di kepala beranda = aksi cepat khas profil layanan yang boleh dibuka pengguna ini
  const profileActions = me?.businessModel === 'JASA' ? visibleLinks(quickActionsFor(me.serviceProfiles), ctx) : undefined;
  const branchList = useBranches();
  const myBranches = me?.branchIds?.length ? me.branchIds : null;
  const branchOpts = (branchList.data?.branches ?? []).filter(
    (b) => b.isActive && (!myBranches || myBranches.includes(b.id)),
  );
  const [branchPick, setBranchPick] = useState<string>();
  const branchId = myBranches ? (branchPick ?? myBranches[0]) : branchPick;
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard', 'summary', branchId],
    queryFn: () => get<Dashboard>(`/dashboard${qs({ branchId })}`),
  });
  const attention = useQuery({
    queryKey: ['dashboard', 'attention'],
    queryFn: () =>
      get<{
        score: number;
        grade: string;
        items: { key: string; level: 'error' | 'warning' | 'info'; title: string; detail: string; link: string }[];
      }>('/dashboard/attention'),
    enabled: finance && !myBranches,
  });
  const ICON = {
    error: <CloseCircleFilled style={{ color: '#ff4d4f' }} />,
    warning: <ExclamationCircleFilled style={{ color: '#faad14' }} />,
    info: <InfoCircleFilled style={{ color: '#111111' }} />,
  };

  // Angka yang tidak boleh dilihat peran ini dikirim null oleh server: kotaknya disembunyikan, bukan ditampilkan sebagai Rp0
  const val = (v: string) => (isLoading ? '…' : v);
  // ringkasan dibaca sekilas: tanpa sen (angka lengkap ada di laporan)
  const rp = (v: Parameters<typeof fmtMoney>[0]) => fmtMoney(v).replace(/,\d+$/, '');
  const go = (to: string) => () => navigate(to);
  const heroFigures = [
    { label: t('Penjualan bulan ini'), value: val(rp(data?.salesMonth)), hidden: data?.salesMonth === null },
    { label: 'Laba kotor bulan ini', value: val(rp(data?.grossProfitMonth)), hidden: data?.grossProfitMonth === null },
    { label: 'Saldo kas & bank', value: val(rp(data?.cashBalance)), onClick: go('/cash'), hidden: data?.cashBalance === null },
  ].filter((f) => !f.hidden);
  const tiles: (KpiTile & { hidden?: boolean })[] = [
    { label: 'Piutang beredar', value: val(rp(data?.arOutstanding)), tone: 'warn', icon: <ClockCircleOutlined />, hint: `Jatuh tempo: ${fmtMoney(data?.arOverdue)}`, onClick: go('/invoices'), hidden: data?.arOutstanding === null },
    { label: t('Hutang ke supplier'), value: val(rp(data?.apOutstanding)), tone: 'bad', icon: <WalletOutlined />, hint: 'Faktur pembelian belum lunas', onClick: go('/purchase-invoices'), hidden: data?.apOutstanding === null },
    { label: t('Nilai persediaan'), value: val(rp(data?.stockValue)), icon: <InboxOutlined />, hint: `${data?.ordersPending ?? 0} order belum difakturkan`, hidden: data?.stockValue === null },
    { label: 'Order belum difakturkan', value: String(data?.ordersPending ?? 0), icon: <ShoppingCartOutlined />, hint: 'Draft dan terkonfirmasi', onClick: go('/sales-orders'), hidden: data?.stockValue !== null || data?.ordersPending == null },
    { label: 'Margin kotor', value: val(`${data?.grossMarginPct ?? 0}%`), tone: 'good', icon: <LineChartOutlined />, hint: 'Laba kotor dibanding penjualan bulan ini', hidden: data?.grossProfitMonth === null },
    { label: 'Faktur bulan ini', value: String(data?.invoicesMonth ?? 0), icon: <BankOutlined />, hint: data?.posOrdersMonth ? `${data.posOrdersMonth} transaksi kasir` : 'Neto setelah retur', hidden: data?.salesMonth === null },
  ];
  const tilesShown = tiles.filter((c) => !c.hidden);

  return (
    <>
      <PageHeader
        title="Beranda"
        extra={
          branchOpts.length > 0 && (
            <Select
              allowClear={!myBranches}
              placeholder="Semua cabang (konsolidasi)"
              style={{ width: 260, maxWidth: '100%' }}
              value={branchId}
              onChange={setBranchPick}
              options={[
                ...(myBranches ? [] : [{ value: 'NONE', label: 'Pusat' }]),
                ...branchOpts.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` })),
              ]}
            />
          )
        }
      />
      <DashboardHero name={me?.name} tenantName={me?.tenantName} model={me?.businessModel ?? 'DAGANG'} profiles={me?.serviceProfiles} actions={profileActions} figures={heroFigures} showFinance={finance} canSell={me?.role === 'SALES'} />
      {isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="Ringkasan gagal dimuat"
          description={(error as Error).message}
          action={<a onClick={() => refetch()}>Coba lagi</a>}
        />
      )}
      {!!data?.overdueCount && data.arOverdue !== null && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`${data.overdueCount} faktur sudah lewat jatuh tempo senilai ${fmtMoney(data.arOverdue)}. Pelanggan terkait otomatis diblokir dari order baru.`}
        />
      )}
      <KpiTiles items={tilesShown} />
      {finance && <ProfileKpiTiles />}
      {finance && !myBranches && <InsightPanel />}
      {finance && (
        <Card
          title="Perlu perhatian"
          style={{ marginTop: 16 }}
          loading={attention.isPending}
          extra={
            attention.data && (
              <span style={{ cursor: 'pointer' }} onClick={() => navigate('/health')}>
                <Progress
                  type="circle"
                  size={34}
                  percent={attention.data.score}
                  format={(p) => p}
                  strokeColor={attention.data.score >= 85 ? '#52c41a' : '#faad14'}
                />{' '}
                <Typography.Text type="secondary">Kesehatan pembukuan</Typography.Text>
              </span>
            )
          }
        >
          {attention.isError ? (
            <Alert type="warning" showIcon message={(attention.error as Error).message} />
          ) : attention.data?.items.length ? (
            <List
              size="small"
              dataSource={attention.data.items}
              renderItem={(i) => (
                <List.Item style={{ cursor: 'pointer' }} onClick={() => navigate(i.link)} extra={<RightOutlined />}>
                  <List.Item.Meta avatar={ICON[i.level]} title={i.title} description={i.detail} />
                </List.Item>
              )}
            />
          ) : (
            <Typography.Text>
              <CheckCircleTwoTone twoToneColor="#52c41a" /> Semua beres — tidak ada pajak jatuh tempo, mutasi bank
              cocok, dan pembukuan sehat.
            </Typography.Text>
          )}
        </Card>
      )}
      {(isLoading || data?.salesMonth !== null) && (
        <Card
          title={t('Faktur terbaru')}
          style={{ marginTop: 16 }}
          extra={
            <Button type="link" onClick={() => navigate('/invoices')}>
              Lihat semua
            </Button>
          }
        >
          <Table
            rowKey="id"
            size="small"
            loading={isLoading}
            pagination={false}
            scroll={{ x: 600 }}
            dataSource={data?.recentInvoices}
            columns={[
              { title: 'Nomor', dataIndex: 'number' },
              { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
              { title: t('Pelanggan'), dataIndex: ['customer', 'name'] },
              { title: 'Total', dataIndex: 'total', align: 'right', render: fmtMoney },
              { title: 'Status', dataIndex: 'status', render: (s) => <InvoiceStatusTag status={s} /> },
            ]}
            locale={{ emptyText: <Tag>{t('Belum ada faktur')}</Tag> }}
          />
        </Card>
      )}
    </>
  );
}
