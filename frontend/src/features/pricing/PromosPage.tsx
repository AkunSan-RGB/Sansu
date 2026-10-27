import { PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, DatePicker, Form, Input, InputNumber, Modal, Radio, Select, Switch, Tag } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post, put } from '@/api/client';
import { useAction, useProducts } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import { useCan } from '@/auth/useCan';
import ListPage from '@/components/ListPage';
import { fmtDate, fmtQty } from '@/lib/format';

interface PromoRow {
  id: string;
  name: string;
  kind: 'DISCOUNT' | 'BONUS';
  productId: string | null;
  productSku: string | null;
  productName: string | null;
  minQty: string;
  discountPct: string;
  bonusProductId: string | null;
  bonusSku: string | null;
  bonusName: string | null;
  bonusQty: string;
  validFrom: string | null;
  validTo: string | null;
  priceListId: string | null;
  priceListName: string | null;
  fundedSupplierId: string | null;
  fundedPct: string;
  isActive: boolean;
}
interface FormValues {
  name: string;
  kind: 'DISCOUNT' | 'BONUS';
  productId?: string;
  minQty: number;
  discountPct?: number;
  bonusProductId?: string;
  bonusQty?: number;
  period?: [dayjs.Dayjs, dayjs.Dayjs];
  priceListId?: string;
  fundedSupplierId?: string;
  fundedPct?: number;
  isActive: boolean;
}

/** Promo penjualan: potongan harga bertingkat dan bonus barang, diterapkan otomatis pada pesanan penjualan */
export default function PromosPage() {
  const can = useCan();
  const canEdit = can('POST', '/promos');
  const { data, isLoading } = useQuery({ queryKey: ['promos'], queryFn: () => get<PromoRow[]>('/promos') });
  const { data: lists } = useQuery({ queryKey: ['price-lists'], queryFn: () => get<{ id: string; name: string }[]>('/price-lists') });
  const { data: products } = useProducts();
  const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: () => get<{ id: string; code: string; name: string }[]>('/suppliers') });
  const [editing, setEditing] = useState<PromoRow | 'new' | null>(null);
  const [form] = Form.useForm<FormValues>();
  const kind = Form.useWatch('kind', form);
  const save = useAction(
    (v: FormValues) => {
      const body = {
        name: v.name, kind: v.kind, productId: v.productId, minQty: String(v.minQty),
        discountPct: v.kind === 'DISCOUNT' ? String(v.discountPct ?? 0) : undefined,
        bonusProductId: v.kind === 'BONUS' ? v.bonusProductId : undefined,
        bonusQty: v.kind === 'BONUS' ? String(v.bonusQty ?? 0) : undefined,
        validFrom: v.period?.[0]?.format('YYYY-MM-DD'), validTo: v.period?.[1]?.format('YYYY-MM-DD'),
        priceListId: v.priceListId, fundedSupplierId: v.fundedSupplierId, fundedPct: v.fundedSupplierId ? String(v.fundedPct ?? 0) : undefined, isActive: v.isActive,
      };
      return editing && editing !== 'new' ? put(`/promos/${editing.id}`, body) : post('/promos', body);
    },
    { success: 'Promo disimpan', invalidate: ['promos'], onSuccess: () => setEditing(null) },
  );
  const open = (p: PromoRow | 'new') => {
    form.resetFields();
    if (p === 'new') form.setFieldsValue({ kind: 'DISCOUNT', minQty: 1, isActive: true });
    else form.setFieldsValue({ name: p.name, kind: p.kind, productId: p.productId ?? undefined, minQty: Number(p.minQty), discountPct: Number(p.discountPct), bonusProductId: p.bonusProductId ?? undefined, bonusQty: Number(p.bonusQty), period: p.validFrom && p.validTo ? [dayjs(p.validFrom), dayjs(p.validTo)] : undefined, priceListId: p.priceListId ?? undefined, fundedSupplierId: p.fundedSupplierId ?? undefined, fundedPct: Number(p.fundedPct) || undefined, isActive: p.isActive });
    setEditing(p);
  };
  const prodOpts = (products ?? []).filter((p) => p.isActive).map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }));
  const { me } = useAuth();
  const retail = me?.businessModel === 'RITEL';
  const describe = (p: PromoRow) => p.kind === 'DISCOUNT'
    ? `Potongan ${Number(p.discountPct)}% bila beli ≥ ${fmtQty(p.minQty)}${p.productName ? ` ${p.productName}` : ' (semua produk)'}`
    : `Beli ${fmtQty(p.minQty)} ${p.productName} gratis ${fmtQty(p.bonusQty)} ${p.bonusName} (tiap kelipatan)`;
  return (
    <>
      <ListPage<PromoRow>
        title="Promo"
        actions={canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>Promo baru</Button>}
        rows={data}
        loading={isLoading}
        views={[{ value: 'ALL', label: 'Semua', test: () => true }, { value: 'ON', label: 'Aktif', test: (p) => p.isActive }]}
        below={<Alert type="info" showIcon style={{ marginBottom: 12 }} message={(retail ? 'Di kasir, promo potongan harga berlaku otomatis dan tampil di keranjang; promo bonus barang belum dipakai di kasir. ' : '') + "Promo diterapkan pada pesanan penjualan untuk baris yang belum diberi potongan. Potongan tidak ditumpuk (dipakai yang terbesar). Barang bonus masuk sebagai baris harga Rp 0: stoknya terpotong dan biayanya masuk HPP. Perlakuan pajak barang bonus perlu dipastikan dengan konsultan pajak Anda."} />}
        searchText={(p) => `${p.name} ${p.productName ?? ''} ${p.bonusName ?? ''}`}
        searchPlaceholder="Cari promo"
        emptyText="Belum ada promo."
        onRowClick={canEdit ? open : undefined}
        columns={[
          { title: 'Promo', dataIndex: 'name', render: (n: string, p: PromoRow) => <div><div>{n} {!p.isActive && <Tag>Nonaktif</Tag>}</div><span style={{ fontSize: 12, color: '#64748b' }}>{describe(p)}</span></div> },
          { title: 'Jenis', dataIndex: 'kind', render: (k: string) => <Tag color={k === 'BONUS' ? 'purple' : 'blue'}>{k === 'BONUS' ? 'Bonus barang' : 'Potongan'}</Tag> },
          { title: 'Periode', render: (_: unknown, p: PromoRow) => (p.validFrom || p.validTo ? `${fmtDate(p.validFrom)} – ${fmtDate(p.validTo)}` : 'Tanpa batas') },
          { title: 'Segmen', dataIndex: 'priceListName', render: (v: string | null) => v ?? 'Semua pelanggan' },
          { title: 'Ditanggung prinsipal', render: (_: unknown, p: PromoRow) => (p.fundedSupplierId ? <Tag color="purple">{Number(p.fundedPct)}%</Tag> : '-') },
        ]}
      />
      <Modal title={editing === 'new' ? 'Promo baru' : 'Ubah promo'} open={!!editing} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={save.isPending} okText="Simpan" destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Form.Item name="name" label="Nama promo" rules={[{ required: true, min: 2 }]}><Input placeholder="Beli 10 dus potongan 5%" /></Form.Item>
          <Form.Item name="kind" label="Jenis"><Radio.Group optionType="button" options={[{ value: 'DISCOUNT', label: 'Potongan harga' }, { value: 'BONUS', label: 'Bonus barang' }]} /></Form.Item>
          <Form.Item name="productId" label={kind === 'BONUS' ? 'Produk yang dibeli' : 'Produk (kosong = semua produk)'} rules={[{ required: kind === 'BONUS', message: 'Pilih produk' }]}><Select allowClear showSearch optionFilterProp="label" options={prodOpts} /></Form.Item>
          <Form.Item name="minQty" label="Minimal beli (satuan dasar)" rules={[{ required: true }]}><InputNumber min={0.0001} style={{ width: 200 }} /></Form.Item>
          {kind === 'DISCOUNT' ? (
            <Form.Item name="discountPct" label="Potongan (%)" rules={[{ required: true }]}><InputNumber min={0.01} max={100} style={{ width: 200 }} suffix="%" /></Form.Item>
          ) : (
            <>
              <Form.Item name="bonusProductId" label="Barang bonus" rules={[{ required: true, message: 'Pilih barang bonus' }]}><Select showSearch optionFilterProp="label" options={prodOpts} /></Form.Item>
              <Form.Item name="bonusQty" label="Jumlah bonus tiap kelipatan (satuan dasar)" rules={[{ required: true }]}><InputNumber min={0.0001} style={{ width: 200 }} /></Form.Item>
            </>
          )}
          <Form.Item name="period" label="Periode (kosong = tanpa batas)"><DatePicker.RangePicker /></Form.Item>
          <Form.Item name="priceListId" label="Hanya untuk segmen (kosong = semua pelanggan)"><Select allowClear options={(lists ?? []).map((l) => ({ value: l.id, label: l.name }))} /></Form.Item>
          <Form.Item name="fundedSupplierId" label="Prinsipal penanggung biaya promo (opsional)" extra="Biaya promo yang ditanggung prinsipal dapat diklaim bulanan di Modern trade › Klaim ke prinsipal"><Select allowClear showSearch optionFilterProp="label" options={(suppliers ?? []).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} /></Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.fundedSupplierId !== b.fundedSupplierId}>
            {({ getFieldValue }) => getFieldValue('fundedSupplierId') && <Form.Item name="fundedPct" label="Persen ditanggung prinsipal" rules={[{ required: true }]}><InputNumber min={1} max={100} suffix="%" style={{ width: 160 }} /></Form.Item>}
          </Form.Item>
          <Form.Item name="isActive" label="Aktif" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
