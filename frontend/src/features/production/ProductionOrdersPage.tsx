/** Perintah produksi: rencana → mulai (bahan keluar) → selesai (produk jadi masuk) / batal */
import { CheckOutlined, PlayCircleOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { PRODUCTION_STATUS_LABELS, type Bom, type ProductionOrder, type ProductionStatus } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import { get, post } from '@/api/client';
import { LEDGER_KEYS, useAction, useWarehouses } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ListPage from '@/components/ListPage';
import { fmtDate, fmtMoney, fmtQty, today } from '@/lib/format';
import { t } from '@/lib/terms';

const COLOR: Record<ProductionStatus, string> = {
  DRAFT: 'default',
  IN_PROGRESS: 'gold',
  COMPLETED: 'green',
  CANCELLED: 'red',
};
const INVALIDATE = ['production', 'balances', 'stock-moves', 'inventory', 'boms', ...LEDGER_KEYS];

export default function ProductionOrdersPage() {
  const can = useCan();
  const q = useQuery({
    queryKey: ['production', 'orders'],
    queryFn: () => get<ProductionOrder[]>('/production/orders'),
  });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <ListPage<ProductionOrder>
        title="Perintah produksi"
        actions={
          can('POST', '/production/orders') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              Produksi baru
            </Button>
          )
        }
        rows={q.data}
        loading={q.isLoading}
        summary={(rows) => {
          const running = rows.filter((o) => o.status === 'IN_PROGRESS');
          const planned = rows.filter((o) => o.status === 'DRAFT');
          const done = rows.filter((o) => o.status === 'COMPLETED');
          return [
            { label: 'Sedang diproduksi', value: String(running.length), hint: 'bahan sudah keluar, belum selesai', tone: running.length ? 'warn' : 'neutral' },
            { label: 'Masih rencana', value: String(planned.length), hint: 'belum dimulai' },
            { label: 'Selesai', value: String(done.length), hint: 'produk jadi sudah masuk gudang', tone: done.length ? 'good' : 'neutral' },
          ];
        }}
        views={[
          { value: 'ALL', label: 'Semua', test: () => true },
          { value: 'IN_PROGRESS', label: 'Sedang diproduksi', test: (o) => o.status === 'IN_PROGRESS' },
          { value: 'DRAFT', label: 'Rencana', test: (o) => o.status === 'DRAFT' },
          { value: 'COMPLETED', label: 'Selesai', test: (o) => o.status === 'COMPLETED' },
          { value: 'CANCELLED', label: 'Dibatalkan', test: (o) => o.status === 'CANCELLED' },
        ]}
        searchText={(o) => `${o.number} ${o.product.sku} ${o.product.name} ${o.warehouse.name}`}
        searchPlaceholder="Cari nomor atau produk"
        emptyText={t("Belum ada perintah produksi. Buat resep dulu, lalu klik Produksi baru.")}
        onRowClick={(r) => setOpenId(r.id)}
        scrollX={1000}
        columns={[
          {
            title: 'Nomor',
            dataIndex: 'number',
            render: (n, o) => (
              <Space size={4} wrap>
                {n}
                {o.parentNumber && <Tag color="purple">Untuk {o.parentNumber}</Tag>}
                {!!o.childCount && <Tag color="blue">{o.childCount} perintah setengah jadi</Tag>}
              </Space>
            ),
          },
          { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
          { title: t('Produk'), render: (_, o) => `${o.product.sku} · ${o.product.name}` },
          { title: 'Rencana', align: 'right', render: (_, o) => `${fmtQty(o.plannedQty)} ${o.product.unit}` },
          {
            title: 'Hasil',
            align: 'right',
            render: (_, o) => (o.status === 'COMPLETED' ? `${fmtQty(o.outputQty)} ${o.product.unit}` : '-'),
          },
          {
            title: 'Harga pokok / unit',
            align: 'right',
            render: (_, o) => (o.status === 'COMPLETED' ? fmtMoney(o.unitCost) : '-'),
          },
          { title: t('Gudang'), render: (_, o) => o.warehouse.name },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (s: ProductionStatus) => <Tag color={COLOR[s]}>{PRODUCTION_STATUS_LABELS[s]}</Tag>,
          },
        ]}
      />
      <CreateModal open={creating} onClose={() => setCreating(false)} onCreated={(o) => setOpenId(o.id)} />
      {openId && <OrderDrawer id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function CreateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (o: ProductionOrder) => void;
}) {
  const [form] = Form.useForm();
  const boms = useQuery({ queryKey: ['boms'], queryFn: () => get<Bom[]>('/production/boms'), enabled: open });
  const { data: warehouses } = useWarehouses();
  const bomId = Form.useWatch('bomId', form);
  const batches = Form.useWatch('batches', form) ?? 0;
  const bom = boms.data?.find((b) => b.id === bomId);
  useEffect(() => {
    if (open) form.setFieldsValue({ date: today(), batches: 1, warehouseId: warehouses?.[0]?.id });
  }, [open, warehouses, form]);
  const save = useAction(
    (v: { bomId: string; warehouseId: string; date: string; batches: number; notes?: string }) =>
      post<ProductionOrder>('/production/orders', { ...v, batches: String(v.batches) }),
    {
      success: (o) => `${o.number} dibuat`,
      invalidate: ['production'],
      onSuccess: (o) => {
        onClose();
        onCreated(o);
      },
    },
  );
  return (
    <Modal
      title="Perintah produksi baru"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={save.isPending}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
        <Form.Item name="bomId" label={t("Resep")} rules={[{ required: true }]}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={boms.isLoading}
            options={(boms.data ?? [])
              .filter((b) => b.isActive)
              .map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))}
            notFoundContent={t("Belum ada resep — buat di Produksi › Resep (BOM)")}
          />
        </Form.Item>
        <Space wrap>
          <Form.Item name="batches" label="Jumlah batch" rules={[{ required: true }]}>
            <InputNumber min={0.0001} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="warehouseId" label={t('Gudang (bahan & hasil)')} rules={[{ required: true }]}>
            <Select style={{ width: 220 }} options={warehouses?.map((w) => ({ value: w.id, label: w.name }))} />
          </Form.Item>
          <Form.Item name="date" label="Tanggal">
            <Input type="date" />
          </Form.Item>
        </Space>
        {bom && (
          <Alert
            type="info"
            showIcon
            message={`Rencana hasil ${fmtQty(Number(bom.outputQty) * batches)} ${bom.product.unit} ${bom.product.name} · taksiran harga pokok ${fmtMoney(Number(bom.estimate.batchCost) * batches)}`}
            description={bom.lines.map((l) => `${l.name} ${fmtQty(Number(l.qty) * batches)} ${l.unit}`).join(' · ')}
          />
        )}
        <Form.Item name="notes" label="Catatan" style={{ marginTop: 12 }}>
          <Input placeholder="Mis. pesanan PT ABC / stok musim lebaran" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function OrderDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const can = useCan();
  const { modal } = App.useApp();
  const q = useQuery({
    queryKey: ['production', 'order', id],
    queryFn: () => get<ProductionOrder>(`/production/orders/${id}`),
  });
  const o = q.data;
  const [issue, setIssue] = useState<Record<string, number | null>>({});
  const [doneForm] = Form.useForm();
  const [startDate, setStartDate] = useState(today());
  useEffect(() => {
    if (o) {
      setIssue(Object.fromEntries(o.lines.map((l) => [l.productId, Number(l.plannedQty)])));
      if (o.status === 'IN_PROGRESS')
        doneForm.setFieldsValue({
          date: today(),
          outputQty: Number(o.plannedQty),
          laborCost: undefined,
          overheadCost: undefined,
        });
    }
  }, [o, doneForm]);
  const start = useAction(
    () =>
      post<ProductionOrder>(`/production/orders/${id}/start`, {
        date: startDate,
        lines: Object.entries(issue).map(([productId, qty]) => ({ productId, qty: String(qty ?? 0) })),
      }),
    { success: (r) => `Bahan ${fmtMoney(r.materialCost)} dikeluarkan ke produksi`, invalidate: INVALIDATE },
  );
  const complete = useAction(
    (v: { date: string; outputQty: number; laborCost?: number; overheadCost?: number }) =>
      post<ProductionOrder>(`/production/orders/${id}/complete`, {
        date: v.date,
        outputQty: String(v.outputQty),
        laborCost: v.laborCost == null ? undefined : String(v.laborCost),
        overheadCost: v.overheadCost == null ? undefined : String(v.overheadCost),
      }),
    {
      success: (r) => `Selesai: ${fmtQty(r.outputQty)} unit @ ${fmtMoney(r.unitCost)} masuk gudang`,
      invalidate: INVALIDATE,
    },
  );
  const cancel = useAction(() => post<ProductionOrder>(`/production/orders/${id}/cancel`, {}), {
    success: 'Produksi dibatalkan',
    invalidate: INVALIDATE,
  });

  return (
    <Drawer
      open
      width={820}
      onClose={onClose}
      title={o ? `${o.number} · ${o.product.name}` : 'Produksi'}
      loading={q.isLoading}
    >
      {o && (
        <>
          <Descriptions size="small" column={{ xs: 1, md: 3 }} bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Status">
              <Tag color={COLOR[o.status]}>{PRODUCTION_STATUS_LABELS[o.status]}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label={t("Resep")}>{o.bom.code}</Descriptions.Item>
            <Descriptions.Item label={t('Gudang')}>{o.warehouse.name}</Descriptions.Item>
            <Descriptions.Item label="Batch">{fmtQty(o.batches)}</Descriptions.Item>
            <Descriptions.Item label="Rencana hasil">
              {fmtQty(o.plannedQty)} {o.product.unit}
            </Descriptions.Item>
            <Descriptions.Item label="Mulai / selesai">
              {fmtDate(o.startedDate)} / {fmtDate(o.completedDate)}
            </Descriptions.Item>
            <Descriptions.Item label="Bahan">{fmtMoney(o.materialCost)}</Descriptions.Item>
            <Descriptions.Item label="Upah + overhead">
              {fmtMoney(Number(o.laborCost) + Number(o.overheadCost))}
            </Descriptions.Item>
            <Descriptions.Item label="Harga pokok / unit">
              {o.status === 'COMPLETED' ? <b>{fmtMoney(o.unitCost)}</b> : '-'}
            </Descriptions.Item>
          </Descriptions>

          <Typography.Title level={5}>Bahan</Typography.Title>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={o.lines}
            columns={[
              { title: 'Bahan', render: (_, l) => `${l.sku} · ${l.name}` },
              { title: t('Sesuai resep'), align: 'right', render: (_, l) => `${fmtQty(l.plannedQty)} ${l.unit}` },
              {
                title: 'Dikeluarkan',
                align: 'right',
                render: (_, l) =>
                  o.status === 'DRAFT' ? (
                    <InputNumber
                      min={0}
                      value={issue[l.productId]}
                      onChange={(v) => setIssue((x) => ({ ...x, [l.productId]: v }))}
                      style={{ width: 120 }}
                    />
                  ) : (
                    `${fmtQty(l.issuedQty)} ${l.unit}`
                  ),
              },
              {
                title: 'Biaya',
                dataIndex: 'value',
                align: 'right',
                render: (v: string) => (Number(v) ? fmtMoney(v) : '-'),
              },
            ]}
          />

          {o.status === 'DRAFT' && (
            <Space style={{ marginTop: 16 }} wrap>
              {can('POST', '/production/orders/:id/start') && (
                <>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    style={{ width: 160 }}
                  />
                  <Button
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    loading={start.isPending}
                    onClick={() => start.mutate(undefined)}
                  >
                    Mulai produksi (keluarkan bahan)
                  </Button>
                </>
              )}
              {can('POST', '/production/orders/:id/cancel') && (
                <Button danger icon={<StopOutlined />} onClick={() => cancel.mutate(undefined)}>
                  Batalkan
                </Button>
              )}
            </Space>
          )}

          {o.status === 'IN_PROGRESS' && can('POST', '/production/orders/:id/complete') && (
            <Card size="small" title="Selesaikan produksi" style={{ marginTop: 16 }}>
              <Form form={doneForm} layout="vertical" onFinish={(v) => complete.mutate(v)}>
                <Space wrap align="start">
                  <Form.Item
                    name="outputQty"
                    label={`Hasil baik (${o.product.unit})`}
                    rules={[{ required: true }]}
                    extra={t('Produk cacat/susut normal tidak dihitung')}
                  >
                    <InputNumber min={0.0001} style={{ width: 160 }} />
                  </Form.Item>
                  <Form.Item name="laborCost" label="Upah langsung" extra={t("Kosong = standar resep × batch")}>
                    <InputNumber min={0} style={{ width: 170 }} prefix="Rp" />
                  </Form.Item>
                  <Form.Item name="overheadCost" label="Overhead pabrik" extra={t("Kosong = standar resep × batch")}>
                    <InputNumber min={0} style={{ width: 170 }} prefix="Rp" />
                  </Form.Item>
                  <Form.Item name="date" label="Tanggal selesai">
                    <Input type="date" />
                  </Form.Item>
                </Space>
                <Space>
                  <Button type="primary" htmlType="submit" icon={<CheckOutlined />} loading={complete.isPending}>
                    Selesai — masukkan produk jadi ke gudang
                  </Button>
                  <Button
                    danger
                    icon={<StopOutlined />}
                    onClick={() =>
                      modal.confirm({
                        title: 'Batalkan produksi?',
                        content: 'Bahan yang sudah dikeluarkan dikembalikan ke gudang dengan biaya semula.',
                        okText: 'Batalkan produksi',
                        okButtonProps: { danger: true },
                        onOk: () => cancel.mutateAsync(undefined),
                      })
                    }
                  >
                    Batalkan
                  </Button>
                </Space>
              </Form>
            </Card>
          )}
          {o.notes && (
            <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
              Catatan: {o.notes}
            </Typography.Paragraph>
          )}
        </>
      )}
    </Drawer>
  );
}
