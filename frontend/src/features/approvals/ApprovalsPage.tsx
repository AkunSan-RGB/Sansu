import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Empty, Form, Input, Modal, Popconfirm, Segmented, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';

interface Request {
  id: string;
  kind: 'PURCHASE_ORDER' | 'MANUAL_JOURNAL';
  kindLabel: string;
  refId: string | null;
  title: string;
  amount: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  resultRef: string | null;
  requestedBy: string;
  decidedBy: string | null;
  mine: boolean;
}

const STATUS: Record<Request['status'], { color: string; label: string }> = {
  PENDING: { color: 'gold', label: 'Menunggu' },
  APPROVED: { color: 'green', label: 'Disetujui' },
  REJECTED: { color: 'red', label: 'Ditolak' },
  CANCELLED: { color: 'default', label: 'Dibatalkan' },
};

const KEYS = ['approvals', 'purchase-orders', 'journals', 'reports', 'ledger', 'statements', 'dashboard', 'health'];

/** Kotak persetujuan: pemilik / admin memutuskan; peran lain melihat status permintaannya */
export default function ApprovalsPage() {
  const { me } = useAuth();
  const approver = !!me && ['OWNER', 'ADMIN'].includes(me.role);
  const [view, setView] = useState<'PENDING' | 'ALL'>('PENDING');
  const [rejecting, setRejecting] = useState<Request | null>(null);
  const [form] = Form.useForm<{ note: string }>();
  const q = useQuery({ queryKey: ['approvals', view], queryFn: () => get<Request[]>(`/approvals?status=${view}`), refetchInterval: 30_000 });
  const approve = useAction((id: string) => post(`/approvals/${id}/approve`), { success: 'Disetujui dan dijalankan', invalidate: KEYS });
  const reject = useAction((v: { id: string; note: string }) => post(`/approvals/${v.id}/reject`, { note: v.note }), {
    success: 'Permintaan ditolak',
    invalidate: KEYS,
    onSuccess: () => setRejecting(null),
  });
  const cancel = useAction((id: string) => post(`/approvals/${id}/cancel`), { success: 'Permintaan dibatalkan', invalidate: KEYS });

  return (
    <>
      <PageHeader title="Persetujuan" />
      <Card>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            approver
              ? 'Permintaan dari peran lain atas transaksi bernilai besar menunggu keputusan Anda. Batasnya diatur di Pengaturan → Perusahaan.'
              : 'Transaksi yang mencapai batas persetujuan perusahaan dikirim ke pemilik atau admin. Status permintaan Anda tampil di sini.'
          }
        />
        <Segmented
          style={{ marginBottom: 12 }}
          value={view}
          onChange={(v) => setView(v as 'PENDING' | 'ALL')}
          options={[
            { value: 'PENDING', label: 'Menunggu' },
            { value: 'ALL', label: 'Semua riwayat' },
          ]}
        />
        <Table
          rowKey="id"
          size="small"
          loading={q.isLoading}
          dataSource={q.data}
          scroll={{ x: 900 }}
          locale={{ emptyText: <Empty description={view === 'PENDING' ? 'Tidak ada permintaan yang menunggu' : 'Belum ada permintaan'} /> }}
          columns={[
            { title: 'Diminta', dataIndex: 'requestedAt', render: (d: string) => fmtDate(d), width: 110 },
            { title: 'Jenis', dataIndex: 'kindLabel', width: 150 },
            {
              title: 'Permintaan',
              dataIndex: 'title',
              render: (t: string, r) =>
                r.kind === 'PURCHASE_ORDER' && r.refId ? <Link to={`/purchase-orders/${r.refId}`}>{t}</Link> : t,
            },
            { title: 'Nilai', dataIndex: 'amount', align: 'right', render: fmtMoney },
            { title: 'Pemohon', dataIndex: 'requestedBy' },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (s: Request['status'], r) => (
                <Space direction="vertical" size={0}>
                  <Tag color={STATUS[s].color}>{STATUS[s].label}</Tag>
                  {r.decidedBy && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {r.decidedBy}
                      {r.resultRef ? ` · ${r.resultRef}` : ''}
                    </Typography.Text>
                  )}
                  {r.decisionNote && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      “{r.decisionNote}”
                    </Typography.Text>
                  )}
                </Space>
              ),
            },
            {
              title: '',
              width: 190,
              render: (_, r) =>
                r.status !== 'PENDING' ? null : (
                  <Space>
                    {approver && !r.mine && (
                      <>
                        <Popconfirm title="Setujui dan jalankan sekarang?" onConfirm={() => approve.mutate(r.id)}>
                          <Button size="small" type="primary" loading={approve.isPending && approve.variables === r.id}>
                            Setujui
                          </Button>
                        </Popconfirm>
                        <Button
                          size="small"
                          danger
                          onClick={() => {
                            form.resetFields();
                            setRejecting(r);
                          }}
                        >
                          Tolak
                        </Button>
                      </>
                    )}
                    {r.mine && (
                      <Popconfirm title="Batalkan permintaan ini?" onConfirm={() => cancel.mutate(r.id)}>
                        <Button size="small">Batalkan</Button>
                      </Popconfirm>
                    )}
                  </Space>
                ),
            },
          ]}
        />
      </Card>
      <Modal
        title={rejecting ? `Tolak: ${rejecting.title}` : 'Tolak'}
        open={!!rejecting}
        onCancel={() => setRejecting(null)}
        onOk={() => form.submit()}
        okText="Tolak permintaan"
        okButtonProps={{ danger: true, loading: reject.isPending }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(v) => rejecting && reject.mutate({ id: rejecting.id, note: v.note })}>
          <Form.Item name="note" label="Alasan penolakan" rules={[{ required: true, message: 'Isi alasan agar pemohon tahu' }]}>
            <Input.TextArea rows={3} maxLength={300} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
