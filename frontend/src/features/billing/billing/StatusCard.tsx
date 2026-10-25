import { BRAND, SUBSCRIPTION_STATUS_LABELS, type BillingOverview, type SubscriptionStatus } from '@sansu/shared';
import { Alert, Card, Col, Progress, Row, Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { fmtDate } from '@/lib/format';

export const SUB_COLOR: Record<SubscriptionStatus, string> = {
  TRIAL: 'blue',
  ACTIVE: 'green',
  OVERDUE: 'orange',
  EXPIRED: 'red',
  SUSPENDED: 'red',
  CANCELLED: 'default',
};

export function StatusCard({ d }: { d: BillingOverview }) {
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
