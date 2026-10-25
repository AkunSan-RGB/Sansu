import { Button, Card, Col, Descriptions, Form, Input, Row, Select, Space } from 'antd';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { post } from '@/api/client';
import { useAction, useProducts, useSuppliers, useWarehouses } from '@/api/queries';
import type { PurchaseOrder } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import { isForeignCurrency } from '@sansu/shared';
import CurrencyFields from '@/components/CurrencyFields';
import DocLineItems from '@/components/DocLineItems';
import { type DocLine, previewLine } from '@/lib/docLines';
import { fmtCurrency, fmtMoney, fmtRate, today } from '@/lib/format';
import { t } from '@/lib/terms';

type Line = DocLine;
interface FormValues {
  supplierId: string;
  warehouseId: string;
  date: string;
  notes?: string;
  currency?: string;
  fxRate?: number;
  lines: Line[];
}

export default function PurchaseOrderFormPage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const { data: suppliers } = useSuppliers();
  const { data: warehouses } = useWarehouses();
  const { data: products } = useProducts();
  const [form] = Form.useForm<FormValues>();
  const lines: Line[] = Form.useWatch('lines', form) ?? [];
  const productById = new Map(products?.map((p) => [p.id, p]));
  const currency = Form.useWatch('currency', form) ?? 'IDR';
  const foreign = isForeignCurrency(currency);
  const fxRate = Form.useWatch('fxRate', form) ?? 0;
  const money = (v: number) => (foreign ? fmtCurrency(v, currency) : fmtMoney(v));

  useEffect(() => {
    if (warehouses?.length && !form.getFieldValue('warehouseId')) form.setFieldValue('warehouseId', warehouses[0].id);
  }, [warehouses, form]);

  const create = useAction(
    (v: FormValues) =>
      post<PurchaseOrder>('/purchase-orders', {
        ...v,
        currency: isForeignCurrency(v.currency) ? v.currency : undefined,
        fxRate: isForeignCurrency(v.currency) && v.fxRate ? String(v.fxRate) : undefined,
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
      <Form form={form} layout="vertical" initialValues={{ date: today(), currency: 'IDR', lines: [{ qty: 1, discountPct: 0 }] }} onFinish={(v) => create.mutate(v)}>
        <Card>
          <Row gutter={16}>
            <Col xs={24} md={10}>
              <Form.Item name="supplierId" label={t('Supplier')} rules={[{ required: true }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={suppliers?.filter((s) => s.isActive).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="warehouseId" label={t('Gudang penerima')} rules={[{ required: true }]}>
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

          <DocLineItems
            products={products}
            productById={productById}
            lines={lines}
            onProduct={(i, id) => setLine(i, { productId: id, uom: productById.get(id)?.baseUom })}
            priceTitle={foreign ? `Harga beli / satuan (${currency})` : 'Harga beli / satuan'}
            priceWidth={170}
            priceRules={[{ required: true, message: 'Isi harga' }]}
            pricePlaceholder="belum PPN"
            pricePrecision={foreign ? 4 : undefined}
            money={money}
          />

          <Row gutter={16} style={{ marginTop: 16 }}>
            <Col xs={24} md={14}>
              <Form.Item name="notes" label="Catatan">
                <Input.TextArea rows={3} />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="Subtotal (DPP)">{money(subtotal)}</Descriptions.Item>
                <Descriptions.Item label={me?.taxProfile?.pkp === false ? `PPN ${ppnRate}% (masuk harga pokok)` : `PPN masukan ${ppnRate}%`}>{money(tax)}</Descriptions.Item>
                <Descriptions.Item label="Total">
                  <strong>{money(subtotal + tax)}</strong>
                </Descriptions.Item>
                {foreign && !!fxRate && (
                  <Descriptions.Item label={`Setara Rupiah @ ${fmtRate(fxRate)}`}>{fmtMoney(Math.round(subtotal * fxRate) + Math.round(Math.round(subtotal * fxRate) * ppnRate) / 100)}</Descriptions.Item>
                )}
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
