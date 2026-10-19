import { INTERNAL_BARCODE_PREFIX, isProductionModel, isValidBarcode, PRODUCT_ROLE_COLORS, PRODUCT_ROLE_LABELS } from '@sansu/shared';
import { useAuth } from '@/auth/AuthContext';
import { useApps } from '@/lib/apps';
import { useNavigate } from 'react-router-dom';
import { MinusCircleOutlined, FileExcelOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Switch, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { get, patch, post } from '@/api/client';
import { useAction, useProducts } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import type { Product } from '@/api/types';
import { categoryUsage } from '@/components/CategoryField';
import CategoriesModal from './CategoriesModal';
import ListPage from '@/components/ListPage';
import { fmtMoney, fmtQty } from '@/lib/format';
import { t } from '@/lib/terms';

interface Opt { value: string; label: string }
interface ProductOptions {
  model: string;
  form: { barcode: boolean; packs: boolean; menu: boolean; semi: boolean; shelfLife: boolean; skuLabel: string; nameLabel: string; baseUomLabel: string; priceLabel: string; note: string | null };
  categories: { value: string; source: 'PRESET' | 'CUSTOM' | 'USED' }[];
  baseUoms: Opt[];
  packUoms: Opt[];
}

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
  weightKg?: number | null;
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
  const [useMfr, setUseMfr] = useState(false);
  const canSave = editing === 'new' ? can('POST', '/products') : can('PATCH', '/products/:id');
  const [form] = Form.useForm<FormValues>();
  const optsQ = useQuery({ queryKey: ['products', 'options'], queryFn: () => get<ProductOptions>('/products/options') });
  const opts = optsQ.data;
  const f = opts?.form;
  const baseUomNow = Form.useWatch('baseUom', form);

  const save = useAction(
    (v: FormValues) => {
      const body = {
        ...v,
        sku: v.sku,
        category: v.category?.trim() ?? '',
        baseUom: v.baseUom.toUpperCase(),
        sellPrice: String(v.sellPrice),
        barcode: useMfr && v.barcode ? v.barcode : undefined,
        inventoryKind: v.semi ? 'SEMI' : 'GOODS',
        madeToOrder: !!v.madeToOrder && !v.semi,
        shelfLifeDays: v.shelfLifeDays ?? null,
        weightKg: v.weightKg == null ? null : String(v.weightKg),
        uoms: (v.uoms ?? []).map((u) => ({ uom: u.uom.toUpperCase(), factor: String(u.factor) })),
      };
      return editing && editing !== 'new' ? patch(`/products/${editing.id}`, body) : post('/products', body);
    },
    { success: 'Produk disimpan', invalidate: ['products'], onSuccess: () => setEditing(null) },
  );

  const genBarcodes = useAction(() => post<{ generated: number }>('/products/generate-barcodes', {}), { success: (r) => `${(r as { generated: number }).generated} produk dibuatkan barcode`, invalidate: ['products'] });
  const open = (p: Product | 'new') => {
    form.resetFields();
    setUseMfr(p !== 'new' && p.barcodeSource === 'MANUFACTURER');
    if (p !== 'new') {
      form.setFieldsValue({
        ...p,
        category: p.category ?? undefined,
        barcode: p.barcode ?? undefined,
        sellPrice: Number(p.sellPrice),
        semi: p.inventoryKind === 'SEMI',
        madeToOrder: !!p.madeToOrder,
        shelfLifeDays: p.shelfLifeDays ?? undefined,
        weightKg: p.weightKg == null ? undefined : Number(p.weightKg),
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
            {f?.barcode && can('POST', '/products/generate-barcodes') && <Button onClick={() => genBarcodes.mutate(undefined)} loading={genBarcodes.isPending}>Buat barcode otomatis</Button>}
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
        {f?.note && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={f.note} />}
        <Form form={form} layout="vertical" initialValues={{ baseUom: opts?.baseUoms[0]?.value ?? (jasa ? 'JAM' : 'PCS') }} onFinish={(v) => save.mutate(v)}>
          <Form.Item name="sku" label={f?.skuLabel ?? 'SKU'} rules={[{ required: true }]}>
            <Input maxLength={40} />
          </Form.Item>
          <Form.Item name="name" label={f?.nameLabel ?? t('Nama produk')} rules={[{ required: true }]}>
            <Input maxLength={160} />
          </Form.Item>
          {f?.barcode && (
            <Form.Item label="Barcode (untuk scan di kasir)" extra="Barcode dibuat otomatis oleh sistem (tidak diketik). Hanya bila produk sudah berbarcode pabrikan, nyalakan pilihan di bawah lalu scan barcode pada kemasannya.">
              {editing !== 'new' && editing?.barcodeSource === 'GENERATED' ? (
                <Space><Typography.Text code>{editing.barcode}</Typography.Text><Tag color="blue">otomatis · tidak bisa diubah</Tag></Space>
              ) : (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Space><Switch checked={useMfr} onChange={setUseMfr} /> Pakai barcode pabrikan (scan)</Space>
                  {useMfr ? (
                    <Form.Item name="barcode" noStyle rules={[{ validator: (_, v) => (!v || (isValidBarcode(String(v)) && !String(v).startsWith(INTERNAL_BARCODE_PREFIX)) ? Promise.resolve() : Promise.reject(new Error('Barcode tidak valid — arahkan pemindai ke kemasan (EAN-13/EAN-8/UPC-A)'))) }, { required: true, message: 'Scan barcode kemasan' }]}>
                      <Input autoFocus placeholder="Arahkan pemindai ke barcode…" inputMode="numeric" maxLength={14} />
                    </Form.Item>
                  ) : (
                    <Typography.Text type="secondary">{editing !== 'new' && editing?.barcode ? `Barcode saat ini: ${editing.barcode}` : 'Akan dibuatkan otomatis saat disimpan.'}</Typography.Text>
                  )}
                </Space>
              )}
            </Form.Item>
          )}
          <Form.Item name="category" label="Kategori" extra={`Pilih dari daftar. Kategori dipakai di ${categoryUsage(hasApp)}. Perlu kategori baru? Admin menambahkannya di Kelola kategori.`}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Pilih kategori"
              loading={optsQ.isLoading}
              options={(opts?.categories ?? []).map((c) => ({ value: c.value, label: c.value }))}
            />
          </Form.Item>
          {f?.semi && (
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
              f?.menu &&
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
          {f?.shelfLife && (
            <Form.Item name="shelfLifeDays" label="Umur simpan (hari, opsional)" extra="Isi untuk barang yang cepat basi (roti, kue, olahan segar): hasil produksinya otomatis dipantau di Persediaan › Kedaluwarsa bahan, tanggal kedaluwarsa = tanggal selesai + umur simpan.">
              <InputNumber min={1} max={3650} precision={0} style={{ width: 160 }} />
            </Form.Item>
          )}
          <Form.Item name="weightKg" label="Berat per satuan dasar (kg, opsional)" extra="Dipakai menghitung muatan kendaraan pada Rute pengiriman. Kosong = belum diisi.">
            <InputNumber min={0} max={100000} step={0.001} style={{ width: 160 }} />
          </Form.Item>
          <Space wrap align="start">
            <Form.Item name="baseUom" label={f?.baseUomLabel ?? 'Satuan dasar'} rules={[{ required: true, message: 'Pilih satuan' }]}>
              <Select showSearch optionFilterProp="label" style={{ width: 200 }} placeholder="Pilih satuan" options={opts?.baseUoms ?? []} />
            </Form.Item>
            <Form.Item name="sellPrice" label={f?.priceLabel ?? 'Harga jual / satuan dasar (belum PPN)'} rules={[{ required: true }]}>
              <InputNumber min={0} style={{ width: 240 }} prefix="Rp" />
            </Form.Item>
          </Space>
          {f?.packs && (
            <Form.List name="uoms">
              {(fields, { add, remove }) => (
                <>
                  {fields.length > 0 && <div style={{ marginBottom: 6, color: '#64748b', fontSize: 12 }}>Satuan lebih besar: pilih satuannya, isi berapa {baseUomNow ?? 'satuan dasar'} dalam satu satuan itu.</div>}
                  {fields.map((u) => (
                    <Space key={u.key} align="baseline" wrap>
                      <span>1</span>
                      <Form.Item name={[u.name, 'uom']} rules={[{ required: true, message: 'Pilih satuan' }]}>
                        <Select showSearch optionFilterProp="label" placeholder="Satuan" style={{ width: 170 }} options={(opts?.packUoms ?? []).filter((o) => o.value !== baseUomNow && !(form.getFieldValue('uoms') ?? []).some((x: { uom?: string }, i: number) => i !== u.name && x?.uom === o.value))} />
                      </Form.Item>
                      <span>=</span>
                      <Form.Item name={[u.name, 'factor']} rules={[{ required: true, message: 'Isi jumlah' }]}>
                        <InputNumber min={0.0001} placeholder="24" style={{ width: 110 }} />
                      </Form.Item>
                      <span>{baseUomNow ?? 'satuan dasar'}</span>
                      <MinusCircleOutlined onClick={() => remove(u.name)} />
                    </Space>
                  ))}
                  <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />} block>
                    {jasa ? 'Tambah satuan lain (mis. 1 HARI = 8 JAM)' : 'Tambah satuan besar (dus, karton, ...)'}
                  </Button>
                </>
              )}
            </Form.List>
          )}
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
