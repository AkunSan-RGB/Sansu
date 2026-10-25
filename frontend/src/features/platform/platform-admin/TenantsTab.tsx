import { SearchOutlined } from '@ant-design/icons';
import { SUBSCRIPTION_STATUS_LABELS, type SubscriptionStatus } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Input, Segmented, Space, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, qs } from '@/api/client';
import { fmtDate } from '@/lib/format';
import { SUB_COLOR } from '../../billing/billing/StatusCard';
import { t } from '@/lib/terms';
import { KEYS, useBillingEnabled } from './shared';
import { TenantDrawer } from './TenantDrawer';

interface TenantRow {
  id: string;
  name: string;
  created_at: string;
  status: string | null;
  state: SubscriptionStatus;
  endsAt: string | null;
  daysLeft: number | null;
  plan_name: string | null;
  users: number;
  last_login: string | null;
  owner_email: string | null;
  owner_name: string | null;
  owner_verified: boolean | null;
  sales_invoices: number;
  waiting: number;
  notes: string | null;
}

// ---------------- Perusahaan ----------------
export function TenantsTab() {
  const billing = useBillingEnabled();
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('ALL');
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: [...KEYS, 'tenants', search],
    queryFn: () => get<TenantRow[]>(`/platform-admin/tenants${qs({ q: search })}`),
  });
  const rows = (q.data ?? []).filter((r) => status === 'ALL' || r.state === status);
  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search
          placeholder="Cari nama perusahaan / email"
          allowClear
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onSearch={setSearch}
          style={{ width: 300 }}
          enterButton={<SearchOutlined />}
        />
        {billing && <Segmented
          value={status}
          onChange={(v) => setStatus(String(v))}
          options={[
            { value: 'ALL', label: 'Semua' },
            ...(['TRIAL', 'ACTIVE', 'OVERDUE', 'EXPIRED', 'SUSPENDED'] as SubscriptionStatus[]).map((s) => ({
              value: s,
              label: SUBSCRIPTION_STATUS_LABELS[s],
            })),
          ]}
        />}
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={q.isLoading}
        dataSource={rows}
        scroll={{ x: 1100 }}
        pagination={{ pageSize: 50, showSizeChanger: false }}
        onRow={(r) => ({ onClick: () => setOpen(r.id), style: { cursor: 'pointer' } })}
        columns={[
          {
            title: 'Perusahaan',
            render: (_, r) => (
              <div>
                <Typography.Text strong>{r.name}</Typography.Text>
                {r.waiting > 0 && (
                  <Tag color="blue" style={{ marginLeft: 6 }}>
                    bukti transfer
                  </Tag>
                )}
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {r.owner_name} · {r.owner_email}{' '}
                  {r.owner_verified === false && <Tag style={{ fontSize: 11 }}>email belum verifikasi</Tag>}
                </div>
              </div>
            ),
          },
          ...(billing
            ? [
                { title: 'Paket', dataIndex: 'plan_name', render: (v: string | null) => v ?? '—' },
                {
                  title: 'Status',
                  dataIndex: 'state',
                  render: (s: SubscriptionStatus, r: TenantRow) => <Tag color={SUB_COLOR[s]}>{r.status ? SUBSCRIPTION_STATUS_LABELS[s] : 'Tanpa langganan'}</Tag>,
                },
                {
                  title: 'Berakhir',
                  render: (_: unknown, r: TenantRow) => (r.endsAt ? `${fmtDate(r.endsAt)}${r.daysLeft ? ` (${r.daysLeft} hr)` : ''}` : 'Tanpa batas'),
                },
              ]
            : []),
          { title: 'Pengguna', dataIndex: 'users', align: 'right' },
          { title: t('Faktur dibuat'), dataIndex: 'sales_invoices', align: 'right' },
          {
            title: 'Login terakhir',
            dataIndex: 'last_login',
            render: (v) => (v ? dayjs(v).format('DD MMM YYYY HH:mm') : '-'),
          },
          { title: 'Daftar', dataIndex: 'created_at', render: fmtDate },
        ]}
      />
      <TenantDrawer id={open} onClose={() => setOpen(null)} />
    </>
  );
}
