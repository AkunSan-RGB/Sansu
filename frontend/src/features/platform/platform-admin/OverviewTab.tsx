import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Row, Space, Statistic, Typography } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { get } from '@/api/client';
import QueryState from '@/components/QueryState';
import { fmtMoney } from '@/lib/format';
import { Bars, KEYS, Overview, useBillingEnabled } from './shared';

export function OverviewTab() {
  const billing = useBillingEnabled();
  const q = useQuery({ queryKey: [...KEYS, 'overview'], queryFn: () => get<Overview>('/platform-admin/overview') });
  const [, setParams] = useSearchParams();
  return (
    <QueryState q={q}>
      {(o) => (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {!o.billingEnabled && (
            <Alert
              type="info"
              showIcon
              message="Langganan dimatikan — mode uji"
              description="Semua perusahaan memakai SANSU tanpa uji coba, batas paket, atau tagihan. Lihat siapa yang aktif di tab Pantauan uji; nyalakan langganan di tab Pengaturan saat siap berjualan."
              action={
                <Button size="small" onClick={() => setParams({ tab: 'pulse' })}>
                  Buka pantauan
                </Button>
              }
            />
          )}
          {billing && o.waiting > 0 && (
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
            {(o.billingEnabled
              ? [
                  { t: 'Pendapatan berulang / bulan (MRR)', v: fmtMoney(o.mrr) },
                  { t: 'Diterima bulan ini', v: fmtMoney(o.paid_month) },
                  { t: 'Pelanggan berbayar aktif', v: o.active },
                  { t: 'Sedang uji coba', v: o.trial },
                  { t: 'Kedaluwarsa', v: o.expired },
                  { t: 'Ditangguhkan / berhenti', v: o.suspended },
                  { t: 'Total perusahaan', v: o.tenants },
                  { t: 'Daftar 30 hari terakhir', v: o.new30 },
                ]
              : [
                  { t: 'Total perusahaan', v: o.tenants },
                  { t: 'Daftar 30 hari terakhir', v: o.new30 },
                ]
            ).map((s) => (
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
            {billing && (
              <Col xs={24} md={12}>
                <Card title="Pendapatan per bulan" size="small">
                  <Bars rows={o.revenue} value={(r: { amount: string }) => Number(r.amount)} fmt={(n) => fmtMoney(n)} />
                </Card>
              </Col>
            )}
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
