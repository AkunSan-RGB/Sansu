import { PlusOutlined, SettingOutlined } from '@ant-design/icons';
import { ONLINE_CHANNEL_LABELS, ONLINE_CHANNELS, type OnlineChannel, POS_ORDER_TYPE_LABELS, POS_ORDER_TYPES, type PosOrderType } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Empty, Form, Input, InputNumber, Modal, Row, Segmented, Select, Space, Spin, Switch, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, patch, post, qs } from '@/api/client';
import { useAction, useWarehouses } from '@/api/queries';
import type { PosSession, PosTabDetail, PosTabSummary, PosTableRow } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney } from '@/lib/format';
import { KEYS } from './tables/shared';
import { TabDrawer } from './tables/TabDrawer';

const since = (iso: string) => {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return min < 60 ? `${min} mnt` : `${Math.floor(min / 60)} j ${min % 60} mnt`;
};

/** Meja & pesanan: pilih meja, catat pesanan, kirim ke dapur, lalu bayar (boleh sebagian / pisah bill) */
export default function TablesPage() {
  const { me } = useAuth();
  const { data: warehouses } = useWarehouses();
  const session = useQuery({ queryKey: ['pos-session'], queryFn: () => get<PosSession | null>('/pos/sessions/current') });
  const [wh, setWh] = useState<string>();
  const warehouseId = wh ?? session.data?.warehouse?.id ?? warehouses?.[0]?.id;
  const [tabId, setTabId] = useState<string>();
  const [newOpen, setNewOpen] = useState(false);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const canManage = me?.role === 'OWNER' || me?.role === 'ADMIN';

  const tables = useQuery({ queryKey: ['pos-tables', warehouseId], queryFn: () => get<PosTableRow[]>(`/pos/tables${qs({ warehouseId })}`), enabled: !!warehouseId, refetchInterval: 15_000 });
  const tabs = useQuery({ queryKey: ['pos-tabs', 'OPEN', warehouseId], queryFn: () => get<PosTabSummary[]>(`/pos/tabs${qs({ status: 'OPEN', warehouseId })}`), enabled: !!warehouseId, refetchInterval: 15_000 });

  const open = useAction((tableId: string) => post<PosTabDetail>('/pos/tabs', { warehouseId, tableId }), { invalidate: KEYS, onSuccess: (t) => setTabId(t.id) });
  const tableTabIds = new Set((tables.data ?? []).map((t) => t.openTab?.id).filter(Boolean));
  const loose = (tabs.data ?? []).filter((t) => !tableTabIds.has(t.id));

  return (
    <>
      <PageHeader
        title="Meja & pesanan"
        extra={
          <Space wrap>
            {(warehouses?.length ?? 0) > 1 && <Select style={{ width: 200 }} value={warehouseId} onChange={setWh} options={warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />}
            <Button icon={<PlusOutlined />} type="primary" onClick={() => setNewOpen(true)}>
              Pesanan bawa pulang / antar
            </Button>
            <Button onClick={() => setOnlineOpen(true)}>Pesanan online</Button>
            {canManage && (
              <Button icon={<SettingOutlined />} onClick={() => setManage(true)}>
                Atur meja
              </Button>
            )}
          </Space>
        }
      />
      {!session.isLoading && !session.data && (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Pesanan tetap bisa dicatat dan dikirim ke dapur. Untuk menerima pembayaran, buka sesi kasir dulu di menu Kasir › Layar kasir." />
      )}
      <Card>
        {tables.isLoading ? (
          <Spin />
        ) : !(tables.data ?? []).filter((t) => t.isActive).length ? (
          <Empty description={canManage ? 'Belum ada meja. Klik "Atur meja" untuk menambah.' : 'Belum ada meja. Minta admin menambahkannya.'} />
        ) : (
          <Row gutter={[12, 12]}>
            {tables.data!.filter((t) => t.isActive).map((t) => (
              <Col key={t.id} xs={12} sm={8} md={6} xl={4}>
                <Card
                  hoverable
                  size="small"
                  onClick={() => (t.openTab ? setTabId(t.openTab.id) : open.mutate(t.id))}
                  style={{ borderColor: t.openTab ? '#fa8c16' : '#52c41a', background: t.openTab ? '#fff7e6' : '#f6ffed', minHeight: 96 }}
                >
                  <Typography.Text strong style={{ fontSize: 16 }}>{t.name}</Typography.Text>
                  <div style={{ fontSize: 12, color: '#666' }}>{t.seats ? `${t.seats} kursi` : ' '}</div>
                  {t.openTab ? (
                    <div style={{ marginTop: 4 }}>
                      <Tag color="orange">Terisi · {since(t.openTab.since)}</Tag>
                      <div style={{ fontSize: 12 }}>{t.openTab.items} menu · {fmtMoney(t.openTab.amount)}</div>
                    </div>
                  ) : (
                    <Tag color="green" style={{ marginTop: 4 }}>Kosong</Tag>
                  )}
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Card>
      {loose.length > 0 && (
        <Card title="Bawa pulang / antar / tanpa meja" style={{ marginTop: 16 }}>
          <Row gutter={[12, 12]}>
            {loose.map((t) => (
              <Col key={t.id} xs={24} sm={12} md={8} xl={6}>
                <Card hoverable size="small" onClick={() => setTabId(t.id)}>
                  <Space wrap>
                    <Typography.Text strong>{t.tableLabel ?? t.guestName ?? t.number}</Typography.Text>
                    <Tag color={t.channel ? 'purple' : undefined}>{t.channel ? ONLINE_CHANNEL_LABELS[t.channel] : POS_ORDER_TYPE_LABELS[t.orderType]}</Tag>
                    {t.pending > 0 && <Tag color="blue">{t.pending} diproses</Tag>}
                  </Space>
                  <div style={{ fontSize: 12 }}>{t.number} · {t.items} menu · {fmtMoney(t.unpaidSubtotal)} · {since(t.createdAt)}</div>
                </Card>
              </Col>
            ))}
          </Row>
        </Card>
      )}
      <NewTabModal open={newOpen} onClose={() => setNewOpen(false)} warehouseId={warehouseId} onCreated={(id) => { setNewOpen(false); setTabId(id); }} />
      <OnlineTabModal open={onlineOpen} onClose={() => setOnlineOpen(false)} warehouseId={warehouseId} onCreated={(id) => { setOnlineOpen(false); setTabId(id); }} />
      <TabDrawer tabId={tabId} onClose={() => setTabId(undefined)} session={session.data ?? null} tables={tables.data ?? []} />
      {canManage && <ManageTables open={manage} onClose={() => setManage(false)} warehouseId={warehouseId} rows={tables.data ?? []} />}
    </>
  );
}

function NewTabModal({ open, onClose, warehouseId, onCreated }: { open: boolean; onClose: () => void; warehouseId?: string; onCreated: (id: string) => void }) {
  const [form] = Form.useForm<{ orderType: PosOrderType; guestName?: string }>();
  const create = useAction(
    (v: { orderType: PosOrderType; guestName?: string }) => post<PosTabDetail>('/pos/tabs', { warehouseId, orderType: v.orderType, tableLabel: v.guestName?.trim() || undefined, guestName: v.guestName?.trim() || undefined }),
    { invalidate: KEYS, onSuccess: (t) => { form.resetFields(); onCreated(t.id); } },
  );
  return (
    <Modal title="Pesanan tanpa meja" open={open} onCancel={onClose} onOk={() => form.submit()} confirmLoading={create.isPending} okText="Buat pesanan" destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ orderType: 'TAKEAWAY' }} onFinish={(v) => create.mutate(v)}>
        <Form.Item name="orderType" label="Jenis pesanan">
          <Segmented options={POS_ORDER_TYPES.map((k) => ({ value: k, label: POS_ORDER_TYPE_LABELS[k] }))} />
        </Form.Item>
        <Form.Item name="guestName" label="Nama pemesan atau nomor antrean" rules={[{ required: true, message: 'Isi nama pemesan atau nomor antrean' }]}>
          <Input maxLength={40} placeholder="Mis. Budi / A-12" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function OnlineTabModal({ open, onClose, warehouseId, onCreated }: { open: boolean; onClose: () => void; warehouseId?: string; onCreated: (id: string) => void }) {
  const [form] = Form.useForm<{ channel: OnlineChannel; externalRef: string; guestName?: string }>();
  const create = useAction(
    (v: { channel: OnlineChannel; externalRef: string; guestName?: string }) => post<PosTabDetail>('/pos/tabs', { warehouseId, channel: v.channel, externalRef: v.externalRef.trim(), guestName: v.guestName?.trim() || undefined }),
    { invalidate: KEYS, onSuccess: (t) => { form.resetFields(); onCreated(t.id); } },
  );
  return (
    <Modal title="Catat pesanan online" open={open} onCancel={onClose} onOk={() => form.submit()} confirmLoading={create.isPending} okText="Buat pesanan" destroyOnHidden>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Untuk pesanan dari GoFood, GrabFood, ShopeeFood, atau website. Pesanan yang dikirim otomatis lewat kunci API muncul sendiri di daftar ini." />
      <Form form={form} layout="vertical" initialValues={{ channel: 'GOFOOD' }} onFinish={(v) => create.mutate(v)}>
        <Form.Item name="channel" label="Kanal" rules={[{ required: true }]}>
          <Select options={ONLINE_CHANNELS.map((c) => ({ value: c, label: ONLINE_CHANNEL_LABELS[c] }))} />
        </Form.Item>
        <Form.Item name="externalRef" label="Nomor pesanan di platform" rules={[{ required: true, message: 'Isi nomor pesanan' }]}>
          <Input maxLength={60} placeholder="Mis. GF-123456" />
        </Form.Item>
        <Form.Item name="guestName" label="Nama pemesan (opsional)">
          <Input maxLength={60} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function ManageTables({ open, onClose, warehouseId, rows }: { open: boolean; onClose: () => void; warehouseId?: string; rows: PosTableRow[] }) {
  const [form] = Form.useForm<{ code: string; name: string; seats?: number }>();
  const add = useAction((v: { code: string; name: string; seats?: number }) => post('/pos/tables', { warehouseId, ...v }), { invalidate: ['pos-tables'], success: 'Meja ditambahkan', onSuccess: () => form.resetFields() });
  const toggle = useAction((v: { id: string; isActive: boolean }) => patch(`/pos/tables/${v.id}`, { isActive: v.isActive }), { invalidate: ['pos-tables'] });
  return (
    <Modal title="Atur meja" open={open} onCancel={onClose} footer={null} width={560} destroyOnHidden>
      <Form form={form} layout="inline" onFinish={(v) => add.mutate(v)} style={{ marginBottom: 12, rowGap: 8 }}>
        <Form.Item name="code" rules={[{ required: true, message: 'Kode' }]}><Input placeholder="Kode (M07)" maxLength={20} style={{ width: 110 }} /></Form.Item>
        <Form.Item name="name" rules={[{ required: true, message: 'Nama' }]}><Input placeholder="Nama (Meja 7)" maxLength={60} style={{ width: 150 }} /></Form.Item>
        <Form.Item name="seats"><InputNumber placeholder="Kursi" min={1} max={200} precision={0} style={{ width: 80 }} /></Form.Item>
        <Button htmlType="submit" type="primary" icon={<PlusOutlined />} loading={add.isPending}>Tambah</Button>
      </Form>
      <Table<PosTableRow>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={rows}
        columns={[
          { title: 'Kode', dataIndex: 'code' },
          { title: 'Nama', dataIndex: 'name' },
          { title: 'Kursi', dataIndex: 'seats', render: (v: number | null) => v ?? '-' },
          { title: 'Aktif', render: (_: unknown, r) => <Switch size="small" checked={r.isActive} disabled={!!r.openTab} onChange={(v) => toggle.mutate({ id: r.id, isActive: v })} /> },
        ]}
      />
    </Modal>
  );
}
