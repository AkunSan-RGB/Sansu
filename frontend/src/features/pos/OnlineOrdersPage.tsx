import { CopyOutlined, KeyOutlined, StopOutlined } from '@ant-design/icons';
import { ONLINE_CHANNEL_LABELS, ONLINE_CHANNELS, type OnlineChannel } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { get, patch, post, qs } from '@/api/client';
import { LEDGER_KEYS, useAction, useWarehouses } from '@/api/queries';
import type { OnlineApiKeyRow, PlatformSettlement, UnsettledOnlineOrder } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';

const KEYS = ['pos-online', ...LEDGER_KEYS];

/** Pesanan online: pencairan dana dari platform, komisi per kanal, dan kunci API penerima pesanan */
export default function OnlineOrdersPage() {
  const { me } = useAuth();
  const admin = me?.role === 'OWNER' || me?.role === 'ADMIN';
  return (
    <>
      <PageHeader title="Pesanan online" />
      <Card>
        <Tabs
          items={[
            { key: 'unsettled', label: 'Belum dicairkan', children: <Unsettled /> },
            { key: 'history', label: 'Riwayat pencairan', children: <History /> },
            ...(admin ? [{ key: 'settings', label: 'Komisi & kunci API', children: <Settings /> }] : []),
          ]}
        />
      </Card>
    </>
  );
}

function Unsettled() {
  const [channel, setChannel] = useState<OnlineChannel | 'ALL'>('ALL');
  const q = useQuery({ queryKey: ['pos-online', 'unsettled', channel], queryFn: () => get<{ items: UnsettledOnlineOrder[]; totals: { count: number; total: string; fee: string; net: string } }>(`/pos/online/unsettled${qs({ channel: channel === 'ALL' ? undefined : channel })}`) });
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ received: number; notes?: string; date?: string }>();
  const items = q.data?.items ?? [];
  useEffect(() => setPicked([]), [channel, q.data]);
  const sel = items.filter((i) => picked.includes(i.id));
  const expected = sel.reduce((a, i) => a + Number(i.net), 0);
  const channels = [...new Set(sel.map((i) => i.channel))];
  const settle = useAction(
    (v: { received: number; notes?: string }) => post('/pos/online/settlements', { channel: channels[0], orderIds: picked, received: String(v.received), notes: v.notes?.trim() || undefined }),
    { invalidate: KEYS, success: 'Pencairan dicatat', onSuccess: () => { setOpen(false); form.resetFields(); } },
  );
  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented value={channel} onChange={(v) => setChannel(v as OnlineChannel | 'ALL')} options={[{ value: 'ALL', label: 'Semua kanal' }, ...ONLINE_CHANNELS.map((c) => ({ value: c, label: ONLINE_CHANNEL_LABELS[c] }))]} />
        <Button type="primary" disabled={!picked.length || channels.length !== 1} onClick={() => { form.setFieldsValue({ received: Math.round(expected * 100) / 100 }); setOpen(true); }}>
          Catat pencairan ({picked.length})
        </Button>
        {channels.length > 1 && <Typography.Text type="danger">Pilih pesanan dari satu kanal saja.</Typography.Text>}
      </Space>
      <Table<UnsettledOnlineOrder>
        size="small"
        rowKey="id"
        loading={q.isLoading}
        dataSource={items}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: 640 }}
        locale={{ emptyText: 'Semua pesanan online sudah dicairkan.' }}
        rowSelection={{ selectedRowKeys: picked, onChange: (k) => setPicked(k as string[]) }}
        columns={[
          { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
          { title: 'No. kasir', dataIndex: 'number' },
          { title: 'Kanal', render: (_: unknown, o) => <Tag color="purple">{ONLINE_CHANNEL_LABELS[o.channel]}</Tag> },
          { title: 'No. platform', dataIndex: 'externalRef', render: (v: string | null) => v ?? '-' },
          { title: 'Total', align: 'right', dataIndex: 'total', render: fmtMoney },
          { title: 'Komisi', align: 'right', dataIndex: 'platformFee', render: fmtMoney },
          { title: 'Seharusnya diterima', align: 'right', dataIndex: 'net', render: fmtMoney },
        ]}
        summary={() => (q.data && items.length ? <Table.Summary.Row><Table.Summary.Cell index={0} colSpan={5}><strong>Total ({q.data.totals.count} pesanan)</strong></Table.Summary.Cell><Table.Summary.Cell index={5} align="right"><strong>{fmtMoney(q.data.totals.fee)}</strong></Table.Summary.Cell><Table.Summary.Cell index={6} align="right"><strong>{fmtMoney(q.data.totals.net)}</strong></Table.Summary.Cell></Table.Summary.Row> : null)}
      />
      <Modal title={`Catat pencairan ${channels[0] ? ONLINE_CHANNEL_LABELS[channels[0]] : ''}`} open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={settle.isPending} okText="Catat pencairan" destroyOnHidden>
        <Typography.Paragraph>
          {picked.length} pesanan, seharusnya diterima <strong>{fmtMoney(expected)}</strong>. Isi dana yang benar-benar masuk ke bank sesuai laporan platform.
        </Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={(v) => settle.mutate(v)}>
          <Form.Item name="received" label="Dana yang masuk ke bank" rules={[{ required: true }]}>
            <InputNumber min={0} prefix="Rp" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) => {
              const diff = Number(getFieldValue('received') ?? 0) - expected;
              return Math.abs(diff) >= 0.005 ? (
                <>
                  <Alert type="warning" showIcon style={{ marginBottom: 8 }} message={`Selisih ${diff > 0 ? '+' : '−'}${fmtMoney(Math.abs(diff))} dari seharusnya; dicatat ke akun komisi platform. Jelaskan alasannya.`} />
                  <Form.Item name="notes" rules={[{ required: true, min: 5, message: 'Alasan minimal 5 huruf' }]}>
                    <Input.TextArea rows={2} maxLength={300} placeholder="Mis. potongan promo platform, pesanan dibatalkan platform" />
                  </Form.Item>
                </>
              ) : null;
            }}
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function History() {
  const q = useQuery({ queryKey: ['pos-online', 'settlements'], queryFn: () => get<PlatformSettlement[]>('/pos/online/settlements') });
  const cancel = useAction((id: string) => post(`/pos/online/settlements/${id}/cancel`), { invalidate: KEYS, success: 'Pencairan dibatalkan' });
  return (
    <Table<PlatformSettlement>
      size="small"
      rowKey="id"
      loading={q.isLoading}
      dataSource={q.data}
      pagination={{ pageSize: 20, hideOnSinglePage: true }}
      scroll={{ x: 680 }}
      locale={{ emptyText: 'Belum ada pencairan.' }}
      columns={[
        { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
        { title: 'No.', dataIndex: 'number' },
        { title: 'Kanal', render: (_: unknown, s) => ONLINE_CHANNEL_LABELS[s.channel] },
        { title: 'Pesanan', dataIndex: 'orderCount', align: 'right' },
        { title: 'Seharusnya', dataIndex: 'expected', align: 'right', render: fmtMoney },
        { title: 'Masuk', dataIndex: 'received', align: 'right', render: fmtMoney },
        { title: 'Selisih', dataIndex: 'difference', align: 'right', render: (v: string) => (Number(v) === 0 ? '-' : <Typography.Text type={Number(v) < 0 ? 'danger' : 'success'}>{fmtMoney(v)}</Typography.Text>) },
        { title: 'Status', render: (_: unknown, s) => (s.status === 'POSTED' ? <Tag color="green">Tercatat</Tag> : <Tag>Dibatalkan</Tag>) },
        { title: '', render: (_: unknown, s) => (s.status === 'POSTED' ? <Popconfirm title="Batalkan pencairan ini?" description="Jurnal dibalik dan pesanannya kembali belum dicairkan." okText="Batalkan" cancelText="Tidak" onConfirm={() => cancel.mutate(s.id)}><Button size="small" danger type="text">Batalkan</Button></Popconfirm> : null) },
      ]}
    />
  );
}

function Settings() {
  const { data: warehouses } = useWarehouses();
  const settings = useQuery({ queryKey: ['pos-online', 'settings'], queryFn: () => get<{ commissions: Record<OnlineChannel, number> }>('/pos/online/settings') });
  const keys = useQuery({ queryKey: ['pos-online', 'keys'], queryFn: () => get<OnlineApiKeyRow[]>('/pos/online/keys') });
  const [form] = Form.useForm<Record<OnlineChannel, number>>();
  const [keyForm] = Form.useForm<{ name: string; warehouseId: string }>();
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => { if (settings.data) form.setFieldsValue(settings.data.commissions); }, [settings.data, form]);
  const save = useAction((v: Record<OnlineChannel, number>) => patch('/pos/online/settings', { commissions: v }), { invalidate: ['pos-online'], success: 'Komisi disimpan' });
  const create = useAction((v: { name: string; warehouseId: string }) => post<{ key: string }>('/pos/online/keys', v), { invalidate: ['pos-online'], onSuccess: (r) => { setShown(r.key); keyForm.resetFields(); } });
  const revoke = useAction((id: string) => post(`/pos/online/keys/${id}/revoke`), { invalidate: ['pos-online'], success: 'Kunci dicabut' });
  const base = typeof window === 'undefined' ? '' : window.location.origin;
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <div>
        <Typography.Title level={5}>Komisi platform</Typography.Title>
        <Typography.Paragraph type="secondary">Persentase dari harga menu sebelum pajak, sesuai perjanjian dengan tiap platform. Dipakai menghitung komisi otomatis saat pesanan online selesai.</Typography.Paragraph>
        <Form form={form} layout="inline" onFinish={(v) => save.mutate(v)} style={{ rowGap: 8 }}>
          {ONLINE_CHANNELS.map((c) => (
            <Form.Item key={c} name={c} label={ONLINE_CHANNEL_LABELS[c]}>
              <InputNumber min={0} max={50} step={0.5} suffix="%" style={{ width: 110 }} />
            </Form.Item>
          ))}
          <Button htmlType="submit" type="primary" loading={save.isPending}>Simpan</Button>
        </Form>
      </div>
      <div>
        <Typography.Title level={5}>Kunci API penerima pesanan</Typography.Title>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="SANSU tidak memanggil API GoFood/GrabFood/ShopeeFood langsung (butuh kemitraan dan kredensial dari platform). Sebaliknya, aplikasi pesanan atau integrator Anda dapat mengirim pesanan ke SANSU memakai kunci ini; pesanan langsung masuk ke layar dapur."
          description={<code style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{`POST ${base}/api/online-orders\nX-Api-Key: <kunci>\n{"channel":"GOFOOD","externalRef":"GF-123456","customerName":"Budi","items":[{"sku":"MN-KOPSU","qty":"2","notes":"kurang manis"}]}`}</code>}
        />
        <Form form={keyForm} layout="inline" onFinish={(v) => create.mutate(v)} style={{ marginBottom: 12, rowGap: 8 }}>
          <Form.Item name="name" rules={[{ required: true, min: 2, message: 'Nama minimal 2 huruf' }]}><Input placeholder="Nama kunci (mis. Aplikasi GoFood)" maxLength={60} style={{ width: 240 }} /></Form.Item>
          <Form.Item name="warehouseId" rules={[{ required: true, message: 'Pilih outlet' }]}><Select placeholder="Outlet tujuan" style={{ width: 200 }} options={warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} /></Form.Item>
          <Button htmlType="submit" type="primary" icon={<KeyOutlined />} loading={create.isPending}>Buat kunci</Button>
        </Form>
        <Table<OnlineApiKeyRow>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={keys.data}
          locale={{ emptyText: 'Belum ada kunci.' }}
          scroll={{ x: 520 }}
          columns={[
            { title: 'Nama', dataIndex: 'name' },
            { title: 'Awalan', dataIndex: 'keyPrefix', render: (v: string) => <code>{v}…</code> },
            { title: 'Terakhir dipakai', dataIndex: 'lastUsedAt', render: (v: string | null) => (v ? fmtDate(v) : '-') },
            { title: 'Status', render: (_: unknown, k) => (k.revokedAt ? <Tag>Dicabut</Tag> : <Tag color="green">Aktif</Tag>) },
            { title: '', render: (_: unknown, k) => (!k.revokedAt ? <Popconfirm title="Cabut kunci ini?" description="Aplikasi yang memakainya tidak bisa mengirim pesanan lagi." okText="Cabut" cancelText="Tidak" onConfirm={() => revoke.mutate(k.id)}><Button size="small" danger type="text" icon={<StopOutlined />}>Cabut</Button></Popconfirm> : null) },
          ]}
        />
      </div>
      <Modal title="Kunci API baru" open={!!shown} onCancel={() => setShown(null)} footer={<Button type="primary" onClick={() => setShown(null)}>Sudah saya simpan</Button>} destroyOnHidden>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Simpan kunci ini sekarang. Kunci tidak bisa ditampilkan lagi; bila hilang, cabut dan buat yang baru." />
        <Input.TextArea readOnly rows={2} value={shown ?? ''} />
        <Button style={{ marginTop: 8 }} icon={<CopyOutlined />} onClick={() => shown && navigator.clipboard?.writeText(shown)}>Salin</Button>
      </Modal>
    </Space>
  );
}
