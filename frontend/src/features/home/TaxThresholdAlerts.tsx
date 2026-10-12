import { type TaxThresholdReport, type ThresholdAlert } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Progress, Space, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { get } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { useApps } from '@/lib/apps';
import { fmtMoney } from '@/lib/format';

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

/** Peringatan ambang pajak (PKP, PPh final, Pasal 31E, kriteria UMKM); hanya yang perlu perhatian (WARN / ERROR) */
export default function TaxThresholdAlerts() {
  const { me } = useAuth();
  const { can } = useApps();
  const navigate = useNavigate();
  const allowed = !!me && ['OWNER', 'ADMIN', 'FINANCE'].includes(me.role) && can('accounting');
  const q = useQuery({
    queryKey: ['tax-thresholds'],
    queryFn: () => get<TaxThresholdReport>('/accounting/tax-thresholds'),
    enabled: allowed,
    staleTime: 5 * 60_000,
  });
  const alerts = (q.data?.alerts ?? []).filter((a) => a.level === 'WARN' || a.level === 'ERROR');
  if (!allowed || !alerts.length) return null;

  const detail = (a: ThresholdAlert) =>
    a.limit > 0 ? (
      <div style={{ maxWidth: 420, marginTop: 8 }}>
        <Progress
          percent={Math.min(100, a.percent)}
          size="small"
          status={a.level === 'ERROR' ? 'exception' : 'active'}
          format={() => `${a.percent.toLocaleString('id-ID')}%`}
        />
        <Typography.Text type="secondary">
          {fmtMoney(a.current)} dari {fmtMoney(a.limit)}
          {a.projected != null && a.projected > a.current ? ` · perkiraan setahun ${fmtMoney(Math.round(a.projected))}` : ''}
          {a.crossingMonth ? ` · batas terlewati sekitar ${MONTHS[Number(a.crossingMonth.slice(5, 7)) - 1]}` : ''}
        </Typography.Text>
      </div>
    ) : null;

  return (
    <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }} size={8}>
      {alerts.map((a) => (
        <Alert
          key={a.key}
          type={a.level === 'ERROR' ? 'error' : 'warning'}
          showIcon
          message={a.title}
          description={
            <>
              {a.message}
              {detail(a)}
            </>
          }
          action={
            <Button size="small" onClick={() => navigate(a.link)}>
              Buka
            </Button>
          }
        />
      ))}
    </Space>
  );
}
