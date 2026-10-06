import { APPS, BRAND, type AppKey } from '@sansu/shared';
import { Card, Col, Row, Typography } from 'antd';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { APP_ICONS, useApps } from '@/lib/apps';
import OnboardingCard from './OnboardingCard';
import TaxThresholdAlerts from './TaxThresholdAlerts';

interface Tile {
  key: string;
  name: string;
  color: string;
  to: string;
  icon: React.ReactNode;
  hint?: string;
}

function AppTile({ t }: { t: Tile }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="app-tile"
      onClick={() => navigate(t.to)}
      title={t.hint}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        padding: '14px 6px',
        borderRadius: 14,
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <span
        style={{
          width: 72,
          height: 72,
          borderRadius: 18,
          background: t.color,
          color: '#fff',
          fontSize: 34,
          display: 'grid',
          placeItems: 'center',
          boxShadow: '0 6px 16px rgba(11,31,42,.18)',
        }}
      >
        {t.icon}
      </span>
      <span style={{ fontWeight: 600, color: BRAND.colors.ink, textAlign: 'center', fontSize: 14 }}>{t.name}</span>
    </button>
  );
}

const FLOW: AppKey[] = ['crm', 'sales', 'pos', 'purchase', 'inventory', 'cash', 'accounting', 'hr', 'payroll'];

/** Layar menu aplikasi (mirip beranda Odoo) */
export default function HomePage() {
  const { me } = useAuth();
  const { can, isAdmin } = useApps();
  const hour = dayjs().hour();
  const greet = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 18 ? 'Selamat sore' : 'Selamat malam';

  const tiles: Tile[] = [
    ...((can('accounting') || can('sales')) && ['OWNER', 'ADMIN', 'FINANCE', 'SALES'].includes(me?.role ?? '')
      ? [{ key: 'dashboard', name: 'Dashboard', color: '#334155', to: '/dashboard', icon: APP_ICONS.dashboard }]
      : []),
    // urutan ubin mengikuti alur kerja, sama dengan sidebar
    ...[...APPS]
      .sort((a, b) => FLOW.indexOf(a.key) - FLOW.indexOf(b.key))
      .filter((a) => can(a.key))
      .map((a) => ({
        key: a.key,
        name: a.name,
        color: a.color,
        to: a.home,
        icon: APP_ICONS[a.key],
        hint: a.description,
      })),
    ...(isAdmin
      ? [
          {
            key: 'apps',
            name: 'Aplikasi',
            color: '#64748B',
            to: '/settings/apps',
            icon: APP_ICONS.apps,
            hint: 'Aktifkan / nonaktifkan aplikasi',
          },
          {
            key: 'settings',
            name: 'Pengaturan',
            color: '#475569',
            to: '/settings/users',
            icon: APP_ICONS.settings,
            hint: 'Pengguna & perusahaan',
          },
        ]
      : []),
  ];

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', paddingTop: 8 }}>
      <Typography.Title level={3} style={{ marginBottom: 4 }}>
        {greet}, {me?.name?.split(' ')[0]}
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
        {me?.tenantName} · pilih aplikasi untuk mulai bekerja
      </Typography.Paragraph>
      <TaxThresholdAlerts />
      <OnboardingCard />
      <Card styles={{ body: { padding: 16 } }}>
        <Row gutter={[8, 8]}>
          {tiles.map((t) => (
            <Col key={t.key} xs={8} sm={6} md={4}>
              <AppTile t={t} />
            </Col>
          ))}
        </Row>
      </Card>
    </div>
  );
}
