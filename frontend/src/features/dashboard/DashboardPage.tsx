import { useQuery } from '@tanstack/react-query';
import {
  CheckCircleTwoTone,
  CloseCircleFilled,
  DatabaseOutlined,
  ExclamationCircleFilled,
  FileDoneOutlined,
  FundOutlined,
  InfoCircleFilled,
  RightOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, List, Progress, Select, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, qs } from '@/api/client';
import { useBranches } from '@/api/queries';
import type { Dashboard } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import SummaryCards, { type SummaryItem } from '@/components/SummaryCards';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';
import { InvoiceStatusTag } from '../sales/status';
import { t } from '@/lib/terms';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const finance = ['OWNER', 'ADMIN', 'FINANCE'].includes(me?.role ?? '');
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
    info: <InfoCircleFilled style={{ color: '#1677ff' }} />,
  };

  // Angka yang tidak boleh dilihat peran ini dikirim null oleh server: kotaknya disembunyikan, bukan ditampilkan sebagai Rp0
  const val = (v: string) => (isLoading ? '…' : v);
  const go = (to: string) => () => navigate(to);
  const main: (SummaryItem & { hidden?: boolean })[] = [
    {
      label: t('Penjualan bulan ini (DPP)'),
      value: val(fmtMoney(data?.salesMonth)),
      hint: `${data?.invoicesMonth ?? 0} faktur`,
      hidden: data?.salesMonth === null,
    },
    {
      label: 'Laba kotor bulan ini',
      value: val(fmtMoney(data?.grossProfitMonth)),
      tone: 'good',
      hint: `Margin ${data?.grossMarginPct ?? 0}%`,
      hidden: data?.grossProfitMonth === null,
    },
    {
      label: 'Saldo kas & bank',
      value: val(fmtMoney(data?.cashBalance)),
      hint: 'Semua akun kas dan rekening',
      onClick: go('/cash'),
      hidden: data?.cashBalance === null,
    },
  ];
  const second: (SummaryItem & { hidden?: boolean })[] = [
    {
      label: 'Piutang beredar',
      value: val(fmtMoney(data?.arOutstanding)),
      tone: 'warn',
      hint: `Jatuh tempo: ${fmtMoney(data?.arOverdue)}`,
      hidden: data?.arOutstanding === null,
    },
    {
      label: t('Hutang ke supplier'),
      value: val(fmtMoney(data?.apOutstanding)),
      tone: 'bad',
      hint: 'Faktur pembelian belum lunas',
      onClick: go('/purchase-invoices'),
      hidden: data?.apOutstanding === null,
    },
    {
      label: t('Nilai persediaan'),
      value: val(fmtMoney(data?.stockValue)),
      hint: `${data?.ordersPending ?? 0} order belum difakturkan`,
      hidden: data?.stockValue === null,
    },
    {
      label: 'Order belum difakturkan',
      value: String(data?.ordersPending ?? 0),
      hint: 'Draft dan terkonfirmasi',
      hidden: data?.stockValue !== null || data?.ordersPending == null,
    },
  ];
  const mainShown = main.filter((c) => !c.hidden);
  const secondShown = second.filter((c) => !c.hidden);

  const quick = [
    { label: 'Faktur penjualan', to: '/invoices', icon: <FileDoneOutlined />, on: finance || me?.role === 'SALES' },
    { label: t('Pelanggan'), to: '/customers', icon: <ShopOutlined />, on: true },
    { label: 'Produk & stok', to: '/products', icon: <DatabaseOutlined />, on: true },
    { label: 'Laporan', to: '/reports', icon: <FundOutlined />, on: finance },
  ].filter((q) => q.on);

  const greet = (() => {
    const h = dayjs().hour();
    return h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
  })();
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
      <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
        {greet}, {me?.name?.split(' ')[0]} · {me?.tenantName} · {dayjs().format('dddd, D MMMM YYYY')}
      </Typography.Paragraph>
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
      <div className="qa">
        {quick.map((q) => (
          <button key={q.to} type="button" onClick={() => navigate(q.to)}>
            <span className="qa-ic">{q.icon}</span>
            {q.label}
          </button>
        ))}
      </div>
      {mainShown.length > 0 && <SummaryCards items={mainShown} />}
      {secondShown.length > 0 && <SummaryCards items={secondShown} />}
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
