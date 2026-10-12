import { CheckCircleFilled, CloseOutlined, RightOutlined, RocketOutlined } from '@ant-design/icons';
import { BRAND, type AppKey } from '@sansu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Progress, Space, Tooltip, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { get, post } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { useApps } from '@/lib/apps';

interface Step {
  key: string;
  title: string;
  description: string;
  done: boolean;
  link: string;
  app?: AppKey | AppKey[];
}
interface Onboarding {
  steps: Step[];
  done: number;
  total: number;
  dismissed: boolean;
}

/** Panduan langkah awal untuk perusahaan baru (Pemilik/Admin) */
export default function OnboardingCard() {
  const { me } = useAuth();
  const { can, isAdmin } = useApps();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['onboarding'],
    queryFn: () => get<Onboarding>('/onboarding'),
    enabled: isAdmin,
    staleTime: 60_000,
  });
  if (!isAdmin || !q.data || q.data.dismissed) return null;

  const steps = q.data.steps
    .filter((s) => !s.app || (Array.isArray(s.app) ? s.app.some(can) : can(s.app)))
    .filter((s) => s.key !== 'security' || me?.role === 'OWNER')
    .map((s) => (s.key === 'sale' && !can('sales') && can('pos') ? { ...s, link: '/pos' } : s));
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const pct = Math.round((done / steps.length) * 100);
  const next = steps.find((s) => !s.done);

  const dismiss = async () => {
    await post('/onboarding/dismiss', { dismissed: true });
    qc.invalidateQueries({ queryKey: ['onboarding'] });
  };

  return (
    <Card
      style={{ marginBottom: 16, borderColor: BRAND.colors.primarySoft }}
      styles={{ body: { padding: 20 } }}
      title={
        <Space>
          <RocketOutlined style={{ color: BRAND.colors.accent }} />
          <span>Mulai pakai SANSU</span>
          <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
            {done} dari {steps.length} langkah selesai
          </Typography.Text>
        </Space>
      }
      extra={
        <Tooltip title="Sembunyikan panduan ini">
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={() => void dismiss()}
            aria-label="Sembunyikan"
          />
        </Tooltip>
      }
    >
      <Progress percent={pct} strokeColor={BRAND.colors.accent} showInfo={false} style={{ marginBottom: 12 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
        {steps.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => navigate(s.link)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              padding: '10px 12px',
              borderRadius: 10,
              border: `1px solid ${s.key === next?.key ? BRAND.colors.primary : '#e5e9f0'}`,
              background: s.done ? '#f6fbf9' : '#fff',
              boxSizing: 'border-box',
            }}
          >
            {s.done ? (
              <CheckCircleFilled style={{ color: BRAND.colors.accent, fontSize: 18, marginTop: 2 }} />
            ) : (
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  border: '2px solid #cbd5e1',
                  marginTop: 2,
                  flex: '0 0 auto',
                }}
              />
            )}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  display: 'block',
                  fontWeight: 600,
                  color: s.done ? '#64748b' : BRAND.colors.ink,
                  textDecoration: s.done ? 'line-through' : undefined,
                }}
              >
                {s.title}
              </span>
              {!s.done && (
                <span style={{ display: 'block', fontSize: 12, color: '#64748b', marginTop: 2 }}>{s.description}</span>
              )}
            </span>
            {!s.done && <RightOutlined style={{ color: '#94a3b8', fontSize: 11, marginTop: 5 }} />}
          </button>
        ))}
      </div>
    </Card>
  );
}
