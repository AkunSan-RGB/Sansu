import { Button, Card, Checkbox, Col, Descriptions, Form, Input, InputNumber, Row, Select, Space } from 'antd';
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { post } from '@/api/client';
import { useAction, useCustomers, useProducts, useWarehouses } from '@/api/queries';
import type { Quotation } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import DocLineItems from '@/components/DocLineItems';
import { type DocLine, previewLine, uomFactor } from '@/lib/docLines';
import { fmtMoney, today } from '@/lib/format';
import { outputVatRate, vatTotals } from '@/lib/vat';
import { t } from '@/lib/terms';

type Line = DocLine;
interface FormValues {
  customerId: string;
  warehouseId: string;
  date: string;
  validDays: number;
  notes?: string;
  /** Harga yang diketik sudah termasuk PPN */
  pricesIncludeVat?: boolean;
  terms?: string;
  lines: Line[];
}

export default function QuotationFormPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const leadId = params.get('leadId') ?? undefined;
  const { me } = useAuth();
  const { data: customers } = useCustomers();
  const { data: warehouses } = useWarehouses();
  const { data: products } = useProducts();
  const [form] = Form.useForm<FormValues>();
  const lines: Line[] = Form.useWatch('lines', form) ?? [];
  const productById = new Map(products?.map((p) => [p.id, p]));

  // Gudang dimuat setelah form dibuat: isi gudang pertama sebagai default
  useEffect(() => {
    if (warehouses?.length && !form.getFieldValue('warehouseId')) form.setFieldValue('warehouseId', warehouses[0].id);
  }, [warehouses, form]);

  const create = useAction((v: FormValues) => post<Quotation>('/crm/quotations', {
    ...v,
    leadId,
    lines: v.lines.map((l) => ({
      productId: l.productId,
      uom: l.uom,
      qty: String(l.qty),
      price: l.price != null ? String(l.price) : undefined,
      discountPct: String(l.discountPct ?? 0),
    })),
  }), {
    success: (o) => `Penawaran ${o.number} dibuat`,
    invalidate: ['quotations', 'crm-lead'],
    onSuccess: (o) => navigate(`/quotations/${o.id}`),
  });

  const setLine = (index: number, patchLine: Partial<Line>) => {
    const all = [...(form.getFieldValue('lines') as Line[])];
    all[index] = { ...all[index], ...patchLine };
    form.setFieldValue('lines', all);
  };

  const onProduct = (index: number, productId: string) => {
    const p = productById.get(productId);
    setLine(index, { productId, uom: p?.baseUom, price: Number(p?.sellPrice ?? 0) });
  };
  const onUom = (index: number, uom: string) => {
    const p = productById.get(lines[index]?.productId ?? '');
    setLine(index, { uom, price: Number(p?.sellPrice ?? 0) * uomFactor(p, uom) });
  };

  const ppnRate = outputVatRate(me);
  const inclusive = (Form.useWatch('pricesIncludeVat', form) ?? false) && ppnRate > 0;
  const { subtotal, tax, total } = vatTotals(lines.reduce((a, l) => a + previewLine(l), 0), ppnRate, inclusive);

  return (
    <>
      <PageHeader title="Penawaran harga baru" />
      <Form
        form={form}
        layout="vertical"
        initialValues={{ date: today(), pricesIncludeVat: !!me?.taxProfile?.salesPricesIncludeVat, validDays: 14, customerId: params.get('customerId') ?? undefined, terms: 'Harga belum termasuk ongkos kirim. Pembayaran sesuai termin yang disepakati.', lines: [{ qty: 1, discountPct: 0 }] }}
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
            <Col xs={12} md={3}>
              <Form.Item name="date" label="Tanggal" rules={[{ required: true }]}>
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col xs={12} md={3}>
              <Form.Item name="validDays" label="Berlaku">
                <InputNumber min={1} max={365} suffix="hari" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <DocLineItems
            products={products}
            productById={productById}
            lines={lines}
            onProduct={onProduct}
            onUom={onUom}
            priceTitle="Harga / satuan"
            money={fmtMoney}
          />

          <Row gutter={16} style={{ marginTop: 16 }}>
            <Col xs={24} md={14}>
              <Form.Item name="terms" label="Syarat & ketentuan (tercetak di penawaran)">
                <Input.TextArea rows={3} />
              </Form.Item>
              <Form.Item name="notes" label="Catatan internal">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              {ppnRate > 0 && (
                <Form.Item name="pricesIncludeVat" valuePropName="checked" style={{ marginBottom: 8 }}>
                  <Checkbox>Harga yang diketik sudah termasuk PPN {ppnRate}%</Checkbox>
                </Form.Item>
              )}
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="Subtotal (DPP)">{fmtMoney(subtotal)}</Descriptions.Item>
                <Descriptions.Item label={ppnRate ? `PPN ${ppnRate}%` : "PPN (belum PKP)"}>{fmtMoney(tax)}</Descriptions.Item>
                <Descriptions.Item label="Total">
                  <strong>{fmtMoney(total)}</strong>
                </Descriptions.Item>
              </Descriptions>
            </Col>
          </Row>

          <Space style={{ marginTop: 16 }}>
            <Button onClick={() => navigate(-1)}>Batal</Button>
            <Button type="primary" htmlType="submit" loading={create.isPending}>
              Simpan penawaran
            </Button>
          </Space>
        </Card>
      </Form>
    </>
  );
}
