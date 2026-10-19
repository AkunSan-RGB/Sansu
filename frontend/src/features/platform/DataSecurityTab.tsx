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
