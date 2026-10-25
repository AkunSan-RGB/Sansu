import { CheckOutlined, PlayCircleOutlined, StopOutlined } from '@ant-design/icons';
import { PRODUCTION_STATUS_LABELS, type ProductionOrder } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { App, Button, Card, Descriptions, Drawer, Form, Input, InputNumber, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { get, post } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import { fmtDate, fmtMoney, fmtQty, today } from '@/lib/format';
import { t } from '@/lib/terms';
import { OrderOperations } from '../OperationsPanels';
import { COLOR } from './shared';

const INVALIDATE = ['production', 'balances', 'stock-moves', 'inventory', 'boms', ...LEDGER_KEYS];

export function OrderDrawer({ id, onClose }: { id: string; onClose: () => void }) {
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

          <OrderOperations orderId={id} />

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
