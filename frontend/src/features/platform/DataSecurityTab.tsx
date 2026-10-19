import { ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import QueryState from '@/components/QueryState';
import { fmtDate } from '@/lib/format';

interface Check {
  key: string;
  title: string;
  ok: boolean;
  severity: 'critical' | 'warning';
  detail: string;
}
interface Posture {
  ok: boolean;
  checkedAt: string;
  checks: Check[];
}
interface Req {
  id: string;
  tenantId: string;
  company: string;
  status: 'SCHEDULED' | 'ON_HOLD' | 'CANCELLED' | 'EXECUTED';
  requestedAt: string;
  requestedByEmail: string;
  scheduledFor: string;
  exportWaived: boolean;
  holdReason: string | null;
}
interface Erased {
  id: string;
  company: string;
  requestedByEmail: string;
  requestedAt: string;
  executedAt: string;
  exportWaived: boolean;
  rowsDeleted: number;
  tablesTouched: number;
}
interface BackupEntry {
  kind: 'DUMP' | 'RESTORE_TEST';
  status: 'OK' | 'FAILED';
  source: string;
  at: string;
  sizeBytes?: number;
  durationSec?: number;
  offsite?: boolean;
  encrypted?: boolean;
  note?: string;
  detail?: Record<string, number>;
}
interface BackupKindStatus {
  state: 'NEVER' | 'OK' | 'FAILED' | 'STALE';
  last: BackupEntry | null;
  lastOk: BackupEntry | null;
  ageHours: number | null;
}
interface BackupOverview {
  configured: boolean;
  maxAgeHours: number;
  restoreMaxAgeDays: number;
  dump: BackupKindStatus;
  restoreTest: BackupKindStatus;
  history: BackupEntry[];
}
const BK_STATE: Record<BackupKindStatus['state'], { label: string; color: string }> = {
  OK: { label: 'Baik', color: 'green' },
  STALE: { label: 'Basi', color: 'orange' },
  FAILED: { label: 'Gagal', color: 'red' },
  NEVER: { label: 'Belum ada laporan', color: 'default' },
};
const fmtSize = (n?: number) => (n === undefined ? '-' : n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const fmtAge = (h: number | null) => (h === null ? '-' : h < 1 ? '< 1 jam lalu' : h < 48 ? `${Math.floor(h)} jam lalu` : `${Math.floor(h / 24)} hari lalu`);
interface Deletions {
  requests: Req[];
  erased: Erased[];
}
const KEY = 'platform-admin';
const STATUS: Record<Req['status'], { label: string; color: string }> = {
  SCHEDULED: { label: 'Terjadwal', color: 'gold' },
  ON_HOLD: { label: 'Ditahan', color: 'red' },
  CANCELLED: { label: 'Dibatalkan', color: 'default' },
  EXECUTED: { label: 'Dieksekusi', color: 'green' },
};

/** Panel SANSU: postur keamanan database klien dan pengelolaan permintaan penghapusan data */
export default function DataSecurityTab() {
  const posture = useQuery({ queryKey: [KEY, 'posture'], queryFn: () => get<Posture>('/platform-admin/security-posture') });
  const backups = useQuery({ queryKey: [KEY, 'backups'], queryFn: () => get<BackupOverview>('/platform-admin/backups') });
  const del = useQuery({ queryKey: [KEY, 'deletions'], queryFn: () => get<Deletions>('/platform-admin/data-deletions') });
  const [holding, setHolding] = useState<Req | null>(null);
  const [form] = Form.useForm<{ reason: string }>();
  const hold = useAction((v: { id: string; reason: string }) => post(`/platform-admin/data-deletions/${v.id}/hold`, { reason: v.reason }), {
    success: 'Penghapusan ditahan',
    invalidate: [KEY],
    onSuccess: () => setHolding(null),
  });
  const release = useAction((id: string) => post(`/platform-admin/data-deletions/${id}/release`), { success: 'Penahanan dilepas', invalidate: [KEY] });

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card
        title="Keamanan database klien"
        extra={
          <Button icon={<ReloadOutlined />} loading={posture.isFetching} onClick={() => posture.refetch()}>
            Periksa ulang
          </Button>
        }
      >
        <QueryState q={posture}>
          {(p) => (
            <>
              <Alert
                showIcon
                type={p.ok ? 'success' : 'error'}
                message={p.ok ? 'Semua pemeriksaan kritis lolos' : 'Ada pemeriksaan kritis yang gagal — pemisahan data antar perusahaan tidak terjamin'}
                description={`Diperiksa ${fmtDate(p.checkedAt)}. Dijalankan juga saat aplikasi start dan tiap 24 jam.`}
                style={{ marginBottom: 12 }}
              />
              <Table<Check>
                size="small"
                rowKey="key"
                pagination={false}
                dataSource={p.checks}
                scroll={{ x: 'max-content' }}
                columns={[
                  { title: 'Pemeriksaan', dataIndex: 'title' },
                  {
                    title: 'Hasil',
                    width: 110,
                    render: (_, c) => (c.ok ? <Tag color="green">Lolos</Tag> : <Tag color={c.severity === 'critical' ? 'red' : 'orange'}>{c.severity === 'critical' ? 'Gagal' : 'Peringatan'}</Tag>),
                  },
                  { title: 'Keterangan', dataIndex: 'detail' },
                ]}
              />
            </>
          )}
        </QueryState>
      </Card>

      <Card
        title="Backup database"
        extra={
          <Button icon={<ReloadOutlined />} loading={backups.isFetching} onClick={() => backups.refetch()}>
            Muat ulang
          </Button>
        }
      >
        <QueryState q={backups}>
          {(b) => (
            <>
              {!b.configured ? (
                <Alert
                  showIcon
                  type="warning"
                  message="Pelaporan backup belum diaktifkan"
                  description="Isi BACKUP_REPORT_TOKEN di server lalu pasang pelaksana backup (GitHub Actions untuk Neon, atau layanan backup di server sendiri). Panduan: docs/OPERASIONAL.md. Tanpa ini SANSU tidak tahu apakah backup berjalan."
                />
              ) : (
                <Table<{ key: string; title: string; s: BackupKindStatus; limit: string }>
                  size="small"
                  rowKey="key"
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  dataSource={[
                    { key: 'dump', title: 'Backup harian', s: b.dump, limit: `batas ${b.maxAgeHours} jam` },
                    { key: 'restore', title: 'Uji pemulihan', s: b.restoreTest, limit: `batas ${b.restoreMaxAgeDays} hari` },
                  ]}
                  columns={[
                    { title: 'Jenis', dataIndex: 'title' },
                    { title: 'Status', render: (_, r) => <Tag color={BK_STATE[r.s.state].color}>{BK_STATE[r.s.state].label}</Tag> },
                    { title: 'Sukses terakhir', render: (_, r) => (r.s.lastOk ? `${fmtDate(r.s.lastOk.at)} · ${fmtAge(r.s.ageHours)}` : '-') },
                    { title: 'Ukuran', render: (_, r) => fmtSize(r.s.lastOk?.sizeBytes) },
                    { title: 'Di luar penyedia', render: (_, r) => (r.key === 'dump' && r.s.lastOk ? (r.s.lastOk.offsite ? <Tag color="green">Ada</Tag> : <Tag color="red">Tidak ada</Tag>) : '-') },
                    { title: 'Terenkripsi', render: (_, r) => (r.key === 'dump' && r.s.lastOk ? (r.s.lastOk.encrypted ? 'Ya' : <Tag color="orange">Tidak</Tag>) : '-') },
                    { title: 'Keterangan', render: (_, r) => (r.s.state === 'FAILED' ? r.s.last?.note ?? 'Gagal' : r.s.lastOk?.detail ? Object.entries(r.s.lastOk.detail).map(([k, v]) => `${k}: ${v}`).join(', ') : r.limit) },
                  ]}
                />
              )}
              {b.history.length > 0 && (
                <>
                  <Typography.Title level={5} style={{ marginTop: 16 }}>
                    Riwayat laporan terakhir
                  </Typography.Title>
                  <Table<BackupEntry>
                    size="small"
                    rowKey={(r) => `${r.kind}-${r.at}`}
                    pagination={{ pageSize: 8, hideOnSinglePage: true }}
                    dataSource={b.history}
                    scroll={{ x: 'max-content' }}
                    columns={[
                      { title: 'Waktu', dataIndex: 'at', render: (v: string) => fmtDate(v) },
                      { title: 'Jenis', dataIndex: 'kind', render: (v: string) => (v === 'DUMP' ? 'Backup' : 'Uji pemulihan') },
                      { title: 'Hasil', dataIndex: 'status', render: (v: string) => <Tag color={v === 'OK' ? 'green' : 'red'}>{v === 'OK' ? 'Sukses' : 'Gagal'}</Tag> },
                      { title: 'Sumber', dataIndex: 'source' },
                      { title: 'Ukuran', dataIndex: 'sizeBytes', render: (v?: number) => fmtSize(v) },
                      { title: 'Catatan', dataIndex: 'note', render: (v?: string) => v ?? '' },
                    ]}
                  />
                </>
              )}
            </>
          )}
        </QueryState>
      </Card>

      <Card title="Permintaan penghapusan data perusahaan">
        <QueryState q={del}>
          {(d) => (
            <>
              <Typography.Paragraph type="secondary">
                Ditahan = tidak akan dieksekusi sampai dilepas (mis. sengketa atau permintaan hukum). Data baru dihapus setelah masa tenggang dan setelah ekspor diunduh, kecuali pemilik melepas syarat itu.
              </Typography.Paragraph>
              <Table<Req>
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={d.requests}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: 'Tidak ada permintaan penghapusan' }}
                columns={[
                  { title: 'Perusahaan', dataIndex: 'company' },
                  { title: 'Diminta oleh', dataIndex: 'requestedByEmail' },
                  { title: 'Diminta', dataIndex: 'requestedAt', render: (v: string) => fmtDate(v) },
                  { title: 'Jadwal hapus', dataIndex: 'scheduledFor', render: (v: string) => fmtDate(v) },
                  { title: 'Tanpa ekspor', dataIndex: 'exportWaived', render: (v: boolean) => (v ? <Tag color="orange">Ya</Tag> : 'Tidak') },
                  {
                    title: 'Status',
                    render: (_, r) => (
                      <>
                        <Tag color={STATUS[r.status].color}>{STATUS[r.status].label}</Tag>
                        {r.holdReason && <Typography.Text type="secondary">{r.holdReason}</Typography.Text>}
                      </>
                    ),
                  },
                  {
                    title: '',
                    render: (_, r) =>
                      r.status === 'SCHEDULED' ? (
                        <Button size="small" danger onClick={() => { form.resetFields(); setHolding(r); }}>
                          Tahan
                        </Button>
                      ) : r.status === 'ON_HOLD' ? (
                        <Button size="small" loading={release.isPending} onClick={() => release.mutate(r.id)}>
                          Lepas
                        </Button>
                      ) : null,
                  },
                ]}
              />

              <Typography.Title level={5} style={{ marginTop: 24 }}>
                Bukti penghapusan yang sudah dieksekusi
              </Typography.Title>
              <Table<Erased>
                size="small"
                rowKey="id"
                pagination={{ pageSize: 10, hideOnSinglePage: true }}
                dataSource={d.erased}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: 'Belum ada' }}
                columns={[
                  { title: 'Perusahaan', dataIndex: 'company' },
                  { title: 'Diminta oleh', dataIndex: 'requestedByEmail' },
                  { title: 'Diminta', dataIndex: 'requestedAt', render: (v: string) => fmtDate(v) },
                  { title: 'Dieksekusi', dataIndex: 'executedAt', render: (v: string) => fmtDate(v) },
                  { title: 'Baris dihapus', dataIndex: 'rowsDeleted', align: 'right' },
                  { title: 'Tabel', dataIndex: 'tablesTouched', align: 'right' },
                  { title: 'Tanpa ekspor', dataIndex: 'exportWaived', render: (v: boolean) => (v ? 'Ya' : 'Tidak') },
                ]}
              />
            </>
          )}
        </QueryState>
      </Card>

      <Modal
        title={`Tahan penghapusan — ${holding?.company ?? ''}`}
        open={!!holding}
        onCancel={() => setHolding(null)}
        okText="Tahan"
        okButtonProps={{ danger: true, loading: hold.isPending }}
        onOk={() => form.validateFields().then((v) => holding && hold.mutate({ id: holding.id, reason: v.reason }))}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" name="data-hold">
          <Form.Item name="reason" label="Alasan penahanan" rules={[{ required: true, whitespace: true, message: 'Alasan wajib diisi' }, { max: 500 }]}>
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
