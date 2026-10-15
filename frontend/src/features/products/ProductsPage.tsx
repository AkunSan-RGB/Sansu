import { isProductionModel, PRODUCT_ROLE_COLORS, PRODUCT_ROLE_LABELS } from '@sansu/shared';
import { useAuth } from '@/auth/AuthContext';
import { useApps } from '@/lib/apps';
import { useNavigate } from 'react-router-dom';
import { MinusCircleOutlined, FileExcelOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Checkbox, Form, Input, InputNumber, Modal, Space, Switch, Tag } from 'antd';
import { useState } from 'react';
import { patch, post } from '@/api/client';
import { useAction, useProducts } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import type { Product } from '@/api/types';
import CategoryField, { categoryUsage } from '@/components/CategoryField';
import CategoriesModal from './CategoriesModal';
import ListPage from '@/components/ListPage';
import { fmtMoney, fmtQty } from '@/lib/format';
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
  semi?: boolean;
  madeToOrder?: boolean;
  shelfLifeDays?: number | null;
}

export default function ProductsPage() {
  const { isAdmin, can: hasApp } = useApps();
  const { me } = useAuth();
  const can = useCan();
  const navigate = useNavigate();
  const { data, isLoading } = useProducts();
  const prod = isProductionModel(me?.businessModel);
  /** Usaha jasa: tarif per satuan layanan; tanpa kasir (barcode) dan tanpa menu */
  const jasa = me?.businessModel === 'JASA';
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const canSave = editing === 'new' ? can('POST', '/products') : can('PATCH', '/products/:id');
  const [form] = Form.useForm<FormValues>();

  const save = useAction(
    (v: FormValues) => {
      const body = {
        ...v,
        sku: v.sku,
        category: v.category?.trim() ?? '',
        baseUom: v.baseUom.toUpperCase(),
        sellPrice: String(v.sellPrice),
        barcode: v.barcode ?? '',
        inventoryKind: v.semi ? 'SEMI' : 'GOODS',
        madeToOrder: !!v.madeToOrder && !v.semi,
        shelfLifeDays: v.shelfLifeDays ?? null,
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
        semi: p.inventoryKind === 'SEMI',
        madeToOrder: !!p.madeToOrder,
        shelfLifeDays: p.shelfLifeDays ?? undefined,
        uoms: p.uoms.map((u) => ({ uom: u.uom, factor: Number(u.factor) })),
      });
    }
    setEditing(p);
  };

  return (
    <>
      <ListPage<Product>
        title={t('Produk')}
        actions={
          <>
            {isAdmin && (
              <Button icon={<FileExcelOutlined />} onClick={() => navigate('/settings/import?kind=products')}>
                Impor Excel
              </Button>
            )}
            {can('POST', '/products/categories/merge') && <Button onClick={() => setCatsOpen(true)}>Kelola kategori</Button>}
            {can('POST', '/products') && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
                {jasa ? t('Produk baru') : 'Produk baru'}
              </Button>
            )}
          </>
        }
        rows={data}
        loading={isLoading}
        summary={(rows) =>
          prod
            ? [
                { label: 'Bahan baku', value: String(rows.filter((p) => p.role === 'RAW').length), hint: t('dipakai di resep'), tone: 'warn' },
                { label: 'Setengah jadi', value: String(rows.filter((p) => p.role === 'SEMI').length), hint: 'hasil antara produksi' },
                { label: 'Produk jadi', value: String(rows.filter((p) => p.role === 'FINISHED').length), hint: t('hasil akhir resep'), tone: 'good' },
              ]
            : [
                { label: `Jumlah ${t('Produk').toLowerCase()}`, value: String(rows.length), hint: `${rows.filter((p) => p.isActive).length} aktif` },
                { label: 'Kategori', value: String(new Set(rows.map((p) => p.category).filter(Boolean)).size) },
                { label: 'Nonaktif', value: String(rows.filter((p) => !p.isActive).length), hint: 'tidak muncul di transaksi baru' },
              ]
        }
        views={
          prod
            ? [
                { value: 'ALL', label: 'Semua', test: () => true },
                { value: 'RAW', label: 'Bahan baku', test: (p) => p.role === 'RAW' },
                { value: 'SEMI', label: 'Setengah jadi', test: (p) => p.role === 'SEMI' },
                { value: 'FINISHED', label: 'Produk jadi', test: (p) => p.role === 'FINISHED' },
                { value: 'TRADING', label: 'Barang lain', test: (p) => p.role === 'TRADING' },
              ]
            : [
                { value: 'ALL', label: 'Semua', test: () => true },
                { value: 'ACTIVE', label: 'Aktif', test: (p) => p.isActive },
                { value: 'OFF', label: 'Nonaktif', test: (p) => !p.isActive },
              ]
        }
        searchText={(p) => `${p.sku} ${p.name} ${p.barcode ?? ''} ${p.category ?? ''}`}
        searchPlaceholder={jasa ? 'Cari nama, SKU, atau kategori' : 'Cari nama, SKU, barcode, atau kategori'}
        emptyText={`Belum ada ${jasa ? t('produk') : 'produk'}. Tambahkan lewat tombol di kanan atas atau impor dari Excel.`}
        onRowClick={(r) => open(r)}
        scrollX={760}
        columns={[
          {
            title: jasa ? t('Produk') : 'Produk',
            dataIndex: 'name',
            render: (n: string, p: Product) => (
              <div>
                <div>
                  {n}
                  {prod && p.role && <Tag color={PRODUCT_ROLE_COLORS[p.role]} style={{ marginLeft: 6 }}>{PRODUCT_ROLE_LABELS[p.role]}</Tag>}
                </div>
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  {p.sku}
                  {p.category ? ` · ${p.category}` : ''}
                </span>
              </div>
            ),
          },
          {
            title: 'Satuan',
            render: (_: unknown, p: Product) => (
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
          { title: jasa ? 'Tarif / harga' : 'Harga jual', dataIndex: 'sellPrice', align: 'right' as const, render: fmtMoney },
          { title: 'Status', render: (_: unknown, p: Product) => <Space size={4}>{p.isActive ? <Tag color="green">Aktif</Tag> : <Tag>Nonaktif</Tag>}{p.inventoryKind === 'SEMI' && <Tag color="purple">Setengah jadi</Tag>}{p.madeToOrder && <Tag color="orange">Menu</Tag>}</Space> },
        ]}
      />

      <CategoriesModal open={catsOpen} onClose={() => setCatsOpen(false)} />
      <Modal
        title={editing === 'new' ? (jasa ? t('Produk baru') : 'Produk baru') : jasa ? `Ubah ${t('produk')}` : 'Ubah produk'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
        okButtonProps={{ style: canSave ? undefined : { display: 'none' } }}
        okText="Simpan"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ baseUom: jasa ? 'JAM' : 'PCS' }} onFinish={(v) => save.mutate(v)}>
          <Form.Item name="sku" label="SKU" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name" label={t('Nama produk')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          {!jasa && (
            <Form.Item name="barcode" label="Barcode (untuk scan di kasir)">
              <Input placeholder="8991234567890" />
            </Form.Item>
          )}
          <Form.Item name="category" label="Kategori" extra={`Pilih dari kategori yang sudah ada, atau ketik sendiri bila belum ada. Kategori dipakai di ${categoryUsage(hasApp)}.`}>
            <CategoryField options={(data ?? []).map((p) => p.category).filter((c): c is string => !!c)} />
          </Form.Item>
          {isProductionModel(me?.businessModel) && (
            <Form.Item
              name="semi"
              valuePropName="checked"
              extra="Hasil satu perintah produksi yang dipakai perintah produksi lain. Dicatat di akun Persediaan Barang Setengah Jadi; tidak dijual atau dibeli lewat faktur. Tidak bisa diubah setelah ada mutasi stok."
            >
              <Checkbox>Barang setengah jadi</Checkbox>
            </Form.Item>
          )}
          <Form.Item noStyle shouldUpdate={(a, b) => a.semi !== b.semi}>
            {({ getFieldValue }) =>
              !jasa &&
              !getFieldValue('semi') && (
                <Form.Item
                  name="madeToOrder"
                  valuePropName="checked"
                  extra={t('Untuk menu makanan/minuman atau barang yang dibuat setelah dipesan: saat dijual di kasir, bahan sesuai resep otomatis terpotong dan HPP dihitung dari bahan. Wajib punya resep aktif (Produksi › Resep).')}
                >
                  <Checkbox>Menu (dibuat saat dipesan)</Checkbox>
                </Form.Item>
              )
            }
          </Form.Item>
          {prod && (
            <Form.Item name="shelfLifeDays" label="Umur simpan (hari, opsional)" extra="Isi untuk barang yang cepat basi (roti, kue, olahan segar): hasil produksinya otomatis dipantau di Persediaan › Kedaluwarsa bahan, tanggal kedaluwarsa = tanggal selesai + umur simpan.">
              <InputNumber min={1} max={3650} precision={0} style={{ width: 160 }} />
            </Form.Item>
          )}
          <Space wrap>
            <Form.Item name="baseUom" label={jasa ? 'Satuan (jam, hari, paket, buah)' : 'Satuan dasar'} rules={[{ required: true }]}>
              <Input style={{ width: jasa ? 200 : 120 }} placeholder={jasa ? 'JAM' : undefined} />
            </Form.Item>
            <Form.Item name="sellPrice" label={jasa ? 'Tarif / harga per satuan (belum PPN)' : 'Harga jual / satuan dasar (belum PPN)'} rules={[{ required: true }]}>
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
                  {jasa ? 'Tambah satuan lain (mis. HARI = 8 JAM)' : 'Tambah satuan (DUS, PAK, ...)'}
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
