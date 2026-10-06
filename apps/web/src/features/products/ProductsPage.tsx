import { useApps } from '@/lib/apps';
import { useNavigate } from 'react-router-dom';
import { MinusCircleOutlined, FileExcelOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, InputNumber, Modal, Space, Switch, Tag } from 'antd';
import { useState } from 'react';
import { patch, post } from '@/api/client';
import { useAction, useProducts } from '@/api/queries';
import type { Product } from '@/api/types';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney, fmtQty } from '@/lib/format';
import ResponsiveTable from '@/components/ResponsiveTable';
import { t } from '@/lib/terms';

interface FormValues {
  sku: string;
  name: string;
  category?: string;
  baseUom: string;
  sellPrice: number;
  barcode?: string;
  uoms?: { uom: string; factor: number }[];
  isActive?: boolean;
}

export default function ProductsPage() {
  const { isAdmin } = useApps();
  const navigate = useNavigate();
  const { data, isLoading } = useProducts();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [form] = Form.useForm<FormValues>();

  const save = useAction(
    (v: FormValues) => {
      const body = {
        ...v,
        sku: v.sku,
        baseUom: v.baseUom.toUpperCase(),
        sellPrice: String(v.sellPrice),
        barcode: v.barcode ?? '',
        uoms: (v.uoms ?? []).map((u) => ({ uom: u.uom.toUpperCase(), factor: String(u.factor) })),
      };
      return editing && editing !== 'new' ? patch(`/products/${editing.id}`, body) : post('/products', body);
    },
    { success: 'Produk disimpan', invalidate: ['products'], onSuccess: () => setEditing(null) },
  );

  const open = (p: Product | 'new') => {
    form.resetFields();
    if (p !== 'new') {
      form.setFieldsValue({
        ...p,
        category: p.category ?? undefined,
        barcode: p.barcode ?? undefined,
        sellPrice: Number(p.sellPrice),
        uoms: p.uoms.map((u) => ({ uom: u.uom, factor: Number(u.factor) })),
      });
    }
    setEditing(p);
  };

  const rows = (data ?? []).filter((p) => `${p.sku} ${p.name} ${p.barcode ?? ''}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <PageHeader
        title={t('Produk')}
        extra={
          <Space wrap>
            <Input.Search placeholder="Cari SKU / nama" allowClear onChange={(e) => setSearch(e.target.value)} />
            {isAdmin && (
              <Button icon={<FileExcelOutlined />} onClick={() => navigate('/settings/import?kind=products')}>
                Impor Excel
              </Button>
            )}
            <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
              Produk baru
            </Button>
          </Space>
        }
      />
      <Card>
        <ResponsiveTable
          rowKey="id"
          loading={isLoading}
          dataSource={rows}
          scroll={{ x: 700 }}
          onRow={(r) => ({ onClick: () => open(r), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'SKU', dataIndex: 'sku', width: 140 },
            { title: 'Nama', dataIndex: 'name' },
            { title: 'Kategori', dataIndex: 'category' },
            {
              title: 'Satuan',
              render: (_, p) => (
                <Space size={4} wrap>
                  <Tag>{p.baseUom}</Tag>
                  {p.uoms.map((u) => (
                    <Tag key={u.id} color="blue">
                      {u.uom} = {fmtQty(u.factor)} {p.baseUom}
                    </Tag>
                  ))}
                </Space>
              ),
            },
            { title: 'Harga jual / satuan dasar', dataIndex: 'sellPrice', align: 'right', render: fmtMoney },
            { title: 'Status', dataIndex: 'isActive', render: (a) => (a ? <Tag color="green">Aktif</Tag> : <Tag>Nonaktif</Tag>) },
          ]}
        />
      </Card>

      <Modal
        title={editing === 'new' ? 'Produk baru' : 'Ubah produk'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
        okText="Simpan"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ baseUom: 'PCS' }} onFinish={(v) => save.mutate(v)}>
          <Form.Item name="sku" label="SKU" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name" label={t('Nama produk')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="barcode" label="Barcode (untuk scan di kasir)">
            <Input placeholder="8991234567890" />
          </Form.Item>
          <Form.Item name="category" label="Kategori">
            <Input />
          </Form.Item>
          <Space wrap>
            <Form.Item name="baseUom" label="Satuan dasar" rules={[{ required: true }]}>
              <Input style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="sellPrice" label="Harga jual / satuan dasar (belum PPN)" rules={[{ required: true }]}>
              <InputNumber min={0} style={{ width: 220 }} prefix="Rp" />
            </Form.Item>
          </Space>
          <Form.List name="uoms">
            {(fields, { add, remove }) => (
              <>
                {fields.map((f) => (
                  <Space key={f.key} align="baseline">
                    <Form.Item name={[f.name, 'uom']} rules={[{ required: true }]}>
                      <Input placeholder="DUS" style={{ width: 100 }} />
                    </Form.Item>
                    <span>=</span>
                    <Form.Item name={[f.name, 'factor']} rules={[{ required: true }]}>
                      <InputNumber min={0.0001} placeholder="24" />
                    </Form.Item>
                    <span>satuan dasar</span>
                    <MinusCircleOutlined onClick={() => remove(f.name)} />
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />} block>
                  Tambah satuan (DUS, PAK, ...)
                </Button>
              </>
            )}
          </Form.List>
          {editing !== 'new' && (
            <Form.Item name="isActive" label="Aktif" valuePropName="checked" style={{ marginTop: 16 }}>
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
