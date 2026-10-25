import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Col, Descriptions, Form, Input, Row, Select, Space } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from '@/api/client';
import { useAction, useCustomers, useProducts, useWarehouses } from '@/api/queries';
import type { SalesOrder } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import { isForeignCurrency } from '@sansu/shared';
import CurrencyFields from '@/components/CurrencyFields';
import DocLineItems from '@/components/DocLineItems';
import { type DocLine, previewLine, uomFactor } from '@/lib/docLines';
import { fmtCurrency, fmtMoney, fmtRate, today } from '@/lib/format';
import { outputVatRate, vatTotals } from '@/lib/vat';
import { t } from '@/lib/terms';

interface Line extends DocLine {
  /** Baris bonus barang dari promo (harga 0) */
  isBonus?: boolean;
}
interface QuoteResult {
  lines: { productId: string; uom: string; qty: string; price: string; discountPct: string; source: 'LIST' | 'MASTER' | 'EXPLICIT'; promoName: string | null }[];
  bonus: { productId: string; uom: string; qty: string; promoName: string }[];
}
interface FormValues {
  customerId: string;
  warehouseId: string;
  date: string;
  notes?: string;
  salespersonId?: string;
  customerPoNo?: string;
  /** Harga yang diketik sudah termasuk PPN */
  pricesIncludeVat?: boolean;
  currency?: string;
  fxRate?: number;
  lines: Line[];
}

export default function SalesOrderFormPage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const { data: customers } = useCustomers();
  const { data: warehouses } = useWarehouses();
  const { data: products } = useProducts();
  const [form] = Form.useForm<FormValues>();
  const lines: Line[] = Form.useWatch('lines', form) ?? [];
  const productById = new Map(products?.map((p) => [p.id, p]));
  const customerId = Form.useWatch('customerId', form);
  const currency = Form.useWatch('currency', form) ?? 'IDR';
  const foreign = isForeignCurrency(currency);
  const fxRate = Form.useWatch('fxRate', form) ?? 0;
  // FMCG: harga daftar pelanggan + promo (potongan, bonus barang) dihitung server lewat tombol; sales pemegang pesanan dipilih Pemilik/Admin
  const isFmcg = me?.businessModel === 'FMCG';
  const [applied, setApplied] = useState<string[] | null>(null);
  const { data: salespeople } = useQuery({
    queryKey: ['users'],
    queryFn: () => get<{ id: string; name: string; role: string; isActive: boolean }[]>('/users'),
    enabled: isFmcg && ['OWNER', 'ADMIN'].includes(me?.role ?? ''),
  });
  const money = (v: number) => (foreign ? fmtCurrency(v, currency) : fmtMoney(v));

  // Gudang dimuat setelah form dibuat: isi gudang pertama sebagai default
  useEffect(() => {
    if (warehouses?.length && !form.getFieldValue('warehouseId')) form.setFieldValue('warehouseId', warehouses[0].id);
  }, [warehouses, form]);

  const create = useAction((v: FormValues) => post<SalesOrder>('/sales-orders', {
    ...v,
    // harga & promo sudah diterapkan di formulir: server tidak menambah bonus lagi
    applyPromos: applied ? false : undefined,
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

  const applyPricing = useAction(
    async () => {
      const v = form.getFieldsValue();
      const base = (v.lines ?? []).filter((l) => !l.isBonus && l.productId);
      if (!v.customerId || !base.length) throw new Error('Pilih pelanggan dan produk dulu');
      const r = await post<QuoteResult>('/pricing/quote', { customerId: v.customerId, date: v.date, lines: base.map((l) => ({ productId: l.productId, uom: l.uom, qty: String(l.qty ?? 1) })) });
      return { r, base };
    },
    {
      success: 'Harga & promo diterapkan',
      onSuccess: ({ r, base }) => {
        const out: Line[] = base.map((l, i) => ({ ...l, price: Number(r.lines[i].price), discountPct: Number(r.lines[i].discountPct) }));
        for (const b of r.bonus) out.push({ productId: b.productId, uom: b.uom, qty: Number(b.qty), price: 0, discountPct: 0, isBonus: true });
        form.setFieldValue('lines', out);
        const notes = [...new Set([...r.lines.filter((l) => l.source === 'LIST').map(() => 'Harga daftar pelanggan'), ...r.lines.map((l) => l.promoName).filter(Boolean), ...r.bonus.map((b) => `Bonus: ${b.promoName}`)] as string[])];
        setApplied(notes.length ? notes : ['Tidak ada harga daftar atau promo yang berlaku; harga jual master dipakai']);
      },
    },
  );

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
                <Select options={warehouses?.filter((w) => !w.kind || w.kind === 'MAIN' || (w.kind === 'VAN' && w.vanUserId === me?.id)).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="date" label="Tanggal" rules={[{ required: true }]}>
                <Input type="date" />
              </Form.Item>
            </Col>
            {isFmcg && (
              <Col xs={24} md={8}>
                <Form.Item name="customerPoNo" label="Nomor PO outlet" rules={[{ required: !!customers?.find((c) => c.id === customerId)?.requirePo, message: 'Outlet ini mewajibkan nomor PO' }]}>
                  <Input maxLength={60} placeholder="mis. PO-ALFA-77231" />
                </Form.Item>
              </Col>
            )}
          </Row>

          {isFmcg && !!salespeople?.some((u) => u.role === 'SALES' && u.isActive) && (
            <Form.Item name="salespersonId" label="Sales pemegang pesanan" extra="Dasar target & komisi sales. Kosong = tidak dikaitkan ke sales.">
              <Select allowClear style={{ maxWidth: 320 }} options={salespeople?.filter((u) => u.role === 'SALES' && u.isActive).map((u) => ({ value: u.id, label: u.name }))} />
            </Form.Item>
          )}
          <CurrencyFields form={form} />

          <DocLineItems
            products={products}
            productById={productById}
            lines={lines}
            onProduct={onProduct}
            onUom={onUom}
            priceTitle={foreign ? `Harga / satuan (${currency})` : 'Harga / satuan'}
            pricePrecision={foreign ? 4 : undefined}
            money={money}
            footer={
              isFmcg && !foreign ? (
                <>
                  <Button block style={{ marginTop: 8 }} loading={applyPricing.isPending} onClick={() => applyPricing.mutate(undefined)}>
                    Terapkan harga daftar & promo pelanggan
                  </Button>
                  {applied && <Alert type="success" showIcon style={{ marginTop: 8 }} message={applied.join(' · ')} description="Mengisi ulang harga dan potongan semua baris (baris bonus ditambahkan otomatis). Klik lagi bila Anda mengubah pelanggan atau jumlah." />}
                </>
              ) : undefined
            }
          />

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
