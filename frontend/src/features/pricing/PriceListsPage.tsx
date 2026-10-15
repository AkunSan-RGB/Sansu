import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Drawer, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, patch, post, put } from '@/api/client';
import { useAction, useProducts } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ListPage from '@/components/ListPage';
import { fmtMoney, fmtQty } from '@/lib/format';

interface PriceListRow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  itemCount: number;
  customerCount: number;
}
interface PriceItem {
  productId: string;
  sku?: string;
  name?: string;
  baseUom?: string;
  sellPrice?: string;
  minQty: string;
  price: string;
}
interface PriceListDetail extends PriceListRow {
  items: PriceItem[];
}

/** Daftar harga per segmen pelanggan (grosir, minimarket, warung, ...), bisa bertingkat menurut jumlah beli */
export default function PriceListsPage() {
  const can = useCan();
  const canEdit = can('POST', '/price-lists');
  const { data, isLoading } = useQuery({ queryKey: ['price-lists'], queryFn: () => get<PriceListRow[]>('/price-lists') });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form] = Form.useForm<{ name: string; description?: string }>();
  const create = useAction((v: { name: string; description?: string }) => post('/price-lists', v), {
    success: 'Daftar harga dibuat',
    invalidate: ['price-lists'],
    onSuccess: () => setCreating(false),
  });
  return (
    <>
      <ListPage<PriceListRow>
        title="Daftar harga"
        actions={canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setCreating(true); }}>Daftar harga baru</Button>}
        rows={data}
        loading={isLoading}
        below={<Alert type="info" showIcon style={{ marginBottom: 12 }} message="Satu daftar harga = satu segmen pelanggan (mis. Grosir, Minimarket, Warung). Pasang di data pelanggan; pesanan penjualan lalu memakai harga daftar itu. Harga bisa bertingkat: makin banyak dibeli, makin murah." />}
        searchText={(r) => `${r.name} ${r.description ?? ''}`}
        searchPlaceholder="Cari daftar harga"
        emptyText="Belum ada daftar harga. Buat satu per segmen pelanggan, lalu isi harga produknya."
        onRowClick={(r) => setOpenId(r.id)}
        columns={[
          { title: 'Daftar harga', dataIndex: 'name', render: (n: string, r: PriceListRow) => <div><div>{n} {!r.isActive && <Tag>Nonaktif</Tag>}</div><span style={{ fontSize: 12, color: '#64748b' }}>{r.description}</span></div> },
          { title: 'Harga produk', dataIndex: 'itemCount', align: 'right' as const },
          { title: 'Pelanggan', dataIndex: 'customerCount', align: 'right' as const },
        ]}
      />
      <Modal title="Daftar harga baru" open={creating} onCancel={() => setCreating(false)} onOk={() => form.submit()} confirmLoading={create.isPending} okText="Buat" destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Form.Item name="name" label="Nama segmen" rules={[{ required: true, min: 2 }]}><Input placeholder="Grosir" /></Form.Item>
          <Form.Item name="description" label="Keterangan"><Input placeholder="Pedagang grosir, minimal beli 1 dus" /></Form.Item>
        </Form>
      </Modal>
      {openId && <PriceListDrawer id={openId} canEdit={canEdit} onClose={() => setOpenId(null)} />}
    </>
  );
}

function PriceListDrawer({ id, canEdit, onClose }: { id: string; canEdit: boolean; onClose: () => void }) {
  const { data: products } = useProducts();
  const { data, isLoading } = useQuery({ queryKey: ['price-lists', id], queryFn: () => get<PriceListDetail>(`/price-lists/${id}`) });
  const [items, setItems] = useState<PriceItem[] | null>(null);
  const rows = items ?? data?.items ?? [];
  const byId = new Map((products ?? []).map((p) => [p.id, p]));
  const saveItems = useAction(() => put(`/price-lists/${id}/items`, { items: rows.map((r) => ({ productId: r.productId, minQty: String(r.minQty), price: String(r.price) })) }), {
    success: 'Harga disimpan',
    invalidate: ['price-lists'],
    onSuccess: () => setItems(null),
  });
  const toggle = useAction((isActive: boolean) => patch(`/price-lists/${id}`, { isActive }), { success: 'Diperbarui', invalidate: ['price-lists'] });
  const set = (i: number, p: Partial<PriceItem>) => setItems(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  return (
    <Drawer title={data?.name ?? 'Daftar harga'} open onClose={onClose} width={720} loading={isLoading}
      extra={canEdit && <Space><Switch checked={data?.isActive} onChange={(v) => toggle.mutate(v)} checkedChildren="Aktif" unCheckedChildren="Nonaktif" /><Button type="primary" disabled={!items} loading={saveItems.isPending} onClick={() => saveItems.mutate(undefined)}>Simpan harga</Button></Space>}>
      <Typography.Paragraph type="secondary">Harga per <b>satuan dasar</b> produk. “Mulai jumlah” memakai satuan dasar juga: harga dengan jumlah terbesar yang terpenuhi dipakai. Produk yang tidak ada di daftar memakai harga jual master.</Typography.Paragraph>
      <Table size="small" rowKey={(r) => `${r.productId}-${r.minQty}`} dataSource={rows} pagination={false} scroll={{ x: 560 }}
        columns={[
          { title: 'Produk', render: (_: unknown, r: PriceItem) => <span>{r.name ?? byId.get(r.productId)?.name}<br /><span style={{ fontSize: 12, color: '#64748b' }}>{r.sku ?? byId.get(r.productId)?.sku}</span></span> },
          { title: 'Harga master', align: 'right' as const, render: (_: unknown, r: PriceItem) => fmtMoney(r.sellPrice ?? byId.get(r.productId)?.sellPrice) },
          { title: 'Mulai jumlah', width: 120, render: (_: unknown, r: PriceItem, i: number) => canEdit ? <InputNumber min={0.0001} value={Number(r.minQty)} onChange={(v) => set(i, { minQty: String(v ?? 1) })} style={{ width: 100 }} /> : fmtQty(r.minQty) },
          { title: 'Harga', width: 150, render: (_: unknown, r: PriceItem, i: number) => canEdit ? <InputNumber min={0} value={Number(r.price)} onChange={(v) => set(i, { price: String(v ?? 0) })} prefix="Rp" style={{ width: 130 }} /> : fmtMoney(r.price) },
          ...(canEdit ? [{ title: '', width: 40, render: (_: unknown, __: PriceItem, i: number) => <Button type="text" danger icon={<DeleteOutlined />} onClick={() => setItems(rows.filter((_r, k) => k !== i))} /> }] : []),
        ]} />
      {canEdit && (
        <Select showSearch style={{ width: '100%', marginTop: 12 }} placeholder="+ Tambah produk ke daftar harga" optionFilterProp="label" value={null as unknown as string}
          options={(products ?? []).filter((p) => p.isActive).map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }))}
          onChange={(pid: string) => { const p = byId.get(pid)!; setItems([...rows, { productId: pid, sku: p.sku, name: p.name, baseUom: p.baseUom, sellPrice: p.sellPrice, minQty: '1', price: p.sellPrice }]); }} />
      )}
    </Drawer>
  );
}
