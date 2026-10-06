import {
  CheckOutlined,
  CloseOutlined,
  EyeOutlined,
  FileTextOutlined,
  MailOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SendOutlined,
} from '@ant-design/icons';
import {
  BILLING_STATUS_LABELS,
  BRAND,
  SUBSCRIPTION_STATUS_LABELS,
  ROLE_LABELS,
  type BillingInvoiceStatus,
  type Plan,
  type SubscriptionStatus,
  type VatReportRow,
} from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  App,
  Badge,
  Collapse,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, patch, post, put, qs } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import QueryState from '@/components/QueryState';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';
import ExportButtons from '@/components/ExportButtons';
import { subscriptionVatSheet } from '@/lib/xlsx/reports';
import BillingInvoiceModal from '../billing/BillingInvoiceDoc';
import { SUB_COLOR } from '../billing/BillingPage';
import { t } from '@/lib/terms';

interface Overview {
  tenants: number;
  trial: number;
  active: number;
  expired: number;
  suspended: number;
  internal: number;
  mrr: string;
  new30: number;
  paid_month: string;
  waiting: number;
  signups: { month: string; n: number }[];
  revenue: { month: string; amount: string }[];
  gateway: string | null;
  smtp: boolean;
  admins: string[];
}
interface TenantRow {
  id: string;
  name: string;
  created_at: string;
  status: string | null;
  state: SubscriptionStatus;
  endsAt: string | null;
  daysLeft: number | null;
  plan_name: string | null;
  users: number;
  last_login: string | null;
  owner_email: string | null;
  owner_name: string | null;
  owner_verified: boolean | null;
  sales_invoices: number;
  waiting: number;
  notes: string | null;
}
interface PInvoice {
  id: string;
  number: string;
  tenantId: string;
  tenantName: string;
  planName: string;
  cycle: 'MONTHLY' | 'YEARLY';
  amount: string;
  status: BillingInvoiceStatus;
  method: string;
  hasProof: boolean;
  proofNote: string | null;
  rejectReason: string | null;
  paidAt: string | null;
  confirmedBy: string | null;
  createdAt: string;
}
const INV_COLOR: Record<BillingInvoiceStatus, string> = {
  UNPAID: 'gold',
  WAITING: 'blue',
  PAID: 'green',
  CANCELLED: 'default',
};
const KEYS = ['platform-admin'];

export default function PlatformAdminPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  if (!me?.isPlatformAdmin) return <Alert type="error" showIcon message="Khusus pemilik layanan SANSU" />;
  return (
    <>
      <PageHeader title="Panel SANSU — pemilik layanan" />
      <Tabs
        activeKey={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        items={[
          { key: 'overview', label: 'Ringkasan', children: <OverviewTab /> },
          { key: 'tenants', label: 'Perusahaan', children: <TenantsTab /> },
          { key: 'payments', label: 'Pembayaran', children: <PaymentsTab /> },
          { key: 'plans', label: 'Paket', children: <PlansTab /> },
          { key: 'vat', label: 'Laporan PPN', children: <VatTab /> },
          { key: 'system', label: 'Sistem', children: <SystemTab /> },
          { key: 'settings', label: 'Pengaturan', children: <SettingsTab /> },
        ]}
      />
    </>
  );
}

// ---------------- Ringkasan ----------------
function Bars({
  rows,
  value,
  fmt,
}: {
  rows: { month: string }[];
  value: (r: never) => number;
  fmt: (n: number) => string;
}) {
  const vals = rows.map((r) => value(r as never));
  const max = Math.max(1, ...vals);
  if (!rows.length) return <Typography.Text type="secondary">Belum ada data</Typography.Text>;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {rows.map((r, i) => (
        <div
          key={r.month}
          style={{ display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 10, alignItems: 'center', fontSize: 13 }}
        >
          <span>{dayjs(`${r.month}-01`).format('MMM YY')}</span>
          <div style={{ background: BRAND.colors.primarySoft, borderRadius: 4, height: 14 }}>
            <div
              style={{
                width: `${(vals[i] / max) * 100}%`,
                background: BRAND.colors.primary,
                height: '100%',
                borderRadius: 4,
                minWidth: vals[i] ? 3 : 0,
              }}
            />
          </div>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(vals[i])}</span>
        </div>
      ))}
    </div>
  );
}

function OverviewTab() {
  const q = useQuery({ queryKey: [...KEYS, 'overview'], queryFn: () => get<Overview>('/platform-admin/overview') });
  const [, setParams] = useSearchParams();
  return (
    <QueryState q={q}>
      {(o) => (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {o.waiting > 0 && (
            <Alert
              type="info"
              showIcon
              message={`${o.waiting} bukti transfer menunggu konfirmasi`}
              action={
                <Button size="small" type="primary" onClick={() => setParams({ tab: 'payments' })}>
                  Periksa
                </Button>
              }
            />
          )}
          {(!o.smtp || !o.gateway) && (
            <Alert
              type="warning"
              showIcon
              message="Kelengkapan layanan"
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {!o.smtp && (
                    <li>
                      Email belum aktif — isi SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM di file .env server agar reset
                      sandi, verifikasi & tagihan terkirim.
                    </li>
                  )}
                  {!o.gateway && (
                    <li>
                      Pembayaran online belum aktif — pelanggan membayar lewat transfer manual (isi rekening di tab
                      Pengaturan). Isi MIDTRANS_SERVER_KEY atau XENDIT_SECRET_KEY untuk VA/QRIS otomatis.
                    </li>
                  )}
                </ul>
              }
            />
          )}
          <Row gutter={[16, 16]}>
            {[
              { t: 'Pendapatan berulang / bulan (MRR)', v: fmtMoney(o.mrr) },
              { t: 'Diterima bulan ini', v: fmtMoney(o.paid_month) },
              { t: 'Pelanggan berbayar aktif', v: o.active },
              { t: 'Sedang uji coba', v: o.trial },
              { t: 'Kedaluwarsa', v: o.expired },
              { t: 'Ditangguhkan / berhenti', v: o.suspended },
              { t: 'Total perusahaan', v: o.tenants },
              { t: 'Daftar 30 hari terakhir', v: o.new30 },
            ].map((s) => (
              <Col xs={12} md={6} key={s.t}>
                <Card size="small">
                  <Statistic title={s.t} value={s.v} />
                </Card>
              </Col>
            ))}
          </Row>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Card title="Pendaftar per bulan" size="small">
                <Bars rows={o.signups} value={(r: { n: number }) => r.n} fmt={(n) => String(n)} />
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card title="Pendapatan per bulan" size="small">
                <Bars rows={o.revenue} value={(r: { amount: string }) => Number(r.amount)} fmt={(n) => fmtMoney(n)} />
              </Card>
            </Col>
          </Row>
          <Typography.Text type="secondary">
            Akun pemilik layanan: {o.admins.join(', ') || '—'} (diatur lewat PLATFORM_ADMIN_EMAILS di file .env server).{' '}
            {o.internal} perusahaan berstatus internal/tanpa batas waktu.
          </Typography.Text>
        </Space>
      )}
    </QueryState>
  );
}

// ---------------- Perusahaan ----------------
function TenantsTab() {
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('ALL');
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: [...KEYS, 'tenants', search],
    queryFn: () => get<TenantRow[]>(`/platform-admin/tenants${qs({ q: search })}`),
  });
  const rows = (q.data ?? []).filter((r) => status === 'ALL' || r.state === status);
  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search
          placeholder="Cari nama perusahaan / email"
          allowClear
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onSearch={setSearch}
          style={{ width: 300 }}
          enterButton={<SearchOutlined />}
        />
        <Segmented
          value={status}
          onChange={(v) => setStatus(String(v))}
          options={[
            { value: 'ALL', label: 'Semua' },
            ...(['TRIAL', 'ACTIVE', 'OVERDUE', 'EXPIRED', 'SUSPENDED'] as SubscriptionStatus[]).map((s) => ({
              value: s,
              label: SUBSCRIPTION_STATUS_LABELS[s],
            })),
          ]}
        />
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={q.isLoading}
        dataSource={rows}
        scroll={{ x: 1100 }}
        pagination={{ pageSize: 50, showSizeChanger: false }}
        onRow={(r) => ({ onClick: () => setOpen(r.id), style: { cursor: 'pointer' } })}
        columns={[
          {
            title: 'Perusahaan',
            render: (_, r) => (
              <div>
                <Typography.Text strong>{r.name}</Typography.Text>
                {r.waiting > 0 && (
                  <Tag color="blue" style={{ marginLeft: 6 }}>
                    bukti transfer
                  </Tag>
                )}
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {r.owner_name} · {r.owner_email}{' '}
                  {r.owner_verified === false && <Tag style={{ fontSize: 11 }}>email belum verifikasi</Tag>}
                </div>
              </div>
            ),
          },
          { title: 'Paket', dataIndex: 'plan_name', render: (v) => v ?? '—' },
          {
            title: 'Status',
            dataIndex: 'state',
            render: (s: SubscriptionStatus, r) => (
              <Tag color={SUB_COLOR[s]}>{r.status ? SUBSCRIPTION_STATUS_LABELS[s] : 'Tanpa langganan'}</Tag>
            ),
          },
          {
            title: 'Berakhir',
            render: (_, r) =>
              r.endsAt ? `${fmtDate(r.endsAt)}${r.daysLeft ? ` (${r.daysLeft} hr)` : ''}` : 'Tanpa batas',
          },
          { title: 'Pengguna', dataIndex: 'users', align: 'right' },
          { title: t('Faktur dibuat'), dataIndex: 'sales_invoices', align: 'right' },
          {
            title: 'Login terakhir',
            dataIndex: 'last_login',
            render: (v) => (v ? dayjs(v).format('DD MMM YYYY HH:mm') : '-'),
          },
          { title: 'Daftar', dataIndex: 'created_at', render: fmtDate },
        ]}
      />
      <TenantDrawer id={open} onClose={() => setOpen(null)} />
    </>
  );
}

interface TenantDetail {
  tenant: { id: string; name: string; npwp: string | null; address: string | null; createdAt: string };
  subscription: {
    planId: string;
    status: string;
    cycle: 'MONTHLY' | 'YEARLY';
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    notes: string;
  } | null;
  state: { status: SubscriptionStatus; endsAt: string | null; daysLeft: number | null; plan: { name: string } | null };
  usage: { users: number; warehouses: number };
  users: {
    id: string;
    name: string;
    email: string;
    role: keyof typeof ROLE_LABELS;
    isActive: boolean;
    lastLoginAt: string | null;
    emailVerifiedAt: string | null;
  }[];
  invoices: {
    id: string;
    number: string;
    amount: string;
    status: BillingInvoiceStatus;
    planName: string;
    cycle: string;
    paidAt: string | null;
    createdAt: string;
  }[];
}

function TenantDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: [...KEYS, 'tenant', id],
    queryFn: () => get<TenantDetail>(`/platform-admin/tenants/${id}`),
    enabled: !!id,
  });
  const plans = useQuery({ queryKey: [...KEYS, 'plans'], queryFn: () => get<Plan[]>('/platform-admin/plans') });
  const [form] = Form.useForm();
  const save = useAction((v: Record<string, unknown>) => patch(`/platform-admin/tenants/${id}/subscription`, v), {
    success: 'Langganan diperbarui',
    invalidate: KEYS,
  });
  const d = q.data;
  return (
    <Drawer open={!!id} onClose={onClose} width={720} title={d?.tenant.name ?? 'Perusahaan'} destroyOnHidden>
      <QueryState q={q}>
        {(d) => (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="Status">
                <Tag color={SUB_COLOR[d.state.status]}>{SUBSCRIPTION_STATUS_LABELS[d.state.status]}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Paket">{d.state.plan?.name ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Berakhir">
                {d.state.endsAt ? fmtDate(d.state.endsAt) : 'Tanpa batas'}
              </Descriptions.Item>
              <Descriptions.Item label="Terdaftar">{fmtDate(d.tenant.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="Pengguna aktif">{d.usage.users}</Descriptions.Item>
              <Descriptions.Item label={t('Gudang')}>{d.usage.warehouses}</Descriptions.Item>
              <Descriptions.Item label="NPWP" span={2}>
                {d.tenant.npwp || '-'}
              </Descriptions.Item>
            </Descriptions>

            <Card size="small" title="Atur langganan">
              <Form
                form={form}
                layout="vertical"
                key={d.tenant.id + (d.subscription?.status ?? '')}
                initialValues={{
                  planId: d.subscription?.planId,
                  status: d.subscription?.status ?? 'ACTIVE',
                  cycle: d.subscription?.cycle ?? 'MONTHLY',
                  end:
                    d.subscription?.status === 'TRIAL'
                      ? d.subscription.trialEndsAt
                        ? dayjs(d.subscription.trialEndsAt)
                        : null
                      : d.subscription?.currentPeriodEnd
                        ? dayjs(d.subscription.currentPeriodEnd)
                        : null,
                  notes: d.subscription?.notes ?? '',
                }}
                onFinish={(v: {
                  planId: string;
                  status: string;
                  cycle: string;
                  end: dayjs.Dayjs | null;
                  extendDays?: number;
                  notes: string;
                }) => {
                  const body: Record<string, unknown> = {
                    planId: v.planId,
                    status: v.status,
                    cycle: v.cycle,
                    notes: v.notes,
                  };
                  if (v.status === 'TRIAL') {
                    if (v.end) body.trialEndsAt = v.end.endOf('day').toISOString();
                  } else body.currentPeriodEnd = v.end ? v.end.endOf('day').toISOString() : null;
                  if (v.extendDays) body.extendDays = v.extendDays;
                  save.mutate(body, { onSuccess: () => form.setFieldValue('extendDays', undefined) });
                }}
              >
                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item name="planId" label="Paket">
                      <Select
                        options={(plans.data ?? []).map((p) => ({
                          value: p.id,
                          label: `${p.name}${p.isActive ? '' : ' (nonaktif)'}`,
                        }))}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="status" label="Status">
                      <Select
                        options={[
                          { value: 'TRIAL', label: 'Uji coba' },
                          { value: 'ACTIVE', label: 'Aktif' },
                          { value: 'SUSPENDED', label: 'Ditangguhkan' },
                          { value: 'CANCELLED', label: 'Dihentikan' },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="cycle" label="Siklus tagihan">
                      <Select
                        options={[
                          { value: 'MONTHLY', label: 'Bulanan' },
                          { value: 'YEARLY', label: 'Tahunan' },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="end" label="Berakhir pada" extra="Kosong (status Aktif) = tanpa batas waktu">
                      <DatePicker style={{ width: '100%' }} format="DD MMM YYYY" allowClear />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="extendDays" label="Tambah hari (opsional)">
                      <InputNumber min={1} max={3660} style={{ width: '100%' }} placeholder="mis. 7" />
                    </Form.Item>
                  </Col>
                  <Col span={24}>
                    <Form.Item name="notes" label="Catatan internal">
                      <Input.TextArea rows={2} maxLength={1000} />
                    </Form.Item>
                  </Col>
                </Row>
                <Button type="primary" htmlType="submit" loading={save.isPending}>
                  Simpan
                </Button>
              </Form>
            </Card>

            <Card size="small" title="Pengguna">
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={d.users}
                columns={[
                  { title: 'Nama', dataIndex: 'name' },
                  {
                    title: 'Email',
                    dataIndex: 'email',
                    render: (v, u) => (
                      <>
                        {v} {!u.emailVerifiedAt && <Tag>belum verifikasi</Tag>}
                      </>
                    ),
                  },
                  { title: 'Peran', dataIndex: 'role', render: (r: keyof typeof ROLE_LABELS) => ROLE_LABELS[r] },
                  { title: 'Aktif', dataIndex: 'isActive', render: (v) => (v ? 'Ya' : 'Tidak') },
                  {
                    title: 'Login terakhir',
                    dataIndex: 'lastLoginAt',
                    render: (v) => (v ? dayjs(v).format('DD MMM YY HH:mm') : '-'),
                  },
                ]}
              />
            </Card>
            <Card size="small" title="Tagihan">
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={d.invoices}
                columns={[
                  { title: 'Nomor', dataIndex: 'number' },
                  {
                    title: 'Paket',
                    render: (_, i) => `${i.planName} · ${i.cycle === 'YEARLY' ? 'tahunan' : 'bulanan'}`,
                  },
                  { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: fmtMoney },
                  {
                    title: 'Status',
                    dataIndex: 'status',
                    render: (s: BillingInvoiceStatus) => <Tag color={INV_COLOR[s]}>{BILLING_STATUS_LABELS[s]}</Tag>,
                  },
                  { title: 'Lunas', dataIndex: 'paidAt', render: (v) => (v ? fmtDate(v) : '-') },
                ]}
              />
            </Card>
          </Space>
        )}
      </QueryState>
    </Drawer>
  );
}

// ---------------- Pembayaran ----------------
function PaymentsTab() {
  const { modal } = App.useApp();
  const [status, setStatus] = useState<string>('WAITING');
  const [proof, setProof] = useState<{ inv: PInvoice; data: string } | null>(null);
  const [rejecting, setRejecting] = useState<PInvoice | null>(null);
  const [reason, setReason] = useState('');
  const [doc, setDoc] = useState<string | null>(null);
  const q = useQuery({
    queryKey: [...KEYS, 'invoices', status],
    queryFn: () => get<PInvoice[]>(`/platform-admin/invoices${qs({ status })}`),
  });
  const confirm = useAction((id: string) => post(`/platform-admin/invoices/${id}/confirm`), {
    success: 'Pembayaran dikonfirmasi — langganan pelanggan sudah aktif',
    invalidate: KEYS,
    onSuccess: () => setProof(null),
  });
  const reject = useAction(
    (v: { id: string; reason: string }) => post(`/platform-admin/invoices/${v.id}/reject`, { reason: v.reason }),
    {
      success: 'Bukti ditolak, pelanggan diberi tahu lewat email',
      invalidate: KEYS,
      onSuccess: () => {
        setRejecting(null);
        setProof(null);
        setReason('');
      },
    },
  );
  const openProof = async (inv: PInvoice) =>
    setProof({ inv, data: (await get<{ proof: string }>(`/platform-admin/invoices/${inv.id}/proof`)).proof });
  const askConfirm = (inv: PInvoice) =>
    modal.confirm({
      title: `Konfirmasi pembayaran ${inv.number}?`,
      content: `Pastikan dana ${fmtMoney(inv.amount)} dari ${inv.tenantName} sudah masuk ke rekening. Langganan langsung diperpanjang.`,
      okText: 'Ya, sudah masuk',
      cancelText: 'Batal',
      onOk: () => confirm.mutateAsync(inv.id),
    });
  return (
    <>
      <Space style={{ marginBottom: 12 }} wrap>
        <Segmented
          value={status}
          onChange={(v) => setStatus(String(v))}
          options={[
            { value: 'WAITING', label: 'Menunggu konfirmasi' },
            { value: 'UNPAID', label: 'Belum dibayar' },
            { value: 'PAID', label: 'Lunas' },
            { value: 'ALL', label: 'Semua' },
          ]}
        />
        <Button icon={<ReloadOutlined />} onClick={() => q.refetch()} />
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={q.isLoading}
        dataSource={q.data}
        scroll={{ x: 1000 }}
        columns={[
          { title: 'Nomor', dataIndex: 'number' },
          { title: 'Perusahaan', dataIndex: 'tenantName' },
          { title: 'Paket', render: (_, i) => `${i.planName} · ${i.cycle === 'YEARLY' ? 'tahunan' : 'bulanan'}` },
          { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: fmtMoney },
          { title: 'Cara', dataIndex: 'method', render: (m) => (m === 'MANUAL' ? 'Transfer' : m) },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (s: BillingInvoiceStatus, i) => (
              <>
                <Tag color={INV_COLOR[s]}>{BILLING_STATUS_LABELS[s]}</Tag>
                {i.confirmedBy && s === 'PAID' && (
                  <div style={{ fontSize: 11, color: '#6b7280' }}>oleh {i.confirmedBy}</div>
                )}
              </>
            ),
          },
          { title: 'Dibuat', dataIndex: 'createdAt', render: fmtDate },
          {
            title: '',
            align: 'right',
            render: (_, i) => (
              <Space>
                <Button size="small" icon={<FileTextOutlined />} onClick={() => setDoc(i.id)} aria-label="Invoice" />
                {i.hasProof && (
                  <Button size="small" icon={<EyeOutlined />} onClick={() => void openProof(i)}>
                    Bukti
                  </Button>
                )}
                {(i.status === 'WAITING' || i.status === 'UNPAID') && (
                  <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => askConfirm(i)}>
                    Konfirmasi
                  </Button>
                )}
                {i.status === 'WAITING' && (
                  <Button size="small" danger icon={<CloseOutlined />} onClick={() => setRejecting(i)}>
                    Tolak
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Modal
        open={!!proof}
        onCancel={() => setProof(null)}
        title={
          proof ? `Bukti transfer ${proof.inv.number} · ${proof.inv.tenantName} · ${fmtMoney(proof.inv.amount)}` : ''
        }
        width={720}
        footer={
          proof && (proof.inv.status === 'WAITING' || proof.inv.status === 'UNPAID') ? (
            <Space>
              <Button danger onClick={() => setRejecting(proof.inv)}>
                Tolak
              </Button>
              <Button type="primary" onClick={() => askConfirm(proof.inv)}>
                Konfirmasi lunas
              </Button>
            </Space>
          ) : null
        }
      >
        {proof?.inv.proofNote && (
          <Alert type="info" message={`Catatan pelanggan: ${proof.inv.proofNote}`} style={{ marginBottom: 12 }} />
        )}
        {proof?.data.startsWith('data:application/pdf') ? (
          <a href={proof.data} download={`bukti-${proof.inv.number.replace(/\//g, '-')}.pdf`}>
            Unduh bukti (PDF)
          </a>
        ) : (
          proof && (
            <img
              src={proof.data}
              alt="Bukti transfer"
              style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #e3e8f0' }}
            />
          )
        )}
      </Modal>
      <Modal
        open={!!rejecting}
        title={`Tolak bukti ${rejecting?.number ?? ''}`}
        okText={t('Tolak & beri tahu pelanggan')}
        okButtonProps={{ danger: true, disabled: !reason.trim(), loading: reject.isPending }}
        onOk={() => rejecting && reject.mutate({ id: rejecting.id, reason })}
        onCancel={() => setRejecting(null)}
      >
        <Input.TextArea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Alasan, mis. nominal kurang Rp10.000 / foto tidak terbaca"
          maxLength={300}
        />
      </Modal>
      <BillingInvoiceModal id={doc} admin onClose={() => setDoc(null)} />
    </>
  );
}

// ---------------- Paket ----------------
function PlansTab() {
  const q = useQuery({ queryKey: [...KEYS, 'plans'], queryFn: () => get<Plan[]>('/platform-admin/plans') });
  const [editing, setEditing] = useState<Partial<Plan> | null>(null);
  const [form] = Form.useForm();
  const save = useAction(
    (v: Partial<Plan>) => {
      const body = {
        ...v,
        priceMonthly: String(v.priceMonthly),
        priceYearly: String(v.priceYearly),
        maxUsers: v.maxUsers ?? null,
        maxWarehouses: v.maxWarehouses ?? null,
      };
      return editing?.id ? patch(`/platform-admin/plans/${editing.id}`, body) : post('/platform-admin/plans', body);
    },
    { success: 'Paket disimpan', invalidate: KEYS, onSuccess: () => setEditing(null) },
  );
  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setEditing({ isActive: true, sortOrder: (q.data?.length ?? 0) + 1 })}
        >
          Paket baru
        </Button>
        <Typography.Text type="secondary">
          Perubahan harga berlaku untuk tagihan berikutnya; tagihan yang sudah dibuat tidak berubah.
        </Typography.Text>
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={q.isLoading}
        dataSource={q.data}
        pagination={false}
        scroll={{ x: 900 }}
        onRow={(p) => ({ onClick: () => setEditing(p), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'Kode', dataIndex: 'code' },
          { title: 'Nama', dataIndex: 'name' },
          { title: 'Bulanan', dataIndex: 'priceMonthly', align: 'right', render: fmtMoney },
          { title: 'Tahunan', dataIndex: 'priceYearly', align: 'right', render: fmtMoney },
          { title: 'Maks. pengguna', dataIndex: 'maxUsers', render: (v) => v ?? 'Tanpa batas' },
          { title: t('Maks. gudang'), dataIndex: 'maxWarehouses', render: (v) => v ?? 'Tanpa batas' },
          {
            title: 'Dijual',
            dataIndex: 'isActive',
            render: (v) => (v ? <Tag color="green">Ya</Tag> : <Tag>Tidak</Tag>),
          },
        ]}
      />
      <Modal
        open={!!editing}
        title={editing?.id ? `Ubah paket ${editing.name}` : 'Paket baru'}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        okText="Simpan"
        confirmLoading={save.isPending}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          preserve={false}
          initialValues={{
            ...editing,
            priceMonthly: editing?.priceMonthly ? Number(editing.priceMonthly) : undefined,
            priceYearly: editing?.priceYearly ? Number(editing.priceYearly) : undefined,
          }}
          onFinish={(v) => save.mutate(v)}
        >
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item
                name="code"
                label="Kode"
                rules={[{ required: true }, { pattern: /^[A-Z0-9_-]+$/, message: 'Huruf besar/angka' }]}
              >
                <Input disabled={!!editing?.id} />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name="name" label="Nama" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="description" label="Keterangan singkat">
                <Input maxLength={300} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="priceMonthly" label="Harga per bulan" rules={[{ required: true }]}>
                <InputNumber<number>
                  min={0}
                  style={{ width: '100%' }}
                  formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
                  parser={(v) => Number((v ?? '').replace(/\./g, ''))}
                  prefix="Rp"
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="priceYearly" label="Harga per tahun" rules={[{ required: true }]}>
                <InputNumber<number>
                  min={0}
                  style={{ width: '100%' }}
                  formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
                  parser={(v) => Number((v ?? '').replace(/\./g, ''))}
                  prefix="Rp"
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="maxUsers" label="Maks. pengguna aktif" extra="Kosong = tanpa batas">
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="maxWarehouses" label={t('Maks. gudang')} extra="Kosong = tanpa batas">
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="sortOrder" label="Urutan tampil">
                <InputNumber style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="isActive" label="Dijual" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </>
  );
}

// ---------------- Pengaturan ----------------
interface PSettings {
  bankName: string;
  bankAccount: string;
  bankHolder: string;
  trialDays: number;
  graceDays: number;
  trialPlanCode: string;
  supportWhatsapp: string;
  renewalNoticeDays: number;
  sellerName: string;
  sellerNpwp: string;
  sellerAddress: string;
  vatEnabled: boolean;
  vatRate: number;
  smtp: { configured: boolean; from: string };
  gateway: string | null;
  admins: string[];
}
function SettingsTab() {
  const { me } = useAuth();
  const q = useQuery({ queryKey: [...KEYS, 'settings'], queryFn: () => get<PSettings>('/platform-admin/settings') });
  const plans = useQuery({ queryKey: [...KEYS, 'plans'], queryFn: () => get<Plan[]>('/platform-admin/plans') });
  const save = useAction((v: Partial<PSettings>) => put('/platform-admin/settings', v), {
    success: 'Pengaturan disimpan',
    invalidate: KEYS,
  });
  const [to, setTo] = useState(me?.email ?? '');
  const test = useAction(() => post('/platform-admin/test-email', { to }), { success: `Email uji terkirim ke ${to}` });
  const reminders = useAction(() => post<{ checked: number; sent: number }>('/platform-admin/run-reminders'), {
    success: (r) => `${r.checked} langganan diperiksa, ${r.sent} pengingat dikirim`,
  });
  return (
    <QueryState q={q}>
      {(s) => (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={14}>
            <Card title="Pembayaran & uji coba">
              <Form
                layout="vertical"
                initialValues={s}
                onFinish={(v: Partial<PSettings>) =>
                  save.mutate({
                    ...v,
                    trialDays: Number(v.trialDays),
                    graceDays: Number(v.graceDays),
                    renewalNoticeDays: Number(v.renewalNoticeDays),
                    vatRate: Number(v.vatRate ?? 11),
                    vatEnabled: !!v.vatEnabled,
                  })
                }
              >
                <Typography.Text strong>Rekening untuk transfer manual</Typography.Text>
                <Row gutter={12} style={{ marginTop: 8 }}>
                  <Col xs={24} md={8}>
                    <Form.Item name="bankName" label="Bank">
                      <Input placeholder="BCA" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name="bankAccount" label="No. rekening">
                      <Input placeholder="1234567890" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name="bankHolder" label="Atas nama">
                      <Input placeholder="PT SANSU ..." />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name="supportWhatsapp" label="WhatsApp dukungan">
                      <Input placeholder="0812..." />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={8}>
                    <Form.Item name="trialDays" label="Lama uji coba (hari)">
                      <InputNumber min={0} max={90} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={8}>
                    <Form.Item name="trialPlanCode" label="Paket saat uji coba">
                      <Select options={(plans.data ?? []).map((p) => ({ value: p.code, label: p.name }))} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={8}>
                    <Form.Item name="graceDays" label="Masa tenggang (hari)" extra="Setelah habis, sebelum baca saja">
                      <InputNumber min={0} max={30} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={8}>
                    <Form.Item
                      name="renewalNoticeDays"
                      label="Tagihan perpanjangan dibuat"
                      extra="Hari sebelum berakhir"
                    >
                      <InputNumber min={1} max={30} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>
                <Typography.Text strong>Penjual & PPN (tampil di invoice langganan)</Typography.Text>
                <Row gutter={12} style={{ marginTop: 8 }}>
                  <Col xs={24} md={12}>
                    <Form.Item name="sellerName" label="Nama badan usaha">
                      <Input placeholder="PT SANSU GLOBAL INTI" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="sellerNpwp" label="NPWP">
                      <Input placeholder="0000 0000 0000 0000" />
                    </Form.Item>
                  </Col>
                  <Col xs={24}>
                    <Form.Item name="sellerAddress" label="Alamat">
                      <Input.TextArea rows={2} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={8}>
                    <Form.Item name="vatEnabled" label="Kenakan PPN (PKP)" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={8}>
                    <Form.Item name="vatRate" label="Tarif PPN efektif (%)" extra="12% × DPP 11/12 = 11%">
                      <InputNumber min={0} max={20} step={0.5} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col xs={24}>
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 16 }}
                      message="PPN hanya dikenakan pada tagihan baru. Harga paket = DPP; PPN ditambahkan di atasnya. Rekap bulanan ada di tab Laporan PPN."
                    />
                  </Col>
                </Row>
                <Button type="primary" htmlType="submit" loading={save.isPending}>
                  Simpan
                </Button>
              </Form>
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Card title="Email (SMTP)">
                {s.smtp.configured ? (
                  <Tag color="green">Aktif · pengirim {s.smtp.from}</Tag>
                ) : (
                  <Tag color="orange">Belum diatur</Tag>
                )}
                <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
                  Diatur di file .env server: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, APP_URL. Contoh
                  gratis: Brevo (300 email/hari).
                </Typography.Paragraph>
                <Space.Compact style={{ width: '100%' }}>
                  <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="email@anda.com" />
                  <Button icon={<MailOutlined />} loading={test.isPending} onClick={() => test.mutate(undefined)}>
                    Kirim email uji
                  </Button>
                </Space.Compact>
              </Card>
              <Card title="Pembayaran online">
                {s.gateway ? (
                  <Tag color="green">{s.gateway} aktif</Tag>
                ) : (
                  <Tag color="orange">Belum aktif — transfer manual</Tag>
                )}
                <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                  Midtrans: MIDTRANS_SERVER_KEY (+ MIDTRANS_PRODUCTION=true). URL notifikasi:{' '}
                  <Typography.Text code>{window.location.origin}/api/billing/webhooks/midtrans</Typography.Text>
                  <br />
                  Xendit: XENDIT_SECRET_KEY + XENDIT_CALLBACK_TOKEN. URL callback:{' '}
                  <Typography.Text code>{window.location.origin}/api/billing/webhooks/xendit</Typography.Text>
                </Typography.Paragraph>
              </Card>
              <Card title="Pengingat otomatis">
                <Typography.Paragraph type="secondary">
                  Setiap jam SANSU mengirim pengingat uji coba (3 hari sebelum & saat berakhir) dan membuat tagihan
                  perpanjangan otomatis.
                </Typography.Paragraph>
                <Button loading={reminders.isPending} onClick={() => reminders.mutate(undefined)}>
                  Jalankan sekarang
                </Button>
              </Card>
            </Space>
          </Col>
        </Row>
      )}
    </QueryState>
  );
}

// ---------------- Laporan PPN ----------------
function VatTab() {
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const q = useQuery({
    queryKey: [...KEYS, 'vat', month],
    queryFn: () => get<VatReportRow[]>(`/platform-admin/vat-report${qs({ month })}`),
  });
  const settings = useQuery({
    queryKey: [...KEYS, 'settings'],
    queryFn: () => get<PSettings>('/platform-admin/settings'),
  });
  const rows = q.data ?? [];
  const sum = (k: 'subtotal' | 'vatAmount' | 'amount') => rows.reduce((a, r) => a + Number(r[k]), 0);
  return (
    <Card
      title="Rekap PPN keluaran langganan"
      extra={
        <Space wrap>
          <DatePicker
            picker="month"
            value={dayjs(`${month}-01`)}
            onChange={(v) => v && setMonth(v.format('YYYY-MM'))}
            allowClear={false}
            format="MMMM YYYY"
          />
          <ExportButtons
            filename={`ppn-langganan-${month}`}
            title={`PPN langganan ${month}`}
            sheets={() => (q.data ? subscriptionVatSheet(q.data, month, settings.data?.sellerName) : null)}
          />
        </Space>
      }
    >
      {settings.data && !settings.data.vatEnabled && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="PPN belum diaktifkan di tab Pengaturan — tagihan baru belum dikenai PPN."
        />
      )}
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col xs={8}>
          <Statistic title="DPP" value={fmtMoney(sum('subtotal'))} />
        </Col>
        <Col xs={8}>
          <Statistic
            title="PPN keluaran"
            value={fmtMoney(sum('vatAmount'))}
            valueStyle={{ color: BRAND.colors.primary }}
          />
        </Col>
        <Col xs={8}>
          <Statistic title="Total diterima" value={fmtMoney(sum('amount'))} />
        </Col>
      </Row>
      <Table
        rowKey="id"
        size="small"
        loading={q.isLoading}
        dataSource={rows}
        scroll={{ x: 900 }}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        columns={[
          { title: 'Nomor', dataIndex: 'number' },
          { title: 'Lunas', dataIndex: 'paidAt', render: fmtDate },
          { title: 'Pembeli', dataIndex: 'buyer' },
          {
            title: 'NPWP',
            dataIndex: 'buyerNpwp',
            render: (v) => v || <Typography.Text type="secondary">—</Typography.Text>,
          },
          { title: 'DPP', dataIndex: 'subtotal', align: 'right', render: fmtMoney },
          {
            title: 'PPN',
            dataIndex: 'vatAmount',
            align: 'right',
            render: (v, r) => (r.vatRate ? `${fmtMoney(v)} (${Number(r.vatRate)}%)` : '—'),
          },
          { title: 'Total', dataIndex: 'amount', align: 'right', render: fmtMoney },
        ]}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
        Gunakan rekap ini untuk membuat faktur pajak keluaran di Coretax DJP. Pembeli tanpa NPWP memakai NIK / kode
        pembeli umum sesuai ketentuan.
      </Typography.Paragraph>
    </Card>
  );
}

// ---------------- Sistem ----------------
interface SystemStatus {
  version: string;
  node: string;
  uptimeSec: number;
  startedAt: string;
  memory: { rssMb: number; heapMb: number };
  db: { latencyMs: number; sizeMb: number; version?: string };
  errors: {
    last24h: number;
    last7d: number;
    top: { path: string; message: string; n: number; last: string }[];
    recent: {
      id: string;
      at: string;
      status: number;
      method: string;
      path: string;
      message: string;
      stack: string | null;
      tenantId: string | null;
    }[];
  };
  alerts: { telegram: boolean };
  backup: { configured: boolean; file?: string; at?: string; sizeMb?: number; count?: number };
}
const dur = (s: number) => {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d} hari ${h} jam` : h ? `${h} jam ${m} menit` : `${m} menit`;
};

function SystemTab() {
  const q = useQuery({
    queryKey: [...KEYS, 'system'],
    queryFn: () => get<SystemStatus>('/platform-admin/system'),
    refetchInterval: 30_000,
  });
  const testAlert = useAction(() => post('/platform-admin/test-alert'), { success: 'Pesan uji terkirim ke Telegram' });
  return (
    <QueryState q={q}>
      {(s) => {
        const backupAgeH = s.backup.at ? dayjs().diff(dayjs(s.backup.at), 'hour') : null;
        const backupOk = backupAgeH != null && backupAgeH <= 26;
        return (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Row gutter={[16, 16]}>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic title="Server berjalan" value={dur(s.uptimeSec)} valueStyle={{ fontSize: 18 }} />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    versi {s.version} · sejak {dayjs(s.startedAt).format('DD/MM HH:mm')}
                  </Typography.Text>
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic
                    title="Database"
                    value={`${s.db.latencyMs} ms`}
                    valueStyle={{ fontSize: 18, color: s.db.latencyMs > 200 ? '#d97706' : undefined }}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    ukuran {s.db.sizeMb} MB · PostgreSQL {s.db.version?.split(' ')[0]}
                  </Typography.Text>
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic
                    title="Error 24 jam"
                    value={s.errors.last24h}
                    valueStyle={{ fontSize: 18, color: s.errors.last24h ? '#dc2626' : BRAND.colors.accent }}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    7 hari: {s.errors.last7d} · memori {s.memory.rssMb} MB
                  </Typography.Text>
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic
                    title="Backup terakhir"
                    value={
                      s.backup.at
                        ? dayjs(s.backup.at).format('DD/MM HH:mm')
                        : s.backup.configured
                          ? 'Belum ada'
                          : 'Tidak terpantau'
                    }
                    valueStyle={{
                      fontSize: 18,
                      color: s.backup.configured ? (backupOk ? BRAND.colors.accent : '#dc2626') : '#6b7280',
                    }}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {s.backup.at
                      ? `${s.backup.sizeMb} MB · ${s.backup.count} file tersimpan`
                      : s.backup.configured
                        ? 'Periksa layanan backup'
                        : 'Hanya di server produksi'}
                  </Typography.Text>
                </Card>
              </Col>
            </Row>
            <Card
              size="small"
              title="Peringatan otomatis"
              extra={
                <Button
                  size="small"
                  icon={<SendOutlined />}
                  disabled={!s.alerts.telegram}
                  loading={testAlert.isPending}
                  onClick={() => testAlert.mutate(undefined)}
                >
                  Kirim pesan uji
                </Button>
              }
            >
              <Space wrap>
                <Badge
                  status={s.alerts.telegram ? 'success' : 'warning'}
                  text={s.alerts.telegram ? 'Telegram aktif' : 'Telegram belum diatur'}
                />
              </Space>
              <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                Server mengirim pesan bila terjadi error, aplikasi tidak bisa diakses, disk hampir penuh, atau backup
                gagal. Atur TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID di file .env server (lihat docs/PANDUAN-SERVER.md).
                Tanpa Telegram, peringatan error dikirim lewat email ke admin layanan.
              </Typography.Paragraph>
            </Card>
            {s.errors.top.length > 0 && (
              <Card size="small" title="Error terbanyak (7 hari)">
                {s.errors.top.map((e) => (
                  <div
                    key={e.path + e.message}
                    style={{
                      display: 'flex',
                      gap: 12,
                      alignItems: 'center',
                      padding: '6px 0',
                      borderBottom: '1px solid #f0f0f0',
                    }}
                  >
                    <Tag color="red">{e.n}×</Tag>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Typography.Text code>{e.path}</Typography.Text>
                      <div style={{ fontSize: 12, color: '#475569' }}>{e.message}</div>
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {dayjs(e.last).format('DD/MM HH:mm')}
                    </Typography.Text>
                  </div>
                ))}
              </Card>
            )}
            <Card
              size="small"
              title="Error terbaru"
              extra={<Button size="small" icon={<ReloadOutlined />} onClick={() => q.refetch()} />}
            >
              {s.errors.recent.length ? (
                <Collapse
                  size="small"
                  items={s.errors.recent.map((e) => ({
                    key: e.id,
                    label: (
                      <span>
                        <Tag color="red">{e.status}</Tag>
                        {dayjs(e.at).format('DD/MM HH:mm:ss')} ·{' '}
                        <Typography.Text code>{`${e.method} ${e.path}`}</Typography.Text> — {e.message}
                      </span>
                    ),
                    children: (
                      <pre
                        style={{ fontSize: 11, whiteSpace: 'pre-wrap', margin: 0, maxHeight: 280, overflow: 'auto' }}
                      >
                        {e.stack ?? e.message}
                      </pre>
                    ),
                  }))}
                />
              ) : (
                <Typography.Text type="secondary">Tidak ada error tercatat.</Typography.Text>
              )}
            </Card>
          </Space>
        );
      }}
    </QueryState>
  );
}
