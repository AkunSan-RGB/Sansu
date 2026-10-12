import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Card, Col, Form, Input, InputNumber, Row, Select, Space, Table } from 'antd';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { post } from '@/api/client';
import { useAction, useProducts, useSuppliers, useWarehouses } from '@/api/queries';
import PageHeader from '@/layout/PageHeader';
import { today } from '@/lib/format';
import type { PurchaseRequest } from './requestTypes';

interface Line {
  productId?: string;
  uom?: string;
  qty?: number;
  supplierId?: string;
  estPrice?: number;
}
interface FormValues {
  warehouseId: string;
  date: string;
  neededBy?: string;
  notes?: string;
  lines: Line[];
}

/** Form permintaan pembelian — tidak perlu harga; supplier dan harga bisa ditentukan bagian pembelian nanti */
export default function PurchaseRequestFormPage() {
  const navigate = useNavigate();
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
    (v: FormValues & { submit: boolean }) =>
      post<PurchaseRequest>('/purchase-requests', {
        warehouseId: v.warehouseId,
        date: v.date,
        neededBy: v.neededBy || undefined,
        notes: v.notes,
        submit: v.submit,
        lines: v.lines.map((l) => ({ productId: l.productId, uom: l.uom, qty: String(l.qty), supplierId: l.supplierId, estPrice: l.estPrice != null ? String(l.estPrice) : undefined })),
      }),
    { success: (r) => (r.status === 'APPROVED' ? `Permintaan ${r.number} diajukan dan langsung disetujui` : `Permintaan ${r.number} dibuat`), invalidate: ['purchase-requests'], onSuccess: (r) => navigate(`/purchase-requests/${r.id}`) },
  );
  const setLine = (index: number, patch: Partial<Line>) => {
    const all = [...(form.getFieldValue('lines') as Line[])];
    all[index] = { ...all[index], ...patch };
    form.setFieldValue('lines', all);
  };
  const submit = async (submitNow: boolean) => {
    const v = await form.validateFields();
    create.mutate({ ...v, submit: submitNow });
  };
  return (
    <>
      <PageHeader title="Permintaan pembelian baru" />
      <Form form={form} layout="vertical" initialValues={{ date: today(), lines: [{ qty: 1 }] }}>
        <Card>
          <Row gutter={16}>
            <Col xs={24} md={10}>
              <Form.Item name="warehouseId" label="Untuk gudang" rules={[{ required: true }]}>
                <Select options={warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
              </Form.Item>
            </Col>
            <Col xs={12} md={7}>
              <Form.Item name="date" label="Tanggal" rules={[{ required: true }]}>
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col xs={12} md={7}>
              <Form.Item name="neededBy" label="Dibutuhkan paling lambat">
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
                      title: 'Barang',
                      width: 300,
                      render: (_, f) => (
                        <Form.Item name={[f.name, 'productId']} rules={[{ required: true, message: 'Pilih barang' }]} noStyle>
                          <Select
                            showSearch
                            optionFilterProp="label"
                            style={{ width: '100%' }}
                            placeholder="Pilih barang"
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
                        return (
                          <Form.Item name={[f.name, 'uom']} noStyle>
                            <Select style={{ width: '100%' }} options={p ? [p.baseUom, ...p.uoms.map((u) => u.uom)].map((u) => ({ value: u, label: u })) : []} />
                          </Form.Item>
                        );
                      },
                    },
                    {
                      title: 'Jumlah',
                      width: 100,
                      render: (_, f) => (
                        <Form.Item name={[f.name, 'qty']} rules={[{ required: true }]} noStyle>
                          <InputNumber min={0.0001} style={{ width: '100%' }} />
                        </Form.Item>
                      ),
                    },
                    {
                      title: 'Supplier (opsional)',
                      width: 220,
                      render: (_, f) => (
                        <Form.Item name={[f.name, 'supplierId']} noStyle>
                          <Select allowClear showSearch optionFilterProp="label" placeholder="Ditentukan pembelian" style={{ width: '100%' }} options={suppliers?.filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name }))} />
                        </Form.Item>
                      ),
                    },
                    {
                      title: 'Perkiraan harga (opsional)',
                      width: 170,
                      render: (_, f) => (
                        <Form.Item name={[f.name, 'estPrice']} noStyle>
                          <InputNumber min={0} style={{ width: '100%' }} placeholder="per satuan" />
                        </Form.Item>
                      ),
                    },
                    { width: 40, render: (_, f) => fields.length > 1 && <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(f.name)} /> },
                  ]}
                />
                <Button type="dashed" block icon={<PlusOutlined />} style={{ marginTop: 8 }} onClick={() => add({ qty: 1 })}>
                  Tambah barang
                </Button>
              </>
            )}
          </Form.List>
          <Form.Item name="notes" label="Catatan / alasan kebutuhan" style={{ marginTop: 16 }}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Space wrap>
            <Button onClick={() => navigate('/purchase-requests')}>Batal</Button>
            <Button loading={create.isPending} onClick={() => submit(false)}>
              Simpan draft
            </Button>
            <Button type="primary" loading={create.isPending} onClick={() => submit(true)}>
              Ajukan sekarang
            </Button>
          </Space>
        </Card>
      </Form>
    </>
  );
}
