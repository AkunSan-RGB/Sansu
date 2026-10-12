import { useQuery } from '@tanstack/react-query';
import {
  BankOutlined,
  CheckCircleTwoTone,
  CloseCircleFilled,
  DatabaseOutlined,
  ExclamationCircleFilled,
  FileDoneOutlined,
  FundOutlined,
  InfoCircleFilled,
  RiseOutlined,
  RightOutlined,
  ShopOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Col, List, Progress, Row, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { get } from '@/api/client';
import type { Dashboard } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { fmtDate, fmtMoney } from '@/lib/format';
import { InvoiceStatusTag } from '../sales/status';
import { t } from '@/lib/terms';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const finance = ['OWNER', 'ADMIN', 'FINANCE'].includes(me?.role ?? '');
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['dashboard'], queryFn: () => get<Dashboard>('/dashboard') });
  const attention = useQuery({
    queryKey: ['dashboard', 'attention'],
    queryFn: () =>
      get<{ score: number; grade: string; items: { key: string; level: 'error' | 'warning' | 'info'; title: string; detail: string; link: string }[] }>('/dashboard/attention'),
    enabled: finance,
  });
  const ICON = {
    error: <CloseCircleFilled style={{ color: '#ff4d4f' }} />,
    warning: <ExclamationCircleFilled style={{ color: '#faad14' }} />,
    info: <InfoCircleFilled style={{ color: '#1677ff' }} />,
  };

  // Angka yang tidak boleh dilihat peran ini dikirim null oleh server: kartunya disembunyikan, bukan ditampilkan sebagai Rp0
  const cards: { title: string; value: string; sub: string; to?: string; hidden?: boolean; icon: React.ReactNode; tone: [string, string] }[] = [
    { title: t('Penjualan bulan ini (DPP)'), icon: <RiseOutlined />, tone: ['#E8EEFA', '#1C3160'], value: fmtMoney(data?.salesMonth), sub: `${data?.invoicesMonth ?? 0} faktur`, hidden: data?.salesMonth === null },
    { title: 'Laba kotor bulan ini', icon: <FundOutlined />, tone: ['#E3F5EE', '#0E7A5C'], value: fmtMoney(data?.grossProfitMonth), sub: `Margin ${data?.grossMarginPct ?? 0}%`, hidden: data?.grossProfitMonth === null },
    { title: 'Piutang beredar', icon: <FileDoneOutlined />, tone: ['#FBF1DC', '#8A6A1F'], value: fmtMoney(data?.arOutstanding), sub: `Jatuh tempo: ${fmtMoney(data?.arOverdue)}`, hidden: data?.arOutstanding === null },
    { title: t('Nilai persediaan'), icon: <DatabaseOutlined />, tone: ['#EEE9F8', '#5B3FA8'], value: fmtMoney(data?.stockValue), sub: `${data?.ordersPending ?? 0} order belum difakturkan`, hidden: data?.stockValue === null },
    { title: 'Order belum difakturkan', icon: <ShopOutlined />, tone: ['#EEE9F8', '#5B3FA8'], value: String(data?.ordersPending ?? 0), sub: 'Draft dan terkonfirmasi', hidden: data?.stockValue !== null || data?.ordersPending == null },
    { title: 'Saldo kas & bank', icon: <WalletOutlined />, tone: ['#E3F5EE', '#0E7A5C'], value: fmtMoney(data?.cashBalance), sub: 'Semua akun kas dan rekening', to: '/cash', hidden: data?.cashBalance === null },
    { title: t('Hutang ke supplier'), icon: <BankOutlined />, tone: ['#FDECEC', '#B42318'], value: fmtMoney(data?.apOutstanding), sub: 'Faktur pembelian belum lunas', to: '/purchase-invoices', hidden: data?.apOutstanding === null },
  ];

  const greet = (() => {
    const h = dayjs().hour();
    return h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
  })();
  const heroFigures = [
    { label: t('Penjualan bulan ini (DPP)'), value: data?.salesMonth, hidden: data?.salesMonth === null },
    { label: 'Laba kotor bulan ini', value: data?.grossProfitMonth, hidden: data?.grossProfitMonth === null },
    { label: 'Saldo kas & bank', value: data?.cashBalance, hidden: data?.cashBalance === null },
  ].filter((f) => !f.hidden);

  return (
    <>
      <div className="dash-hero" style={{ marginBottom: 20 }}>
        <div className="hero-grid">
          <div>
            <h2 style={{ fontSize: 24 }}>
              {greet}, {me?.name?.split(' ')[0]}
            </h2>
            <p>
              {me?.tenantName} · {dayjs().format('dddd, D MMMM YYYY')}
            </p>
          </div>
          {heroFigures.map((f) => (
            <div key={f.label}>
              <div className="hero-label">{f.label}</div>
              <div className="hero-figure">{isLoading ? '…' : fmtMoney(f.value)}</div>
            </div>
          ))}
        </div>
      </div>
      {isError && (
        <Alert type="error" showIcon style={{ marginBottom: 16 }} message="Ringkasan gagal dimuat" description={(error as Error).message} action={<a onClick={() => refetch()}>Coba lagi</a>} />
      )}
      {!!data?.overdueCount && data.arOverdue !== null && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`${data.overdueCount} faktur sudah lewat jatuh tempo senilai ${fmtMoney(data.arOverdue)}. Pelanggan terkait otomatis diblokir dari order baru.`}
        />
      )}
      <Row gutter={[16, 16]}>
        {cards.filter((c) => !c.hidden).map((c) => (
          <Col xs={24} sm={12} xl={8} key={c.title}>
            <div className={`kpi${c.to ? ' clickable' : ''}`} onClick={() => c.to && navigate(c.to)} role={c.to ? 'link' : undefined}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="kpi-label">{t(c.title)}</span>
                <span className="kpi-icon" style={{ background: c.tone[0], color: c.tone[1] }}>{c.icon}</span>
              </div>
              <div className="kpi-value">{isLoading ? '…' : c.value}</div>
              <div className="kpi-sub">{c.sub}</div>
            </div>
          </Col>
        ))}
      </Row>
      {finance && (
        <Card
          title="Perlu perhatian"
          style={{ marginTop: 20 }}
          loading={attention.isPending}
          extra={
            attention.data && (
              <span style={{ cursor: 'pointer' }} onClick={() => navigate('/health')}>
                <Progress type="circle" size={34} percent={attention.data.score} format={(p) => p} strokeColor={attention.data.score >= 85 ? '#52c41a' : '#faad14'} />{' '}
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
              <CheckCircleTwoTone twoToneColor="#52c41a" /> Semua beres — tidak ada pajak jatuh tempo, mutasi bank cocok, dan pembukuan sehat.
            </Typography.Text>
          )}
        </Card>
      )}
      {(isLoading || data?.salesMonth !== null) && (
      <Card title={t('Faktur terbaru')} style={{ marginTop: 20 }} extra={<Button type="link" onClick={() => navigate('/invoices')}>Lihat semua</Button>}>
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
