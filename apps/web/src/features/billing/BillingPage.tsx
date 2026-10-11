import {
  CheckOutlined,
  CopyOutlined,
  CreditCardOutlined,
  FileTextOutlined,
  UploadOutlined,
  WhatsAppOutlined,
} from '@ant-design/icons';
import {
  BILLING_STATUS_LABELS,
  BRAND,
  SUBSCRIPTION_STATUS_LABELS,
  type BillingInvoice,
  type BillingOverview,
  type Plan,
  type SubscriptionStatus,
} from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Input,
  Progress,
  Row,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import QueryState from '@/components/QueryState';
import PageHeader from '@/layout/PageHeader';
import BillingInvoiceModal from './BillingInvoiceDoc';
import { fmtDate, fmtMoney } from '@/lib/format';

export const SUB_COLOR: Record<SubscriptionStatus, string> = {
  TRIAL: 'blue',
  ACTIVE: 'green',
  OVERDUE: 'orange',
  EXPIRED: 'red',
  SUSPENDED: 'red',
  CANCELLED: 'default',
};
const INV_COLOR: Record<BillingInvoice['status'], string> = {
  UNPAID: 'gold',
  WAITING: 'blue',
  PAID: 'green',
  CANCELLED: 'default',
};
const CYCLE = { MONTHLY: 'Bulanan', YEARLY: 'Tahunan' } as const;

const readFile = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error('File tidak bisa dibaca'));
    r.readAsDataURL(f);
  });

export default function BillingPage() {
  const { me } = useAuth();
  if (me?.subscription.enabled === false) {
    return (
      <>
        <PageHeader title="Langganan SANSU" />
        <Alert type="info" showIcon message="Langganan belum diaktifkan" description="SANSU masih dalam tahap uji, jadi semua fitur bisa dipakai tanpa batas waktu, batas pengguna, atau tagihan. Informasi paket akan muncul di sini saat langganan dibuka." />
      </>
    );
  }
  return <BillingContent />;
}

function BillingContent() {
  const q = useQuery({ queryKey: ['billing'], queryFn: () => get<BillingOverview>('/billing') });
  const [params] = useSearchParams();
  return (
    <>
      <PageHeader title="Langganan SANSU" />
      {params.get('paid') && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Terima kasih. Status pembayaran diperbarui otomatis begitu gerbang pembayaran mengonfirmasi (biasanya beberapa detik)."
        />
      )}
      <QueryState q={q}>{(d) => <Billing d={d} />}</QueryState>
    </>
  );
}

function Billing({ d }: { d: BillingOverview }) {
  const s = d.subscription;
  const open = d.invoices.find((i) => i.status === 'UNPAID' || i.status === 'WAITING');
  const [doc, setDoc] = useState<string | null>(null);
  const anyVat = d.invoices.some((i) => Number(i.vatAmount) > 0);
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <StatusCard d={d} />
      {open && <OpenInvoice inv={open} payment={d.payment} />}
      <Plans plans={d.plans} current={s.plan?.id} currentCycle={s.cycle} usage={d.usage} hasOpen={!!open} />
      <Card title="Riwayat tagihan">
        <Table
          rowKey="id"
          size="small"
          dataSource={d.invoices}
          pagination={false}
          scroll={{ x: 760 }}
          locale={{ emptyText: <Empty description="Belum ada tagihan" /> }}
          columns={[
            { title: 'Nomor', dataIndex: 'number' },
            { title: 'Tanggal', dataIndex: 'createdAt', render: fmtDate },
            { title: 'Paket', render: (_, i) => `${i.planName} · ${CYCLE[i.cycle]}` },
            ...(anyVat
              ? [
                  { title: 'DPP', dataIndex: 'subtotal', align: 'right' as const, render: fmtMoney },
                  { title: 'PPN', dataIndex: 'vatAmount', align: 'right' as const, render: fmtMoney },
                ]
              : []),
            { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: fmtMoney },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (v: BillingInvoice['status']) => <Tag color={INV_COLOR[v]}>{BILLING_STATUS_LABELS[v]}</Tag>,
            },
            {
              title: 'Masa aktif',
              render: (_, i) => (i.periodEnd ? `${fmtDate(i.periodStart)} – ${fmtDate(i.periodEnd)}` : '-'),
            },
            {
              title: '',
              width: 90,
              render: (_, i) =>
                i.status !== 'CANCELLED' && (
                  <Button size="small" icon={<FileTextOutlined />} onClick={() => setDoc(i.id)}>
                    Invoice
                  </Button>
                ),
            },
          ]}
        />
      </Card>
      <BillingInvoiceModal id={doc} onClose={() => setDoc(null)} />
    </Space>
  );
}

function StatusCard({ d }: { d: BillingOverview }) {
  const s = d.subscription;
  const limit = (used: number, max: number | null | undefined, label: string, to: string) => (
    <div style={{ minWidth: 180 }}>
      <Typography.Text type="secondary">{label}</Typography.Text> <Link to={to}>Kelola</Link>
      <div style={{ fontSize: 18, fontWeight: 600 }}>
        {used} <Typography.Text type="secondary">/ {max ?? '∞'}</Typography.Text>
      </div>
      {max != null && (
        <Progress
          percent={Math.min(100, Math.round((used / max) * 100))}
          showInfo={false}
          size="small"
          status={used >= max ? 'exception' : 'normal'}
          strokeColor={BRAND.colors.primary}
        />
      )}
    </div>
  );
  const ends =
    s.status === 'TRIAL'
      ? `Uji coba berakhir ${fmtDate(s.endsAt)} (${s.daysLeft} hari lagi)`
      : s.endsAt
        ? `${s.status === 'ACTIVE' ? 'Aktif sampai' : 'Berakhir'} ${fmtDate(s.endsAt)}${s.status === 'ACTIVE' ? ` (${s.daysLeft} hari lagi)` : ''}`
        : 'Tanpa batas waktu';
  return (
    <Card>
      <Row gutter={[24, 16]} align="middle">
        <Col xs={24} md={10}>
          <Space direction="vertical" size={4}>
            <Typography.Text type="secondary">Paket saat ini</Typography.Text>
            <Space align="center" wrap>
              <Typography.Title level={3} style={{ margin: 0 }}>
                {s.plan?.name ?? '—'}
              </Typography.Title>
              <Tag color={SUB_COLOR[s.status]}>{SUBSCRIPTION_STATUS_LABELS[s.status]}</Tag>
            </Space>
            <Typography.Text>{ends}</Typography.Text>
            {s.status === 'OVERDUE' && (
              <Typography.Text type="warning">
                Masa tenggang sampai {fmtDate(s.graceUntil)}. Segera bayar agar tidak berubah ke mode baca saja.
              </Typography.Text>
            )}
          </Space>
        </Col>
        <Col xs={24} md={14}>
          <Space size={32} wrap>
            {limit(d.usage.users, s.plan?.maxUsers, 'Pengguna aktif', '/settings/users')}
            {limit(d.usage.warehouses, s.plan?.maxWarehouses, 'Gudang aktif', '/warehouses')}
          </Space>
        </Col>
      </Row>
      {s.readOnly && (
        <Alert
          style={{ marginTop: 16 }}
          type="error"
          showIcon
          message="Mode baca saja"
          description="Data tetap aman dan bisa dilihat, dicetak, dan diekspor. Untuk kembali menambah atau mengubah data, pilih paket dan selesaikan pembayaran."
        />
      )}
    </Card>
  );
}

function OpenInvoice({ inv, payment }: { inv: BillingInvoice; payment: BillingOverview['payment'] }) {
  const { message } = App.useApp();
  const [proof, setProof] = useState<{ data: string; name: string }>();
  const [note, setNote] = useState('');
  const pay = useAction(() => post<{ url: string }>(`/billing/invoices/${inv.id}/pay`), {
    onSuccess: (r) => (window.location.href = r.url),
  });
  const send = useAction(
    () => post(`/billing/invoices/${inv.id}/proof`, { proof: proof!.data, note: note || undefined }),
    {
      success: 'Bukti transfer terkirim. Kami akan mengonfirmasi secepatnya.',
      invalidate: ['billing'],
      onSuccess: () => setProof(undefined),
    },
  );
  const cancel = useAction(() => post(`/billing/invoices/${inv.id}/cancel`), {
    success: 'Tagihan dibatalkan',
    invalidate: ['billing'],
  });
  const copy = (s: string) => navigator.clipboard?.writeText(s).then(() => message.success('Disalin'));

  return (
    <Card
      title={
        <Space>
          <CreditCardOutlined />
          Tagihan {inv.number}
          <Tag color={INV_COLOR[inv.status]}>{BILLING_STATUS_LABELS[inv.status]}</Tag>
        </Space>
      }
      extra={
        inv.status === 'UNPAID' && (
          <Button type="link" danger onClick={() => cancel.mutate(undefined)}>
            Batalkan
          </Button>
        )
      }
      styles={{ header: { background: BRAND.colors.primarySoft } }}
    >
      <Row gutter={[24, 16]}>
        <Col xs={24} md={9}>
          <Typography.Text type="secondary">Total dibayar</Typography.Text>
          <div style={{ fontSize: 30, fontWeight: 700, color: BRAND.colors.mark, letterSpacing: '-0.01em' }}>
            {fmtMoney(inv.amount)}
          </div>
          <Typography.Text>
            {inv.planName} · {CYCLE[inv.cycle]} · jatuh tempo {fmtDate(inv.dueDate)}
          </Typography.Text>
          {Number(inv.vatAmount) > 0 && (
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
              DPP {fmtMoney(inv.subtotal)} + PPN {Number(inv.vatRate)}% {fmtMoney(inv.vatAmount)}
            </div>
          )}
        </Col>
        <Col xs={24} md={15}>
          {inv.status === 'WAITING' ? (
            <Alert
              type="info"
              showIcon
              message="Bukti transfer sudah diterima"
              description="Kami sedang memeriksa pembayaran Anda. Langganan aktif otomatis setelah dikonfirmasi, dan Anda akan menerima email."
            />
          ) : (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {inv.rejectReason && (
                <Alert
                  type="warning"
                  showIcon
                  message="Bukti sebelumnya belum bisa diterima"
                  description={inv.rejectReason}
                />
              )}
              {payment.gateway && (
                <Button
                  type="primary"
                  size="large"
                  icon={<CreditCardOutlined />}
                  loading={pay.isPending}
                  onClick={() => pay.mutate(undefined)}
                >
                  Bayar online — Virtual Account, QRIS, e-wallet
                </Button>
              )}
              {payment.bank ? (
                <>
                  <Typography.Text strong>
                    {payment.gateway ? 'Atau transfer manual ke:' : 'Transfer ke rekening:'}
                  </Typography.Text>
                  <Descriptions size="small" column={1} bordered>
                    <Descriptions.Item label="Bank">{payment.bank.name}</Descriptions.Item>
                    <Descriptions.Item label="No. rekening">
                      <Space>
                        <Typography.Text strong copyable={false}>
                          {payment.bank.account}
                        </Typography.Text>
                        <Button size="small" icon={<CopyOutlined />} onClick={() => copy(payment.bank!.account)} />
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="Atas nama">{payment.bank.holder}</Descriptions.Item>
                    <Descriptions.Item label="Jumlah">
                      <Space>
                        <Typography.Text strong>{fmtMoney(inv.amount)}</Typography.Text>
                        <Button
                          size="small"
                          icon={<CopyOutlined />}
                          onClick={() => copy(String(Math.round(Number(inv.amount))))}
                        />
                      </Space>
                    </Descriptions.Item>
                  </Descriptions>
                  <Space wrap>
                    <Upload
                      accept="image/png,image/jpeg,image/webp,application/pdf"
                      showUploadList={false}
                      beforeUpload={async (f) => {
                        if (f.size > 2 * 1024 * 1024) {
                          message.error(
                            'File terlalu besar (maks. 2 MB). Kirim foto/tangkapan layar yang lebih kecil.',
                          );
                          return Upload.LIST_IGNORE;
                        }
                        setProof({ data: await readFile(f), name: f.name });
                        return false;
                      }}
                    >
                      <Button icon={<UploadOutlined />}>{proof ? 'Ganti file' : 'Pilih bukti transfer'}</Button>
                    </Upload>
                    {proof && <Typography.Text type="secondary">{proof.name}</Typography.Text>}
                  </Space>
                  {proof && (
                    <>
                      <Input
                        placeholder="Catatan (mis. transfer dari BCA a.n. Budi)"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={300}
                      />
                      <Button type="primary" loading={send.isPending} onClick={() => send.mutate(undefined)}>
                        Kirim bukti transfer
                      </Button>
                    </>
                  )}
                </>
              ) : (
                !payment.gateway && (
                  <Alert
                    type="info"
                    showIcon
                    message="Instruksi pembayaran segera dikirim"
                    description={
                      payment.supportWhatsapp ? (
                        <a
                          href={`https://wa.me/${payment.supportWhatsapp.replace(/\D/g, '').replace(/^0/, '62')}?text=${encodeURIComponent(`Halo SANSU, saya ingin membayar tagihan ${inv.number}`)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <WhatsAppOutlined /> Hubungi tim SANSU lewat WhatsApp
                        </a>
                      ) : (
                        'Tim SANSU akan menghubungi Anda untuk cara pembayaran.'
                      )
                    }
                  />
                )
              )}
            </Space>
          )}
        </Col>
      </Row>
    </Card>
  );
}

function Plans({
  plans,
  current,
  currentCycle,
  usage,
  hasOpen,
}: {
  plans: Plan[];
  current?: string;
  currentCycle: 'MONTHLY' | 'YEARLY';
  usage: BillingOverview['usage'];
  hasOpen: boolean;
}) {
  const { modal } = App.useApp();
  const [cycle, setCycle] = useState<'MONTHLY' | 'YEARLY'>(currentCycle);
  const create = useAction((v: { planId: string; cycle: string }) => post('/billing/invoices', v), {
    success: 'Tagihan dibuat — silakan lakukan pembayaran',
    invalidate: ['billing'],
  });
  const choose = (p: Plan) => {
    const price = cycle === 'YEARLY' ? p.priceYearly : p.priceMonthly;
    modal.confirm({
      title: `Pilih paket ${p.name} (${CYCLE[cycle].toLowerCase()})?`,
      content: (
        <>
          Tagihan sebesar <b>{fmtMoney(price)}</b> akan dibuat.
          {hasOpen && ' Tagihan lama yang belum dibayar akan dibatalkan.'} Masa aktif dihitung setelah masa aktif/uji
          coba Anda saat ini berakhir.
        </>
      ),
      okText: 'Buat tagihan',
      cancelText: 'Batal',
      onOk: () => create.mutateAsync({ planId: p.id, cycle }),
    });
  };
  return (
    <Card
      title="Pilih paket"
      extra={
        <Segmented
          value={cycle}
          onChange={(v) => setCycle(v as 'MONTHLY' | 'YEARLY')}
          options={[
            { value: 'MONTHLY', label: 'Bulanan' },
            { value: 'YEARLY', label: 'Tahunan · hemat' },
          ]}
        />
      }
    >
      <Row gutter={[16, 16]}>
        {plans.map((p) => {
          const monthly = Number(p.priceMonthly);
          const yearly = Number(p.priceYearly);
          const saving = monthly * 12 - yearly;
          const isCurrent = p.id === current;
          const tooSmall =
            (p.maxUsers != null && usage.users > p.maxUsers) ||
            (p.maxWarehouses != null && usage.warehouses > p.maxWarehouses);
          return (
            <Col xs={24} md={8} key={p.id}>
              <div
                style={{
                  height: '100%',
                  border: `1px solid ${isCurrent ? BRAND.colors.primary : '#e3e8f0'}`,
                  boxShadow: isCurrent ? `0 0 0 3px ${BRAND.colors.primarySoft}` : undefined,
                  borderRadius: 14,
                  padding: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Typography.Title level={4} style={{ margin: 0 }}>
                    {p.name}
                  </Typography.Title>
                  {isCurrent && <Tag color="green">Paket Anda</Tag>}
                </Space>
                <div>
                  <span style={{ fontSize: 26, fontWeight: 700, color: BRAND.colors.mark }}>
                    {fmtMoney(cycle === 'YEARLY' ? yearly : monthly)}
                  </span>
                  <Typography.Text type="secondary"> / {cycle === 'YEARLY' ? 'tahun' : 'bulan'}</Typography.Text>
                  {cycle === 'YEARLY' && saving > 0 && (
                    <div>
                      <Tag color="green" style={{ marginTop: 4 }}>
                        Hemat {fmtMoney(saving)}
                      </Tag>
                    </div>
                  )}
                </div>
                <Typography.Text type="secondary">{p.description}</Typography.Text>
                <Space direction="vertical" size={2}>
                  <span>
                    <CheckOutlined style={{ color: BRAND.colors.accent }} /> {p.maxUsers ?? 'Tanpa batas'} pengguna
                    aktif
                  </span>
                  <span>
                    <CheckOutlined style={{ color: BRAND.colors.accent }} /> {p.maxWarehouses ?? 'Tanpa batas'} gudang
                  </span>
                  <span>
                    <CheckOutlined style={{ color: BRAND.colors.accent }} /> Semua aplikasi SANSU
                  </span>
                </Space>
                <div style={{ flex: 1 }} />
                <Button
                  type={isCurrent ? 'default' : 'primary'}
                  block
                  disabled={tooSmall}
                  onClick={() => choose(p)}
                  title={tooSmall ? 'Pemakaian Anda melebihi batas paket ini' : undefined}
                >
                  {isCurrent ? 'Perpanjang' : 'Pilih paket'}
                </Button>
                {tooSmall && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Pemakaian Anda melebihi batas paket ini.
                  </Typography.Text>
                )}
              </div>
            </Col>
          );
        })}
      </Row>
    </Card>
  );
}
