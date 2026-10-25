import { ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { BRAND } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Badge, Collapse, Button, Card, Col, Row, Space, Statistic, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import QueryState from '@/components/QueryState';
import { KEYS } from './shared';

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

export function SystemTab() {
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
