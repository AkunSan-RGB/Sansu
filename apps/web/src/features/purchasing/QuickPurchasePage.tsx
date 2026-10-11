import { DeleteOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Col, Form, Input, InputNumber, Row, Select, Space, Table, Tag, Tooltip } from 'antd';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from '@/api/client';
import { useAction, useProducts, useSuppliers, useWarehouses } from '@/api/queries';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import type { PurchaseOrder } from '@/api/types';

interface Line {
  productId?: string;
  uom?: string;
  qty?: number;
  price?: number;
}
interface FormValues {
  supplierId: string;
  warehouseId: string;
  date: string;
  notes?: string;
  receiveNow?: boolean;
  lines: Line[];
}
interface History {
  last: number;
  lastDate: string;
  lastSupplier: string;
  avg90: number | null;
  min: number;
  max: number;
  count: number;
  suppliers: { supplierId: string; name: string; last: number; lastDate: string; avg: number; count: number }[];
}

/**
 * Pembelian cepat atas penawaran supplier (tanpa RFQ): isi barang dan harga penawaran, lihat riwayat harga beli aktual
 * sebagai pembanding, lalu pesan — PO langsung terkonfirmasi. Harga PO dianggap estimasi; biaya perolehan mengikuti faktur.
 */
export default function QuickPurchasePage() {
  const navigate = useNavigate();
  const { data: suppliers } = useSuppliers();
  const { data: warehouses } = useWarehouses();
  const { data: products } = useProducts();
  const [form] = Form.useForm<FormValues>();
  const lines: Line[] = Form.useWatch('lines', form) ?? [];
  const supplierId: string | undefined = Form.useWatch('supplierId', form);
  const productById = new Map(products?.map((p) => [p.id, p]));
  const ids = [...new Set(lines.map((l) => l.productId).filter((x): x is string => !!x))];
  const history = useQuery({
    queryKey: ['purchase-orders', 'price-history', ids.join(',')],
    queryFn: () => get<Record<string, History>>(`/purchase-orders/price-history?productIds=${ids.join(',')}`),
    enabled: ids.length > 0,
  });
  useEffect(() => {
    if (warehouses?.length && !form.getFieldValue('warehouseId')) form.setFieldValue('warehouseId', warehouses[0].id);
  }, [warehouses, form]);
  const factor = (l: Line) => {
    const p = productById.get(l.productId ?? '');
    return !p || !l.uom || l.uom === p.baseUom ? 1 : Number(p.uoms.find((u) => u.uom === l.uom)?.factor ?? 1);
  };
  const create = useAction(
    (v: FormValues) =>
      post<PurchaseOrder & { approvalPending: boolean; approvalMessage: string | null }>('/purchase-orders/quick', {
        supplierId: v.supplierId,
        warehouseId: v.warehouseId,
        date: v.date,
        notes: v.notes,
        receiveNow: !!v.receiveNow,
        lines: v.lines.map((l) => ({ productId: l.productId, uom: l.uom, qty: String(l.qty), price: String(l.price ?? 0) })),
      }),
    {
      success: (r) => (r.approvalPending ? `PO ${r.number} dibuat; menunggu persetujuan` : `PO ${r.number} dipesan${r.receiptStatus === 'FULL' ? ' dan barang diterima' : ''}`),
      invalidate: ['purchase-orders', 'goods-receipts', 'stock', 'approvals'],
      onSuccess: (r) => navigate(`/purchase-orders/${r.id}`),
    },
  );
  const setLine = (index: number, patch: Partial<Line>) => {
    const all = [...(form.getFieldValue('lines') as Line[])];
    all[index] = { ...all[index], ...patch };
    form.setFieldValue('lines', all);
  };
  const total = lines.reduce((a, l) => a + (l.qty ?? 0) * (l.price ?? 0), 0);

  /** Bandingkan harga penawaran dengan harga beli aktual terakhir (supplier ini, lalu umum) */
  const compare = (l: Line) => {
    const h = history.data?.[l.productId ?? ''];
    if (!h || !l.price) return <span style={{ opacity: 0.5 }}>{l.productId ? 'Belum ada riwayat' : '-'}</span>;
    const f = factor(l);
    const mine = h.suppliers.find((s) => s.supplierId === supplierId);
    const ref = (mine?.last ?? h.last) * f;
    const pct = ((l.price - ref) / ref) * 100;
    const color = Math.abs(pct) < 1 ? 'default' : pct > 0 ? 'orange' : 'green';
    return (
      <Tooltip
        title={
          <div>
            <div>Terakhir: {fmtMoney(h.last * f)} ({h.lastSupplier}, {fmtDate(h.lastDate)})</div>
            {h.avg90 != null && <div>Rata-rata 90 hari: {fmtMoney(h.avg90 * f)}</div>}
            <div>
              12 bulan: {fmtMoney(h.min * f)} – {fmtMoney(h.max * f)} ({h.count}× beli)
            </div>
            {h.suppliers.map((s) => (
              <div key={s.supplierId}>
                {s.name}: {fmtMoney(s.last * f)} ({fmtDate(s.lastDate)})
              </div>
            ))}
          </div>
        }
      >
        <Tag color={color}>
          {pct > 0 ? '+' : ''}
          {pct.toFixed(1)}% vs {mine ? 'beli terakhir dari supplier ini' : 'beli terakhir'}
        </Tag>
      </Tooltip>
    );
  };

  return (
    <>
      <PageHeader title="Pembelian cepat dari penawaran supplier" />
      <Form form={form} layout="vertical" initialValues={{ date: today(), lines: [{ qty: 1 }] }} onFinish={(v) => create.mutate(v)}>
        <Card>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Untuk pembelian yang harus cepat (harga volatil): PO langsung terkonfirmasi tanpa RFQ. Harga di sini dianggap estimasi — saat faktur supplier tiba, isi harga faktur; biaya perolehan (HPP) mengikuti faktur."
          />
          <Row gutter={16}>
            <Col xs={24} md={9}>
              <Form.Item name="supplierId" label="Supplier yang menawarkan" rules={[{ required: true }]}>
                <Select showSearch optionFilterProp="label" options={suppliers?.filter((s) => s.isActive).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="warehouseId" label="Gudang penerima" rules={[{ required: true }]}>
                <Select options={warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={7}>
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
                      title: 'Barang',
                      width: 280,
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
                      width: 100,
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
                      title: 'Harga penawaran / satuan',
                      width: 170,
                      render: (_, f) => (
                        <Form.Item name={[f.name, 'price']} rules={[{ required: true, message: 'Isi harga' }]} noStyle>
                          <InputNumber min={1} style={{ width: '100%' }} placeholder="belum PPN" />
                        </Form.Item>
                      ),
                    },
                    { title: 'Dibanding harga beli aktual', render: (_, f) => compare(lines[f.name] ?? {}) },
                    { width: 40, render: (_, f) => fields.length > 1 && <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(f.name)} /> },
                  ]}
                />
                <Button type="dashed" block icon={<PlusOutlined />} style={{ marginTop: 8 }} onClick={() => add({ qty: 1 })}>
                  Tambah barang
                </Button>
              </>
            )}
          </Form.List>
          <Row gutter={16} style={{ marginTop: 16 }}>
            <Col xs={24} md={14}>
              <Form.Item name="notes" label="Referensi penawaran / catatan">
                <Input.TextArea rows={2} placeholder="mis. Penawaran WhatsApp Pak Andi 11 Okt, berlaku sampai sore" />
              </Form.Item>
              <Form.Item name="receiveNow" valuePropName="checked">
                <Checkbox>Barang sudah tiba — langsung terima ke gudang</Checkbox>
              </Form.Item>
            </Col>
            <Col xs={24} md={10} style={{ textAlign: 'right' }}>
              <div style={{ opacity: 0.65 }}>Perkiraan nilai (DPP)</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtMoney(total)}</div>
            </Col>
          </Row>
          <Space wrap>
            <Button onClick={() => navigate('/purchase-orders')}>Batal</Button>
            <Button type="primary" htmlType="submit" icon={<ThunderboltOutlined />} loading={create.isPending}>
              Pesan sekarang
            </Button>
          </Space>
        </Card>
      </Form>
    </>
  );
}
