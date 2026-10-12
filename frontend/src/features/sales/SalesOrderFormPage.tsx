import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Card, Checkbox, Col, Descriptions, Form, Input, InputNumber, Row, Select, Space, Table } from 'antd';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { post } from '@/api/client';
import { useAction, useCustomers, useProducts, useWarehouses } from '@/api/queries';
import type { Product, SalesOrder } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import { isForeignCurrency } from '@sansu/shared';
import CurrencyFields from '@/components/CurrencyFields';
import { fmtCurrency, fmtMoney, fmtRate, today } from '@/lib/format';
import { outputVatRate, vatTotals } from '@/lib/vat';
import { t } from '@/lib/terms';

interface Line {
  productId?: string;
  uom?: string;
  qty?: number;
  price?: number;
  discountPct?: number;
}
interface FormValues {
  customerId: string;
  warehouseId: string;
  date: string;
  notes?: string;
  /** Harga yang diketik sudah termasuk PPN */
  pricesIncludeVat?: boolean;
  currency?: string;
  fxRate?: number;
  lines: Line[];
}

const uomFactor = (p: Product | undefined, uom: string | undefined) =>
  !p || !uom || uom === p.baseUom ? 1 : Number(p.uoms.find((u) => u.uom === uom)?.factor ?? 1);

/** Pratinjau nilai baris di browser; nilai final selalu dihitung ulang oleh server. */
const previewLine = (l: Line) => Math.round((l.qty ?? 0) * (l.price ?? 0) * (100 - (l.discountPct ?? 0))) / 100;

export default function SalesOrderFormPage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const { data: customers } = useCustomers();
  const { data: warehouses } = useWarehouses();
  const { data: products } = useProducts();
  const [form] = Form.useForm<FormValues>();
  const lines: Line[] = Form.useWatch('lines', form) ?? [];
  const productById = new Map(products?.map((p) => [p.id, p]));
  const currency = Form.useWatch('currency', form) ?? 'IDR';
  const foreign = isForeignCurrency(currency);
  const fxRate = Form.useWatch('fxRate', form) ?? 0;
  const money = (v: number) => (foreign ? fmtCurrency(v, currency) : fmtMoney(v));

  // Gudang dimuat setelah form dibuat: isi gudang pertama sebagai default
  useEffect(() => {
    if (warehouses?.length && !form.getFieldValue('warehouseId')) form.setFieldValue('warehouseId', warehouses[0].id);
  }, [warehouses, form]);

  const create = useAction((v: FormValues) => post<SalesOrder>('/sales-orders', {
    ...v,
    currency: isForeignCurrency(v.currency) ? v.currency : undefined,
    fxRate: isForeignCurrency(v.currency) && v.fxRate ? String(v.fxRate) : undefined,
    pricesIncludeVat: isForeignCurrency(v.currency) ? false : v.pricesIncludeVat,
    lines: v.lines.map((l) => ({
      productId: l.productId,
      uom: l.uom,
      qty: String(l.qty),
      price: l.price != null ? String(l.price) : undefined,
      discountPct: String(l.discountPct ?? 0),
    })),
  }), {
    success: (o) => `Order ${o.number} dibuat`,
    invalidate: ['sales-orders', 'dashboard'],
    onSuccess: (o) => navigate(`/sales-orders/${o.id}`),
  });

  const setLine = (index: number, patchLine: Partial<Line>) => {
    const all = [...(form.getFieldValue('lines') as Line[])];
    all[index] = { ...all[index], ...patchLine };
    form.setFieldValue('lines', all);
  };

  const onProduct = (index: number, productId: string) => {
    const p = productById.get(productId);
    // dokumen valas: harga jual master berupa Rupiah, jadi harga diketik sendiri dalam mata uang dokumen
    setLine(index, { productId, uom: p?.baseUom, price: foreign ? undefined : Number(p?.sellPrice ?? 0) });
  };
  const onUom = (index: number, uom: string) => {
    const p = productById.get(lines[index]?.productId ?? '');
    if (!foreign) setLine(index, { uom, price: Number(p?.sellPrice ?? 0) * uomFactor(p, uom) });
    else setLine(index, { uom });
  };

  const ppnRate = outputVatRate(me);
  const inclusive = (Form.useWatch('pricesIncludeVat', form) ?? false) && ppnRate > 0 && !foreign;
  const { subtotal, tax, total } = vatTotals(lines.reduce((a, l) => a + previewLine(l), 0), ppnRate, inclusive);

  return (
    <>
      <PageHeader title="Sales order baru" />
      <Form
        form={form}
        layout="vertical"
        initialValues={{ date: today(), currency: 'IDR', pricesIncludeVat: !!me?.taxProfile?.salesPricesIncludeVat, lines: [{ qty: 1, discountPct: 0 }] }}
        onFinish={(v) => create.mutate(v)}
      >
        <Card>
          <Row gutter={16}>
            <Col xs={24} md={10}>
              <Form.Item name="customerId" label={t('Pelanggan')} rules={[{ required: true }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={customers?.filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="warehouseId" label={t('Gudang')} rules={[{ required: true }]}>
                <Select options={warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="date" label="Tanggal" rules={[{ required: true }]}>
                <Input type="date" />
              </Form.Item>
            </Col>
          </Row>

          <CurrencyFields form={form} />

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
                      title: t('Produk'),
                      width: 320,
                      render: (_, f) => (
                        <Form.Item name={[f.name, 'productId']} rules={[{ required: true, message: t('Pilih produk') }]} noStyle>
                          <Select
                            showSearch
                            optionFilterProp="label"
                            style={{ width: '100%' }}
                            placeholder={t('Pilih produk')}
                            onChange={(v) => onProduct(f.name, v)}
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
                            <Select style={{ width: '100%' }} options={opts} onChange={(v) => onUom(f.name, v)} />
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
                      title: foreign ? `Harga / satuan (${currency})` : 'Harga / satuan',
                      width: 160,
                      render: (_, f) => (
                        <Form.Item name={[f.name, 'price']} noStyle>
                          <InputNumber min={0} precision={foreign ? 4 : undefined} style={{ width: '100%' }} />
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
                    { title: 'Jumlah', align: 'right', render: (_, f) => money(previewLine(lines[f.name] ?? {})) },
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
              {ppnRate > 0 && !foreign && (
                <Form.Item name="pricesIncludeVat" valuePropName="checked" style={{ marginBottom: 8 }}>
                  <Checkbox>Harga yang diketik sudah termasuk PPN {ppnRate}%</Checkbox>
                </Form.Item>
              )}
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="Subtotal (DPP)">{money(subtotal)}</Descriptions.Item>
                <Descriptions.Item label={ppnRate ? `PPN ${ppnRate}%` : "PPN (belum PKP)"}>{money(tax)}</Descriptions.Item>
                <Descriptions.Item label="Total">
                  <strong>{money(total)}</strong>
                </Descriptions.Item>
                {foreign && !!fxRate && (
                  <Descriptions.Item label={`Setara Rupiah @ ${fmtRate(fxRate)}`}>{fmtMoney(Math.round(subtotal * fxRate) + Math.round(Math.round(subtotal * fxRate) * ppnRate) / 100)}</Descriptions.Item>
                )}
              </Descriptions>
            </Col>
          </Row>

          <Space style={{ marginTop: 16 }}>
            <Button onClick={() => navigate('/sales-orders')}>Batal</Button>
            <Button type="primary" htmlType="submit" loading={create.isPending}>
              Simpan sebagai draft
            </Button>
          </Space>
        </Card>
      </Form>
    </>
  );
}
