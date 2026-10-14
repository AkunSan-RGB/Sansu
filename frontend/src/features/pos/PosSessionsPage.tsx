import { DollarOutlined } from '@ant-design/icons';
import { POS_PAYMENT_LABELS, type PosPaymentMethod } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Empty, Form, Input, InputNumber, Modal, Radio, Segmented, Space, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, qs } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import type { PosOrder, PosSession } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import ResponsiveTable from '@/components/ResponsiveTable';
import SummaryCards from '@/components/SummaryCards';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney } from '@/lib/format';
import Receipt, { printReceipt } from './Receipt';
import { t } from '@/lib/terms';

const dt = (v?: string | null) => (v ? dayjs(v).format('DD MMM YYYY HH:mm') : '-');

function SessionOrders({ sessionId, onOpen }: { sessionId: string; onOpen: (id: string) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['pos-orders', sessionId], queryFn: () => get<PosOrder[]>(`/pos/orders${qs({ sessionId })}`) });
  return (
    <Table
      rowKey="id"
      size="small"
      loading={isLoading}
      dataSource={data}
      pagination={{ pageSize: 20, hideOnSinglePage: true }}
      onRow={(o) => ({ onClick: () => onOpen(o.id), style: { cursor: 'pointer' } })}
      columns={[
        { title: 'Nomor', dataIndex: 'number' },
        { title: 'Waktu', dataIndex: 'createdAt', render: (v) => dayjs(v).format('HH:mm') },
        { title: t('Pelanggan'), render: (_, o) => o.customer?.name ?? 'Umum' },
        { title: 'Bayar', render: (_, o) => o.payments.map((p) => <Tag key={p.id}>{POS_PAYMENT_LABELS[p.method as PosPaymentMethod]}</Tag>) },
        { title: 'Total', dataIndex: 'total', align: 'right', render: fmtMoney },
      ]}
    />
  );
}

/** Retur / pembatalan penjualan kasir — hanya supervisor */
function ReturnModal({ order, onClose }: { order: PosOrder | undefined; onClose: () => void }) {
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [form] = Form.useForm<{ reason: string; refundMethod: 'CASH' | 'BANK' }>();
  useEffect(() => {
    if (!order) return;
    setQtys(Object.fromEntries((order.lines ?? []).map((l) => [l.id, Math.max(0, Number(l.qty) - Number(l.returnedQty ?? 0))])));
    form.setFieldsValue({ refundMethod: order.payments.some((p) => p.method === 'CASH') ? 'CASH' : 'BANK', reason: '' });
  }, [order, form]);
  const submit = useAction(
    (v: { reason: string; refundMethod: 'CASH' | 'BANK' }) =>
      post(`/pos/orders/${order!.id}/return`, { reason: v.reason, refundMethod: v.refundMethod, lines: Object.entries(qtys).filter(([, q]) => q > 0).map(([orderLineId, q]) => ({ orderLineId, qty: String(q) })) }),
    { success: 'Retur dicatat: stok kembali & jurnal dibalik', invalidate: ['pos-orders', 'pos-order', 'pos-sessions', 'pos', ...LEDGER_KEYS], onSuccess: onClose },
  );
  const any = Object.values(qtys).some((q) => q > 0);
  return (
    <Modal title={`Retur ${order?.number ?? ''}`} open={!!order} onCancel={onClose} onOk={() => form.submit()} okText="Proses retur" okButtonProps={{ danger: true, disabled: !any }} confirmLoading={submit.isPending} width={560}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Stok kembali ke toko pada HPP saat dijual, jurnal penjualan & HPP dibalik, dan uang dikembalikan. Alasan tercatat di jejak audit." />
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={order?.lines ?? []}
        columns={[
          { title: 'Barang', render: (_, l) => l.product.name },
          { title: 'Sisa', align: 'right', render: (_, l) => Math.max(0, Number(l.qty) - Number(l.returnedQty ?? 0)) },
          {
            title: 'Diretur',
            align: 'right',
            render: (_, l) => {
              const rest = Math.max(0, Number(l.qty) - Number(l.returnedQty ?? 0));
              return <InputNumber size="small" min={0} max={rest} disabled={rest <= 0} value={qtys[l.id] ?? 0} onChange={(v) => setQtys((q) => ({ ...q, [l.id]: Number(v ?? 0) }))} style={{ width: 80 }} />;
            },
          },
        ]}
      />
      <Form form={form} layout="vertical" style={{ marginTop: 12 }} onFinish={(v) => submit.mutate(v)}>
        <Form.Item name="refundMethod" label="Uang dikembalikan lewat">
          <Radio.Group options={[{ label: 'Tunai (laci kasir)', value: 'CASH' }, { label: 'Rekening / non-tunai', value: 'BANK' }]} />
        </Form.Item>
        <Form.Item name="reason" label="Alasan retur" rules={[{ required: true, min: 5, message: 'Isi alasan (min. 5 karakter)' }]}>
          <Input.TextArea rows={2} maxLength={300} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default function PosSessionsPage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const [orderId, setOrderId] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const supervisor = me?.role === 'OWNER' || me?.role === 'ADMIN' || me?.role === 'FINANCE';
  const controls = useQuery({ queryKey: ['pos', 'controls'], queryFn: () => get<{ items: { key: string; level: 'error' | 'warning' | 'info'; title: string; detail: string }[] }>('/pos/controls'), enabled: supervisor });
  const { data, isLoading } = useQuery({ queryKey: ['pos-sessions'], queryFn: () => get<PosSession[]>('/pos/sessions') });
  const [view, setView] = useState<'ALL' | 'OPEN' | 'CLOSED' | 'DIFF'>('ALL');
  const [search, setSearch] = useState('');
  const all = data ?? [];
  const tests = {
    ALL: () => true,
    OPEN: (s: PosSession) => s.status === 'OPEN',
    CLOSED: (s: PosSession) => s.status !== 'OPEN',
    DIFF: (s: PosSession) => s.difference != null && Number(s.difference) !== 0,
  };
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all.filter((s) => tests[view](s) && (!term || `${s.number} ${s.user?.name ?? ''} ${s.warehouse.name}`.toLowerCase().includes(term)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, view, search]);
  const order = useQuery({ queryKey: ['pos-order', orderId], queryFn: () => get<PosOrder>(`/pos/orders/${orderId}`), enabled: !!orderId });

  return (
    <>
      <PageHeader
        title="Riwayat sesi kasir"
        extra={
          <Button type="primary" icon={<DollarOutlined />} onClick={() => navigate('/pos')}>
            Buka layar kasir
          </Button>
        }
      />
      {!!controls.data?.items.length && (
        <Card size="small" title="Kontrol kasir (30 hari terakhir)" style={{ marginBottom: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            {controls.data.items.map((c) => (
              <Alert key={c.key} type={c.level} showIcon message={c.title} description={c.detail} />
            ))}
          </Space>
        </Card>
      )}
      {!isLoading && all.length > 0 && (
        <SummaryCards
          items={[
            { label: 'Total penjualan', value: fmtMoney(all.reduce((a, s) => a + Number(s.totalSales ?? 0), 0)), hint: `${all.length} sesi` },
            { label: 'Kasir sedang buka', value: String(all.filter(tests.OPEN).length), hint: 'sesi belum ditutup', tone: all.some(tests.OPEN) ? 'good' : 'neutral' },
            { label: 'Sesi dengan selisih kas', value: String(all.filter(tests.DIFF).length), hint: 'uang di laci tidak sama', tone: all.some(tests.DIFF) ? 'warn' : 'neutral' },
          ]}
        />
      )}
      <Card>
        <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
          <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
            <Segmented
              value={view}
              onChange={(v) => setView(v as typeof view)}
              options={[
                { value: 'ALL', label: `Semua (${all.length})` },
                { value: 'OPEN', label: `Sedang buka (${all.filter(tests.OPEN).length})` },
                { value: 'CLOSED', label: `Sudah tutup (${all.filter(tests.CLOSED).length})` },
                { value: 'DIFF', label: `Ada selisih (${all.filter(tests.DIFF).length})` },
              ]}
            />
          </div>
          <Input.Search allowClear placeholder="Cari kasir, toko, atau nomor sesi" style={{ width: 260 }} onChange={(e) => setSearch(e.target.value)} />
        </Space>
        <ResponsiveTable<PosSession>
          rowKey="id"
          loading={isLoading}
          dataSource={shown}
          scroll={{ x: 1000 }}
          locale={{ emptyText: <Empty description={search || view !== 'ALL' ? 'Tidak ada data yang cocok dengan pilihan ini' : 'Belum ada sesi kasir'} /> }}
          expandable={{ expandedRowRender: (s) => <SessionOrders sessionId={s.id} onOpen={setOrderId} />, rowExpandable: (s) => (s.orderCount ?? 0) > 0 }}
          columns={[
            { title: 'Sesi', dataIndex: 'number' },
            { title: 'Kasir', render: (_, s) => s.user?.name },
            { title: 'Toko', render: (_, s) => s.warehouse.name },
            { title: 'Buka', dataIndex: 'openedAt', render: dt },
            { title: 'Tutup', dataIndex: 'closedAt', render: dt },
            { title: 'Status', dataIndex: 'status', render: (s) => (s === 'OPEN' ? <Tag color="green">Buka</Tag> : <Tag>Tutup</Tag>) },
            { title: 'Transaksi', dataIndex: 'orderCount', align: 'right' },
            { title: t('Penjualan'), dataIndex: 'totalSales', align: 'right', render: fmtMoney },
            {
              title: 'Selisih kas',
              dataIndex: 'difference',
              align: 'right',
              render: (v) =>
                v == null ? '-' : <Typography.Text type={Number(v) < 0 ? 'danger' : Number(v) > 0 ? 'warning' : 'success'}>{fmtMoney(v)}</Typography.Text>,
            },
          ]}
        />
      </Card>
      <Modal
        open={!!orderId}
        title={order.data?.number}
        onCancel={() => setOrderId(null)}
        width={380}
        footer={
          <Space>
            {supervisor && (
              <Button danger onClick={() => setReturning(true)}>
                Retur / batalkan
              </Button>
            )}
            <Button icon={<DollarOutlined />} onClick={printReceipt}>
              Cetak ulang struk
            </Button>
          </Space>
        }
      >
        {order.data && (
          <Receipt
            order={order.data}
            company={me?.tenantName ?? ''}
            cashier={order.data.session?.user.name ?? ''}
            warehouse={order.data.session?.warehouse.name ?? ''}
          />
        )}
      </Modal>
      <ReturnModal order={returning ? order.data : undefined} onClose={() => setReturning(false)} />
    </>
  );
}
