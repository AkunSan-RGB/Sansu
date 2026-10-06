import { ADJUSTMENT_REASON_LABELS, STOCK_MOVE_LABELS, type StockMoveType, toOptions } from '@sansu/shared';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, post, qs } from '@/api/client';
import { useAction, useProducts, useWarehouses } from '@/api/queries';
import type { StockBalance, StockMove } from '@/api/types';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, fmtQty, today } from '@/lib/format';
import { t } from '@/lib/terms';

const REASONS = toOptions(ADJUSTMENT_REASON_LABELS);

interface AdjustValues {
  warehouseId: string;
  reason: string;
  date?: string;
  notes?: string;
  lines: { productId: string; qty: number; unitCost?: number }[];
}

export default function InventoryPage() {
  const { data: warehouses } = useWarehouses();
  const { data: products } = useProducts();
  const [warehouseId, setWarehouseId] = useState<string>();
  const [productId, setProductId] = useState<string>();
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [form] = Form.useForm<AdjustValues>();

  const balances = useQuery({
    queryKey: ['stock', warehouseId],
    queryFn: () => get<StockBalance[]>(`/inventory/balances${qs({ warehouseId })}`),
  });
  const moves = useQuery({
    queryKey: ['stock-moves', warehouseId, productId],
    queryFn: () => get<StockMove[]>(`/inventory/moves${qs({ warehouseId, productId })}`),
  });

  const adjust = useAction(
    (v: AdjustValues) =>
      post<{ number: string; journalNumber: string | null }>('/inventory/adjustments', {
        ...v,
        lines: v.lines.map((l) => ({ productId: l.productId, qty: String(l.qty), unitCost: l.unitCost != null ? String(l.unitCost) : undefined })),
      }),
    {
      success: (r) => `Penyesuaian ${r.number} disimpan${r.journalNumber ? `, jurnal ${r.journalNumber}` : ''}`,
      invalidate: ['stock', 'stock-moves', 'dashboard'],
      onSuccess: () => setAdjustOpen(false),
    },
  );

  const totalValue = (balances.data ?? []).reduce((a, r) => a + Number(r.value), 0);
  const whOptions = warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }));
  const prodOptions = products?.map((p) => ({ value: p.id, label: `${p.sku} · ${p.name} (${p.baseUom})` }));

  return (
    <>
      <PageHeader
        title="Inventori"
        extra={
          <Space wrap>
            <Select allowClear placeholder="Semua gudang" style={{ width: 200 }} options={whOptions} onChange={setWarehouseId} />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                form.setFieldsValue({ warehouseId: warehouses?.[0]?.id, reason: 'OPENING', date: today(), lines: [{} as never] });
                setAdjustOpen(true);
              }}
            >
              Penyesuaian stok
            </Button>
          </Space>
        }
      />
      <Card>
        <Tabs
          items={[
            {
              key: 'balance',
              label: 'Saldo stok',
              children: (
                <Table
                  rowKey={(r) => `${r.productId}-${r.warehouseId}`}
                  loading={balances.isLoading}
                  dataSource={balances.data}
                  scroll={{ x: 700 }}
                  columns={[
                    { title: 'SKU', dataIndex: 'sku' },
                    { title: t('Produk'), dataIndex: 'productName' },
                    { title: t('Gudang'), dataIndex: 'warehouseCode' },
                    { title: 'Qty', dataIndex: 'qty', align: 'right', render: (v, r) => `${fmtQty(v)} ${r.baseUom}` },
                    { title: 'HPP rata-rata', dataIndex: 'avgCost', align: 'right', render: fmtMoney },
                    { title: 'Nilai', dataIndex: 'value', align: 'right', render: fmtMoney },
                  ]}
                  summary={() => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={5}>
                        <Typography.Text strong>Total nilai persediaan</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={5} align="right">
                        <Typography.Text strong>{fmtMoney(totalValue)}</Typography.Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  )}
                />
              ),
            },
            {
              key: 'card',
              label: 'Kartu stok',
              children: (
                <>
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="Filter produk"
                    style={{ width: '100%', maxWidth: 360, marginBottom: 12 }}
                    options={prodOptions}
                    onChange={setProductId}
                  />
                  <Table
                    rowKey="id"
                    size="small"
                    loading={moves.isLoading}
                    dataSource={moves.data}
                    scroll={{ x: 800 }}
                    columns={[
                      { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
                      { title: 'Dokumen', dataIndex: 'refNumber' },
                      { title: t('Produk'), render: (_, m) => `${m.product.sku} · ${m.product.name}` },
                      { title: t('Gudang'), dataIndex: ['warehouse', 'code'] },
                      { title: 'Jenis', dataIndex: 'type', render: (t) => <Tag>{STOCK_MOVE_LABELS[t as StockMoveType] ?? t}</Tag> },
                      {
                        title: 'Qty',
                        dataIndex: 'qty',
                        align: 'right',
                        render: (v) => <span style={{ color: Number(v) < 0 ? '#cf1322' : '#389e0d' }}>{fmtQty(v)}</span>,
                      },
                      { title: 'Biaya/unit', dataIndex: 'unitCost', align: 'right', render: fmtMoney },
                      { title: 'Saldo', dataIndex: 'balanceAfter', align: 'right', render: fmtQty },
                    ]}
                  />
                </>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="Penyesuaian stok"
        width={720}
        open={adjustOpen}
        onCancel={() => setAdjustOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={adjust.isPending}
        okText="Posting"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(v) => adjust.mutate(v)}>
          <Space wrap>
            <Form.Item name="warehouseId" label="Gudang" rules={[{ required: true }]}>
              <Select style={{ width: 220 }} options={whOptions} />
            </Form.Item>
            <Form.Item name="reason" label="Alasan" rules={[{ required: true }]}>
              <Select style={{ width: 220 }} options={REASONS} />
            </Form.Item>
            <Form.Item name="date" label="Tanggal">
              <Input type="date" />
            </Form.Item>
          </Space>
          <Typography.Paragraph type="secondary">
            Qty dalam satuan dasar. Positif = tambah stok (wajib isi biaya/unit), negatif = kurangi stok (memakai HPP rata-rata).
          </Typography.Paragraph>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                {fields.map((f) => (
                  <Space key={f.key} align="baseline" wrap>
                    <Form.Item name={[f.name, 'productId']} rules={[{ required: true, message: 'Pilih produk' }]}>
                      <Select showSearch optionFilterProp="label" placeholder="Produk" style={{ width: 300 }} options={prodOptions} />
                    </Form.Item>
                    <Form.Item name={[f.name, 'qty']} rules={[{ required: true, message: 'Qty' }]}>
                      <InputNumber placeholder="Qty" style={{ width: 110 }} />
                    </Form.Item>
                    <Form.Item name={[f.name, 'unitCost']}>
                      <InputNumber min={0} placeholder="Biaya/unit" style={{ width: 150 }} prefix="Rp" />
                    </Form.Item>
                    {fields.length > 1 && <MinusCircleOutlined onClick={() => remove(f.name)} />}
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />} block>
                  Tambah baris
                </Button>
              </>
            )}
          </Form.List>
          <Form.Item name="notes" label="Catatan" style={{ marginTop: 16 }}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
