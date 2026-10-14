import { CheckCircleOutlined, DeleteOutlined, PlusOutlined, PrinterOutlined, SendOutlined, SettingOutlined, SwapOutlined } from '@ant-design/icons';
import { ONLINE_CHANNEL_LABELS, ONLINE_CHANNELS, type OnlineChannel, POS_CASHIER_PAYMENT_METHODS, POS_ORDER_TYPE_LABELS, POS_ORDER_TYPES, POS_PAYMENT_LABELS, type PosOrderType, type PosPaymentMethod } from '@sansu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Col, Divider, Drawer, Empty, Form, Input, InputNumber, Modal, Row, Segmented, Select, Space, Spin, Switch, Table, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { get, patch, post, qs } from '@/api/client';
import { LEDGER_KEYS, useAction, useWarehouses } from '@/api/queries';
import type { PosOrder, PosProduct, PosSession, PosTabDetail, PosTabLine, PosTabLineStatus, PosTabSummary, PosTableRow } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney, fmtQty } from '@/lib/format';
import { posTax, vatTotals } from '@/lib/vat';
import Receipt, { printReceipt } from './Receipt';

const KEYS = ['pos-tables', 'pos-tabs', 'pos-tab', 'pos-kitchen', 'pos-products', 'pos-session', 'stock', ...LEDGER_KEYS];

export const LINE_STATUS: Record<PosTabLineStatus, { label: string; color: string }> = {
  DRAFT: { label: 'Belum dikirim', color: 'default' },
  NEW: { label: 'Antre di dapur', color: 'blue' },
  PREPARING: { label: 'Dimasak', color: 'orange' },
  READY: { label: 'Siap diantar', color: 'green' },
  SERVED: { label: 'Disajikan', color: 'cyan' },
  VOID: { label: 'Dibatalkan', color: 'red' },
};

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

function TabDrawer({ tabId, onClose, session, tables }: { tabId?: string; onClose: () => void; session: PosSession | null; tables: PosTableRow[] }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const supervisor = ['OWNER', 'ADMIN', 'FINANCE'].includes(me?.role ?? '');
  const detail = useQuery({ queryKey: ['pos-tab', tabId], queryFn: () => get<PosTabDetail>(`/pos/tabs/${tabId}`), enabled: !!tabId, refetchInterval: 10_000 });
  const tab = detail.data;
  const products = useQuery({ queryKey: ['pos-products', tab?.warehouseId], queryFn: () => get<PosProduct[]>(`/pos/products${qs({ warehouseId: tab?.warehouseId })}`), enabled: !!tab });
  const [productId, setProductId] = useState<string>();
  const [count, setCount] = useState<number | null>(1);
  const [notes, setNotes] = useState('');
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<PosOrder | null>(null);
  const [voidLine, setVoidLine] = useState<PosTabLine | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  const refresh = { invalidate: KEYS };
  const add = useAction(() => post(`/pos/tabs/${tabId}/lines`, { lines: [{ productId, qty: String(count ?? 1), notes: notes.trim() || undefined }] }), { ...refresh, onSuccess: () => { setProductId(undefined); setCount(1); setNotes(''); } });
  const send = useAction(() => post(`/pos/tabs/${tabId}/send`), { ...refresh, success: 'Pesanan dikirim ke dapur' });
  const void_ = useAction((l: PosTabLine) => post(`/pos/tabs/${tabId}/lines/${l.id}/void`, { reason: voidReason.trim() || undefined }), { ...refresh, success: 'Baris dibatalkan', onSuccess: () => { setVoidLine(null); setVoidReason(''); } });
  const cancel = useAction(() => post(`/pos/tabs/${tabId}/cancel`, { reason: voidReason.trim() }), { ...refresh, success: 'Pesanan dibatalkan', onSuccess: () => { setCancelOpen(false); setVoidReason(''); onClose(); } });
  const move = useAction((v: { tableId?: string; tableLabel?: string }) => patch(`/pos/tabs/${tabId}/move`, v), { ...refresh, success: 'Meja dipindah', onSuccess: () => setMoveOpen(false) });

  const items = useMemo(() => (products.data ?? []).filter((p) => p.inventoryKind !== 'SEMI').map((p) => ({ value: p.id, label: `${p.name} · ${fmtMoney(p.sellPrice)}${p.madeToOrder ? ` · ${fmtQty(Number(p.stock))} porsi` : ` · stok ${fmtQty(Number(p.stock))}`}`, disabled: Number(p.stock) <= 0 })), [products.data]);
  const live = tab?.lines.filter((l) => l.status !== 'VOID') ?? [];
  const unpaid = live.filter((l) => !l.paidOrderId);
  const closed = !!tab && tab.status !== 'OPEN';
  const needReason = !!voidLine && voidLine.status !== 'DRAFT';

  return (
    <Drawer
      open={!!tabId}
      onClose={onClose}
      width={Math.min(720, typeof window === 'undefined' ? 720 : window.innerWidth)}
      title={tab ? `${tab.tableLabel ?? tab.guestName ?? tab.number} · ${tab.number}` : 'Pesanan'}
      destroyOnHidden
      extra={tab && <Tag color={tab.status === 'OPEN' ? 'orange' : tab.status === 'PAID' ? 'green' : 'red'}>{tab.status === 'OPEN' ? 'Terbuka' : tab.status === 'PAID' ? 'Lunas' : 'Dibatalkan'}</Tag>}
    >
      {!tab ? (
        <Spin />
      ) : (
        <>
          <Space wrap style={{ marginBottom: 12 }}>
            <Tag color={tab.channel ? 'purple' : undefined}>{tab.channel ? `${ONLINE_CHANNEL_LABELS[tab.channel]} · ${tab.externalRef}` : POS_ORDER_TYPE_LABELS[tab.orderType]}</Tag>
            {tab.guestName && <Tag>{tab.guestName}</Tag>}
            {tab.cancelReason && <Typography.Text type="secondary">Alasan batal: {tab.cancelReason}</Typography.Text>}
          </Space>
          {!closed && (
            <Card size="small" style={{ marginBottom: 12 }} title="Tambah menu">
              <Space wrap style={{ width: '100%' }}>
                <Select showSearch optionFilterProp="label" placeholder="Pilih menu" style={{ width: 280, maxWidth: '100%' }} value={productId} onChange={setProductId} options={items} loading={products.isLoading} />
                <InputNumber min={1} max={9999} precision={0} value={count} onChange={setCount} style={{ width: 80 }} />
                <Input placeholder="Catatan (tanpa gula, pedas…)" maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: 220, maxWidth: '100%' }} />
                <Button type="primary" icon={<PlusOutlined />} disabled={!productId || !count} loading={add.isPending} onClick={() => add.mutate()}>Tambah</Button>
              </Space>
            </Card>
          )}
          <Table<PosTabLine>
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={tab.lines}
            locale={{ emptyText: <Empty description="Belum ada menu" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            scroll={{ x: 560 }}
            columns={[
              { title: 'Menu', render: (_: unknown, l) => <span><Typography.Text delete={l.status === 'VOID'}>{l.product.name}</Typography.Text>{l.notes && <div style={{ fontSize: 12, color: '#888' }}>{l.notes}</div>}{l.voidReason && <div style={{ fontSize: 12, color: '#cf1322' }}>Batal: {l.voidReason}</div>}</span> },
              { title: 'Jml', align: 'right', render: (_: unknown, l) => fmtQty(Number(l.qty)) },
              { title: 'Harga', align: 'right', render: (_: unknown, l) => fmtMoney(Number(l.qty) * Number(l.product.sellPrice)) },
              { title: 'Status', render: (_: unknown, l) => (l.paidOrderId ? <Tag color="green" icon={<CheckCircleOutlined />}>Dibayar</Tag> : <Tag color={LINE_STATUS[l.status].color}>{LINE_STATUS[l.status].label}</Tag>) },
              ...(!closed ? [{ title: '', render: (_: unknown, l: PosTabLine) => (l.status !== 'VOID' && !l.paidOrderId ? <Button size="small" danger type="text" icon={<DeleteOutlined />} aria-label="Batalkan baris" onClick={() => { setVoidReason(''); if (l.status === 'DRAFT') void_.mutate(l); else setVoidLine(l); }} /> : null) }] : []),
            ]}
          />
          <Divider style={{ margin: '12px 0' }} />
          <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
            <div>
              <div>Belum dibayar (sebelum pajak): <strong>{fmtMoney(tab.unpaidSubtotal)}</strong></div>
              {Number(tab.paidSubtotal) > 0 && <div style={{ fontSize: 12, color: '#666' }}>Sudah dibayar: {fmtMoney(tab.paidSubtotal)}</div>}
            </div>
            {!closed && (
              <Space wrap>
                <Button icon={<SwapOutlined />} onClick={() => setMoveOpen(true)}>Pindah meja</Button>
                <Button danger onClick={() => { setVoidReason(''); setCancelOpen(true); }}>Batalkan pesanan</Button>
                <Button icon={<SendOutlined />} disabled={!tab.draftCount} loading={send.isPending} onClick={() => send.mutate()}>Kirim ke dapur{tab.draftCount ? ` (${tab.draftCount})` : ''}</Button>
                <Button type="primary" disabled={!unpaid.length || !session} onClick={() => setPaying(true)} title={session ? undefined : 'Buka sesi kasir dulu'}>{tab.channel ? 'Selesai (dibayar platform)' : 'Bayar…'}</Button>
              </Space>
            )}
          </Space>
          {!closed && !session && <Alert type="warning" showIcon style={{ marginTop: 12 }} message="Belum ada sesi kasir terbuka, jadi pembayaran belum bisa diterima." />}
          <PayModal open={paying} onClose={() => setPaying(false)} tab={tab} session={session} onPaid={(o) => { setPaying(false); setReceipt(o); qc.invalidateQueries({ queryKey: ['pos-tab', tabId] }); }} />
          <Modal title={needReason ? 'Batalkan menu yang sudah dikirim' : 'Batalkan baris'} open={needReason} onCancel={() => setVoidLine(null)} onOk={() => voidLine && void_.mutate(voidLine)} confirmLoading={void_.isPending} okButtonProps={{ danger: true, disabled: voidReason.trim().length < 5 }} okText="Batalkan menu" destroyOnHidden>
            <Alert type={voidLine && ['PREPARING', 'READY', 'SERVED'].includes(voidLine.status) && !supervisor ? 'error' : 'warning'} showIcon style={{ marginBottom: 12 }} message={voidLine && ['PREPARING', 'READY', 'SERVED'].includes(voidLine.status) ? (supervisor ? 'Menu ini sudah dimasak atau disajikan. Pembatalan dicatat dan ditinjau pemilik.' : 'Menu ini sudah dimasak atau disajikan: hanya supervisor (Pemilik, Admin, Keuangan) yang boleh membatalkan.') : 'Dapur akan melihat menu ini dibatalkan.'} />
            <Input.TextArea rows={3} maxLength={200} placeholder="Alasan (minimal 5 huruf)" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
          </Modal>
          <Modal title="Batalkan seluruh pesanan" open={cancelOpen} onCancel={() => setCancelOpen(false)} onOk={() => cancel.mutate()} confirmLoading={cancel.isPending} okButtonProps={{ danger: true, disabled: voidReason.trim().length < 5 }} okText="Batalkan pesanan" destroyOnHidden>
            <Input.TextArea rows={3} maxLength={200} placeholder="Alasan (minimal 5 huruf)" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
          </Modal>
          <Modal title="Pindah meja" open={moveOpen} onCancel={() => setMoveOpen(false)} footer={null} destroyOnHidden>
            <Space wrap>
              {tables.filter((t) => t.isActive && t.warehouseId === tab.warehouseId && !t.openTab).map((t) => (
                <Button key={t.id} onClick={() => move.mutate({ tableId: t.id })} loading={move.isPending}>{t.name}</Button>
              ))}
              {!tables.some((t) => t.isActive && !t.openTab) && <Typography.Text type="secondary">Tidak ada meja kosong.</Typography.Text>}
            </Space>
          </Modal>
          <Modal
            title="Struk"
            open={!!receipt}
            onCancel={() => setReceipt(null)}
            footer={[<Button key="p" icon={<PrinterOutlined />} onClick={printReceipt}>Cetak struk</Button>, <Button key="c" type="primary" onClick={() => setReceipt(null)}>Selesai</Button>]}
            width={360}
            destroyOnHidden
          >
            {receipt && (
              <>
                {Number(receipt.change) > 0 && <Alert type="success" showIcon style={{ marginBottom: 12 }} message={<strong>Kembalian {fmtMoney(receipt.change)}</strong>} />}
                <Receipt order={receipt} company={me?.tenantName ?? ''} cashier={me?.name ?? ''} warehouse={tab.warehouse?.name ?? ''} />
              </>
            )}
          </Modal>
        </>
      )}
    </Drawer>
  );
}

function PayModal({ open, onClose, tab, session, onPaid }: { open: boolean; onClose: () => void; tab: PosTabDetail; session: PosSession | null; onPaid: (o: PosOrder) => void }) {
  const { me } = useAuth();
  const { rate, label } = posTax(me);
  const inclusive = !!me?.taxProfile?.posPricesIncludeVat && rate > 0;
  const unpaid = tab.lines.filter((l) => l.status !== 'VOID' && !l.paidOrderId);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [method, setMethod] = useState<PosPaymentMethod>('CASH');
  const [amount, setAmount] = useState<number | null>(null);
  const ids = picked ?? unpaid.map((l) => l.id);
  const sum = unpaid.filter((l) => ids.includes(l.id)).reduce((a, l) => a + Number(l.qty) * Number(l.product.sellPrice), 0);
  const { total } = vatTotals(sum, rate, inclusive);
  const enough = method === 'CASH' ? (amount ?? 0) >= total : true;
  const pay = useAction(
    () => post<PosOrder>(`/pos/tabs/${tab.id}/pay`, { sessionId: session!.id, lineIds: ids.length === unpaid.length ? undefined : ids, payments: [{ method, amount: (method === 'CASH' ? (amount ?? 0) : total).toFixed(2) }] }),
    { invalidate: KEYS, onSuccess: (o) => { setPicked(null); setAmount(null); onPaid(o); } },
  );
  const unsent = unpaid.filter((l) => ids.includes(l.id) && l.status === 'DRAFT').length;
  const payOnline = useAction(() => post<PosOrder>(`/pos/tabs/${tab.id}/pay`, { sessionId: session!.id }), { invalidate: KEYS, onSuccess: (o) => onPaid(o) });
  const commissions = useQuery({ queryKey: ['pos-online-settings'], queryFn: () => get<{ commissions: Record<string, number> }>('/pos/online/settings'), enabled: !!tab.channel });
  if (tab.channel) {
    const pct = commissions.data?.commissions[tab.channel] ?? 0;
    const fee = Math.round(((sum * pct) / 100) * 100) / 100;
    return (
      <Modal title={`Selesaikan pesanan ${ONLINE_CHANNEL_LABELS[tab.channel]}`} open={open} onCancel={onClose} onOk={() => payOnline.mutate()} okText="Selesai" confirmLoading={payOnline.isPending} okButtonProps={{ disabled: !session || unsent > 0 }} destroyOnHidden>
        <Typography.Paragraph>
          Pesanan ini dibayar oleh platform, bukan oleh pelanggan di kasir. Penjualan dicatat sebagai <strong>piutang platform</strong> (dikurangi komisi). Saat dana dari platform masuk, catat di <strong>Pesanan online › Pencairan</strong>.
        </Typography.Paragraph>
        <div>Total termasuk {label} {rate}%: <strong>{fmtMoney(total)}</strong></div>
        <div>Komisi {ONLINE_CHANNEL_LABELS[tab.channel]} ({pct}% dari harga menu): <strong>{fmtMoney(fee)}</strong></div>
        <div>Perkiraan diterima dari platform: <strong>{fmtMoney(total - fee)}</strong></div>
        {unsent > 0 && <Alert type="warning" showIcon style={{ marginTop: 12 }} message="Ada menu yang belum dikirim ke dapur. Kirim dulu." />}
      </Modal>
    );
  }
  return (
    <Modal title="Pembayaran" open={open} onCancel={onClose} onOk={() => pay.mutate()} okText="Terima pembayaran" confirmLoading={pay.isPending} okButtonProps={{ disabled: !ids.length || !enough || unsent > 0 || !session }} destroyOnHidden>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>Pilih menu yang dibayar sekarang. Bayar sebagian untuk pisah bill; sisanya tetap terbuka.</Typography.Paragraph>
      <Checkbox.Group style={{ width: '100%' }} value={ids} onChange={(v) => setPicked(v as string[])}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {unpaid.map((l) => (
            <Checkbox key={l.id} value={l.id} style={{ width: '100%' }}>
              {fmtQty(Number(l.qty))} × {l.product.name} — {fmtMoney(Number(l.qty) * Number(l.product.sellPrice))}
              {l.status === 'DRAFT' && <Tag color="red" style={{ marginLeft: 8 }}>belum dikirim</Tag>}
            </Checkbox>
          ))}
        </Space>
      </Checkbox.Group>
      <Divider style={{ margin: '12px 0' }} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: '#666' }}>Total termasuk {label} {rate}%</div>
        <Typography.Title level={3} style={{ margin: 0 }}>{fmtMoney(total)}</Typography.Title>
      </div>
      <Segmented block style={{ margin: '12px 0' }} value={method} onChange={(v) => { setMethod(v as PosPaymentMethod); setAmount(null); }} options={POS_CASHIER_PAYMENT_METHODS.map((k) => ({ value: k, label: POS_PAYMENT_LABELS[k] }))} />
      {method === 'CASH' && (
        <>
          <InputNumber style={{ width: '100%' }} min={0} prefix="Rp" placeholder="Uang diterima" value={amount} onChange={setAmount} />
          {(amount ?? 0) >= total && total > 0 && <div style={{ marginTop: 6 }}>Kembalian: <strong>{fmtMoney((amount ?? 0) - total)}</strong></div>}
        </>
      )}
      {unsent > 0 && <Alert type="warning" showIcon style={{ marginTop: 12 }} message="Ada menu yang belum dikirim ke dapur. Kirim dulu sebelum dibayar." />}
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
