import { BILLING_STATUS_LABELS, SUBSCRIPTION_STATUS_LABELS, ROLE_LABELS, type BillingInvoiceStatus, type Plan, type SubscriptionStatus } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { App, Button, Card, Col, DatePicker, Descriptions, Drawer, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, patch, post } from '@/api/client';
import { useAction } from '@/api/queries';
import QueryState from '@/components/QueryState';
import { fmtDate, fmtMoney } from '@/lib/format';
import { SUB_COLOR } from '../../billing/billing/StatusCard';
import { t } from '@/lib/terms';
import { INV_COLOR, KEYS, useBillingEnabled } from './shared';

interface TenantDetail {
  tenant: { id: string; name: string; npwp: string | null; address: string | null; createdAt: string };
  subscription: {
    planId: string;
    status: string;
    cycle: 'MONTHLY' | 'YEARLY';
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    notes: string;
  } | null;
  state: { status: SubscriptionStatus; endsAt: string | null; daysLeft: number | null; plan: { name: string } | null };
  usage: { users: number; warehouses: number };
  users: {
    id: string;
    name: string;
    email: string;
    role: keyof typeof ROLE_LABELS;
    isActive: boolean;
    lastLoginAt: string | null;
    emailVerifiedAt: string | null;
  }[];
  invoices: {
    id: string;
    number: string;
    amount: string;
    status: BillingInvoiceStatus;
    planName: string;
    cycle: string;
    paidAt: string | null;
    createdAt: string;
  }[];
}

export function TenantDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: [...KEYS, 'tenant', id],
    queryFn: () => get<TenantDetail>(`/platform-admin/tenants/${id}`),
    enabled: !!id,
  });
  const plans = useQuery({ queryKey: [...KEYS, 'plans'], queryFn: () => get<Plan[]>('/platform-admin/plans') });
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [resetUrl, setResetUrl] = useState<{ email: string; url: string } | null>(null);
  const resetLink = useAction((userId: string) => post<{ email: string; url: string; expiresInMinutes: number }>(`/platform-admin/users/${userId}/reset-link`), {
    onSuccess: (r) => setResetUrl({ email: r.email, url: r.url }),
  });
  const save = useAction((v: Record<string, unknown>) => patch(`/platform-admin/tenants/${id}/subscription`, v), {
    success: 'Langganan diperbarui',
    invalidate: KEYS,
  });
  const billing = useBillingEnabled();
  const d = q.data;
  return (
    <><Drawer open={!!id} onClose={onClose} width={720} title={d?.tenant.name ?? 'Perusahaan'} destroyOnHidden>
      <QueryState q={q}>
        {(d) => (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions size="small" column={2} bordered>
              {billing && (
                <Descriptions.Item label="Status">
                  <Tag color={SUB_COLOR[d.state.status]}>{SUBSCRIPTION_STATUS_LABELS[d.state.status]}</Tag>
                </Descriptions.Item>
              )}
              {billing && <Descriptions.Item label="Paket">{d.state.plan?.name ?? '—'}</Descriptions.Item>}
              {billing && (
                <Descriptions.Item label="Berakhir">{d.state.endsAt ? fmtDate(d.state.endsAt) : 'Tanpa batas'}</Descriptions.Item>
              )}
              <Descriptions.Item label="Terdaftar">{fmtDate(d.tenant.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="Pengguna aktif">{d.usage.users}</Descriptions.Item>
              <Descriptions.Item label={t('Gudang')}>{d.usage.warehouses}</Descriptions.Item>
              <Descriptions.Item label="NPWP" span={2}>
                {d.tenant.npwp || '-'}
              </Descriptions.Item>
            </Descriptions>

            {billing && <Card size="small" title="Atur langganan">
              <Form
                form={form}
                layout="vertical"
                key={d.tenant.id + (d.subscription?.status ?? '')}
                initialValues={{
                  planId: d.subscription?.planId,
                  status: d.subscription?.status ?? 'ACTIVE',
                  cycle: d.subscription?.cycle ?? 'MONTHLY',
                  end:
                    d.subscription?.status === 'TRIAL'
                      ? d.subscription.trialEndsAt
                        ? dayjs(d.subscription.trialEndsAt)
                        : null
                      : d.subscription?.currentPeriodEnd
                        ? dayjs(d.subscription.currentPeriodEnd)
                        : null,
                  notes: d.subscription?.notes ?? '',
                }}
                onFinish={(v: {
                  planId: string;
                  status: string;
                  cycle: string;
                  end: dayjs.Dayjs | null;
                  extendDays?: number;
                  notes: string;
                }) => {
                  const body: Record<string, unknown> = {
                    planId: v.planId,
                    status: v.status,
                    cycle: v.cycle,
                    notes: v.notes,
                  };
                  if (v.status === 'TRIAL') {
                    if (v.end) body.trialEndsAt = v.end.endOf('day').toISOString();
                  } else body.currentPeriodEnd = v.end ? v.end.endOf('day').toISOString() : null;
                  if (v.extendDays) body.extendDays = v.extendDays;
                  save.mutate(body, { onSuccess: () => form.setFieldValue('extendDays', undefined) });
                }}
              >
                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item name="planId" label="Paket">
                      <Select
                        options={(plans.data ?? []).map((p) => ({
                          value: p.id,
                          label: `${p.name}${p.isActive ? '' : ' (nonaktif)'}`,
                        }))}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="status" label="Status">
                      <Select
                        options={[
                          { value: 'TRIAL', label: 'Uji coba' },
                          { value: 'ACTIVE', label: 'Aktif' },
                          { value: 'SUSPENDED', label: 'Ditangguhkan' },
                          { value: 'CANCELLED', label: 'Dihentikan' },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="cycle" label="Siklus tagihan">
                      <Select
                        options={[
                          { value: 'MONTHLY', label: 'Bulanan' },
                          { value: 'YEARLY', label: 'Tahunan' },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="end" label="Berakhir pada" extra="Kosong (status Aktif) = tanpa batas waktu">
                      <DatePicker style={{ width: '100%' }} format="DD MMM YYYY" allowClear />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="extendDays" label="Tambah hari (opsional)">
                      <InputNumber min={1} max={3660} style={{ width: '100%' }} placeholder="mis. 7" />
                    </Form.Item>
                  </Col>
                  <Col span={24}>
                    <Form.Item name="notes" label="Catatan internal">
                      <Input.TextArea rows={2} maxLength={1000} />
                    </Form.Item>
                  </Col>
                </Row>
                <Button type="primary" htmlType="submit" loading={save.isPending}>
                  Simpan
                </Button>
              </Form>
            </Card>}

            <Card size="small" title="Pengguna">
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={d.users}
                columns={[
                  { title: 'Nama', dataIndex: 'name' },
                  {
                    title: 'Email',
                    dataIndex: 'email',
                    render: (v, u) => (
                      <>
                        {v} {!u.emailVerifiedAt && <Tag>belum verifikasi</Tag>}
                      </>
                    ),
                  },
                  { title: 'Peran', dataIndex: 'role', render: (r: keyof typeof ROLE_LABELS) => ROLE_LABELS[r] },
                  { title: 'Aktif', dataIndex: 'isActive', render: (v) => (v ? 'Ya' : 'Tidak') },
                  {
                    title: 'Login terakhir',
                    dataIndex: 'lastLoginAt',
                    render: (v) => (v ? dayjs(v).format('DD MMM YY HH:mm') : '-'),
                  },
                  {
                    title: '',
                    render: (_, u) => (
                      <Button size="small" disabled={!u.isActive} loading={resetLink.isPending && resetLink.variables === u.id} onClick={() => resetLink.mutate(u.id)}>
                        Tautan atur ulang sandi
                      </Button>
                    ),
                  },
                ]}
              />
            </Card>
            {billing && <Card size="small" title="Tagihan">
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={d.invoices}
                columns={[
                  { title: 'Nomor', dataIndex: 'number' },
                  {
                    title: 'Paket',
                    render: (_, i) => `${i.planName} · ${i.cycle === 'YEARLY' ? 'tahunan' : 'bulanan'}`,
                  },
                  { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: fmtMoney },
                  {
                    title: 'Status',
                    dataIndex: 'status',
                    render: (s: BillingInvoiceStatus) => <Tag color={INV_COLOR[s]}>{BILLING_STATUS_LABELS[s]}</Tag>,
                  },
                  { title: 'Lunas', dataIndex: 'paidAt', render: (v) => (v ? fmtDate(v) : '-') },
                ]}
              />
            </Card>}
          </Space>
        )}
      </QueryState>
    </Drawer>
      <Modal open={!!resetUrl} onCancel={() => setResetUrl(null)} footer={<Button onClick={() => setResetUrl(null)}>Tutup</Button>} title="Tautan atur ulang sandi" destroyOnHidden>
        <Typography.Paragraph>
          Berikan tautan ini hanya kepada <strong>{resetUrl?.email}</strong> (lewat WhatsApp atau chat pribadi). Berlaku 1 jam, sekali pakai; tautan lama pengguna ini dibatalkan.
        </Typography.Paragraph>
        <Input.TextArea readOnly rows={3} value={resetUrl?.url} onFocus={(e) => e.target.select()} />
        <Button style={{ marginTop: 8 }} onClick={() => navigator.clipboard.writeText(resetUrl?.url ?? '').then(() => message.success('Tautan disalin'))}>
          Salin tautan
        </Button>
      </Modal></>
  );
}
