import { CheckCircleOutlined, DeleteOutlined, PlusOutlined, PrinterOutlined, SendOutlined, SwapOutlined } from '@ant-design/icons';
import { ONLINE_CHANNEL_LABELS, POS_ORDER_TYPE_LABELS } from '@sansu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Divider, Drawer, Empty, Input, InputNumber, Modal, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { get, patch, post, qs } from '@/api/client';
import { useAction } from '@/api/queries';
import type { PosOrder, PosProduct, PosSession, PosTabDetail, PosTabLine, PosTabLineStatus, PosTableRow } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { fmtMoney, fmtQty } from '@/lib/format';
import Receipt, { printReceipt } from '../Receipt';
import { KEYS } from './shared';
import { PayModal } from './PayModal';

export const LINE_STATUS: Record<PosTabLineStatus, { label: string; color: string }> = {
  DRAFT: { label: 'Belum dikirim', color: 'default' },
  NEW: { label: 'Antre di dapur', color: 'blue' },
  PREPARING: { label: 'Dimasak', color: 'orange' },
  READY: { label: 'Siap diantar', color: 'green' },
  SERVED: { label: 'Disajikan', color: 'cyan' },
  VOID: { label: 'Dibatalkan', color: 'red' },
};

export function TabDrawer({ tabId, onClose, session, tables }: { tabId?: string; onClose: () => void; session: PosSession | null; tables: PosTableRow[] }) {
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
          <PayModal open={paying} onClose={() => setPaying(false)} tab={tab} session={session} onPaid={(o) => { setPaying(false); setReceipt(o); void qc.invalidateQueries({ queryKey: ['pos-tab', tabId] }); }} />
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
