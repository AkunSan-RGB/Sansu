import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Card, Col, Descriptions, Form, Input, InputNumber, Row, Select, Space, Table } from 'antd';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { post } from '@/api/client';
import { useAction, useProducts, useSuppliers, useWarehouses } from '@/api/queries';
import type { PurchaseOrder } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney, today } from '@/lib/format';

interface Line {
  productId?: string;
  uom?: string;
  qty?: number;
  price?: number;
  discountPct?: number;
}
interface FormValues {
  supplierId: string;
  warehouseId: string;
  date: string;
  notes?: string;
  lines: Line[];
}

const previewLine = (l: Line) => Math.round((l.qty ?? 0) * (l.price ?? 0) * (100 - (l.discountPct ?? 0))) / 100;

export default function PurchaseOrderFormPage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const { data: suppliers } = useSuppliers();
  const { data: warehouses } = useWarehouses();
  const { data: products } = useProducts();
  const [form] = Form.useForm<FormValues>();
  const lines: Line[] = Form.useWatch('lines', form) ?? [];
  const productById = new Map(products?.map((p) => [p.id, p]));

  useEffect(() => {
    if (warehouses?.length && !form.getFieldValue('warehouseId')) form.setFieldValue('warehouseId', warehouses[0].id);
  }, [warehouses, form]);

  const create = useAction(
    (v: FormValues) =>
      post<PurchaseOrder>('/purchase-orders', {
        ...v,
        lines: v.lines.map((l) => ({
          productId: l.productId,
          uom: l.uom,
          qty: String(l.qty),
          price: String(l.price ?? 0),
          discountPct: String(l.discountPct ?? 0),
        })),
      }),
    {
      success: (o) => `PO ${o.number} dibuat`,
      invalidate: ['purchase-orders'],
      onSuccess: (o) => navigate(`/purchase-orders/${o.id}`),
    },
  );

  const setLine = (index: number, patchLine: Partial<Line>) => {
    const all = [...(form.getFieldValue('lines') as Line[])];
    all[index] = { ...all[index], ...patchLine };
    form.setFieldValue('lines', all);
  };

  const subtotal = lines.reduce((a, l) => a + previewLine(l), 0);
  const ppnRate = Number(me?.ppnRate ?? 11);
  const tax = Math.round(subtotal * ppnRate) / 100;

  return (
    <>
      <PageHeader title="Purchase order baru" />
      <Form form={form} layout="vertical" initialValues={{ date: today(), lines: [{ qty: 1, discountPct: 0 }] }} onFinish={(v) => create.mutate(v)}>
        <Card>
          <Row gutter={16}>
            <Col xs={24} md={10}>
              <Form.Item name="supplierId" label="Supplier" rules={[{ required: true }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={suppliers?.filter((s) => s.isActive).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="warehouseId" label="Gudang penerima" rules={[{ required: true }]}>
                <Select options={warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="date" label="Tanggal" rules={[{ required: true }]}>
                <Input type="date" />
              </Form.Item>
            </Col>
          </Row>

          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                <Table
                  rowKey="key"
                  dataSource={fields}
                  pagination={false}
                  size="small"
                  scroll={{ x: 900 }}
                  columns={[
                    {
                      title: 'Produk',
                      width: 320,
                      render: (_, f) => (
                        <Form.Item name={[f.name, 'productId']} rules={[{ required: true, message: 'Pilih produk' }]} noStyle>
                          <Select
                            showSearch
                            optionFilterProp="label"
                            style={{ width: '100%' }}
                            placeholder="Pilih produk"
                            onChange={(id: string) => setLine(f.name, { productId: id, uom: productById.get(id)?.baseUom })}
                            options={products?.filter((p) => p.isActive).map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }))}
                          />
                        </Form.Item>
                      ),
                    },
                    {
                      title: 'Satuan',
                      width: 110,
                      render: (_, f) => {
                        const p = productById.get(lines[f.name]?.productId ?? '');
                        const opts = p ? [p.baseUom, ...p.uoms.map((u) => u.uom)].map((u) => ({ value: u, label: u })) : [];
                        return (
                          <Form.Item name={[f.name, 'uom']} noStyle>
                            <Select style={{ width: '100%' }} options={opts} />
                          </Form.Item>
                        );
                      },
                    },
                    {
                      title: 'Qty',
                      width: 100,
                      render: (_, f) => (
                        <Form.Item name={[f.name, 'qty']} rules={[{ required: true }]} noStyle>
                          <InputNumber min={0.0001} style={{ width: '100%' }} />
                        </Form.Item>
                      ),
                    },
                    {
                      title: 'Harga beli / satuan',
                      width: 170,
                      render: (_, f) => (
                        <Form.Item name={[f.name, 'price']} rules={[{ required: true, message: 'Isi harga' }]} noStyle>
                          <InputNumber min={0} style={{ width: '100%' }} placeholder="belum PPN" />
                        </Form.Item>
                      ),
                    },
                    {
                      title: 'Diskon %',
                      width: 90,
                      render: (_, f) => (
                        <Form.Item name={[f.name, 'discountPct']} noStyle>
                          <InputNumber min={0} max={100} style={{ width: '100%' }} />
                        </Form.Item>
                      ),
                    },
                    { title: 'Jumlah', align: 'right', render: (_, f) => fmtMoney(previewLine(lines[f.name] ?? {})) },
                    {
                      width: 40,
                      render: (_, f) => fields.length > 1 && <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(f.name)} />,
                    },
                  ]}
                />
                <Button type="dashed" block icon={<PlusOutlined />} style={{ marginTop: 8 }} onClick={() => add({ qty: 1, discountPct: 0 })}>
                  Tambah baris
                </Button>
              </>
            )}
          </Form.List>

          <Row gutter={16} style={{ marginTop: 16 }}>
            <Col xs={24} md={14}>
              <Form.Item name="notes" label="Catatan">
                <Input.TextArea rows={3} />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="Subtotal (DPP)">{fmtMoney(subtotal)}</Descriptions.Item>
                <Descriptions.Item label={me?.taxProfile?.pkp === false ? `PPN ${ppnRate}% (masuk harga pokok)` : `PPN masukan ${ppnRate}%`}>{fmtMoney(tax)}</Descriptions.Item>
                <Descriptions.Item label="Total">
                  <strong>{fmtMoney(subtotal + tax)}</strong>
                </Descriptions.Item>
              </Descriptions>
            </Col>
          </Row>

          <Space style={{ marginTop: 16 }}>
            <Button onClick={() => navigate('/purchase-orders')}>Batal</Button>
            <Button type="primary" htmlType="submit" loading={create.isPending}>
              Simpan sebagai draft
            </Button>
          </Space>
        </Card>
      </Form>
    </>
  );
}
