import { useQuery } from '@tanstack/react-query';
import { Button, Card, Col, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { get } from '@/api/client';
import QueryState from '@/components/QueryState';
import { Bars, KEYS } from './shared';

// ---------------- Pantauan uji ----------------
interface Pulse {
  users: number;
  d1: number;
  d7: number;
  d30: number;
  tenants: number;
  tenants7: number;
  selling: number;
  events24: number;
  events7: number;
  docs: { label: string; n7: number; total: number }[];
  daily: { day: string; n: number; users: number }[];
  top: { id: string; name: string; events: number; users: number; last: string | null }[];
  recent: { id: number; at: string; tenant: string; user: string | null; action: string; entity: string }[];
}

const ACTION_COLOR: Record<string, string> = { CREATE: 'green', UPDATE: 'blue', DELETE: 'red', CANCEL: 'orange', CONFIRM: 'cyan', POST: 'geekblue' };

/** Siapa yang memakai SANSU, seberapa sering, dan apa yang mereka kerjakan — untuk memantau tahap uji */
export function PulseTab() {
  const q = useQuery({ queryKey: [...KEYS, 'pulse'], queryFn: () => get<Pulse>('/platform-admin/pulse'), refetchInterval: 60_000 });
  const [, setParams] = useSearchParams();
  return (
    <QueryState q={q}>
      {(p) => (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Row gutter={[16, 16]}>
            {[
              { t: 'Pengguna login 24 jam', v: p.d1, s: `${p.users} pengguna aktif` },
              { t: 'Pengguna login 7 hari', v: p.d7 },
              { t: 'Pengguna login 30 hari', v: p.d30 },
              { t: 'Perusahaan aktif 7 hari', v: p.tenants7, s: `dari ${p.tenants} perusahaan` },
              { t: 'Sudah bertransaksi', v: p.selling, s: 'punya faktur atau transaksi kasir' },
              { t: 'Aktivitas 24 jam', v: p.events24 },
              { t: 'Aktivitas 7 hari', v: p.events7 },
            ].map((x) => (
              <Col xs={12} md={6} key={x.t}>
                <Card size="small">
                  <Statistic title={x.t} value={x.v} />
                  {x.s && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{x.s}</Typography.Text>}
                </Card>
              </Col>
            ))}
          </Row>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Card title="Aktivitas per hari (14 hari)" size="small">
                <Bars rows={p.daily.map((d) => ({ month: d.day, ...d }))} value={(r: { n: number }) => r.n} fmt={(n) => String(n)} label={(r) => dayjs(r.month).format('DD MMM')} />
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card title="Dokumen dibuat" size="small">
                <Table
                  size="small"
                  rowKey="label"
                  pagination={false}
                  dataSource={p.docs}
                  columns={[
                    { title: 'Jenis', dataIndex: 'label' },
                    { title: '7 hari', dataIndex: 'n7', align: 'right' },
                    { title: 'Seluruhnya', dataIndex: 'total', align: 'right' },
                  ]}
                />
              </Card>
            </Col>
          </Row>
          <Card title="Perusahaan paling aktif (7 hari)" size="small" extra={<Button size="small" onClick={() => setParams({ tab: 'tenants' })}>Semua perusahaan</Button>}>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={p.top}
              locale={{ emptyText: 'Belum ada aktivitas' }}
              columns={[
                { title: 'Perusahaan', dataIndex: 'name' },
                { title: 'Pengguna aktif', dataIndex: 'users', align: 'right' },
                { title: 'Aktivitas', dataIndex: 'events', align: 'right' },
                { title: 'Terakhir', dataIndex: 'last', render: (v: string | null) => (v ? dayjs(v).format('DD MMM HH:mm') : '-') },
              ]}
            />
          </Card>
          <Card title="Aktivitas terbaru" size="small">
            <Table
              size="small"
              rowKey="id"
              pagination={{ pageSize: 15, showSizeChanger: false }}
              dataSource={p.recent}
              scroll={{ x: 700 }}
              columns={[
                { title: 'Waktu', dataIndex: 'at', width: 130, render: (v: string) => dayjs(v).format('DD MMM HH:mm') },
                { title: 'Perusahaan', dataIndex: 'tenant' },
                { title: 'Pengguna', dataIndex: 'user', render: (v: string | null) => v ?? '—' },
                { title: 'Aksi', dataIndex: 'action', render: (v: string) => <Tag color={ACTION_COLOR[v] ?? 'default'}>{v}</Tag> },
                { title: 'Objek', dataIndex: 'entity' },
              ]}
            />
          </Card>
        </Space>
      )}
    </QueryState>
  );
}
