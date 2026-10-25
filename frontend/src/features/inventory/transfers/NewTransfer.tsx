import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Drawer, Form, Input, InputNumber, Radio, Select, Space, Typography } from 'antd';
import { useMemo } from 'react';
import { get, post, qs } from '@/api/client';
import { useAction, useProducts, useWarehouses } from '@/api/queries';
import type { StockBalance } from '@/api/types';
import { fmtQty, today } from '@/lib/format';
import BinSelect from '../BinSelect';
import { KEYS } from './shared';

interface FormValues {
  mode: 'DIRECT' | 'IN_TRANSIT';
  fromWarehouseId: string;
  toWarehouseId: string;
  date: string;
  notes?: string;
  lines: { productId: string; qty: number; fromBinId?: string; toBinId?: string }[];
}

export function NewTransfer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const [form] = Form.useForm<FormValues>();
  const { data: warehouses } = useWarehouses();
  const { data: products } = useProducts();
  const from = Form.useWatch('fromWarehouseId', form);
  const mode = Form.useWatch('mode', form);
  const to = Form.useWatch('toWarehouseId', form);
  const stock = useQuery({
    queryKey: ['stock', from],
    queryFn: () => get<StockBalance[]>(`/inventory/balances${qs({ warehouseId: from })}`),
    enabled: !!from,
  });
  const avail = useMemo(() => new Map((stock.data ?? []).map((s) => [s.productId, Number(s.qty)])), [stock.data]);
  const save = useAction(
    (v: FormValues) =>
      post<{ id: string; number: string }>('/inventory/transfers', {
        ...v,
        lines: v.lines.map((l) => ({ productId: l.productId, qty: String(l.qty), fromBinId: l.fromBinId || undefined, toBinId: mode === 'IN_TRANSIT' ? undefined : l.toBinId || undefined })),
      }),
    {
      success: (r) =>
        mode === 'IN_TRANSIT'
          ? `Kiriman ${r.number} tercatat — stok keluar, menunggu diterima gudang tujuan`
          : `Transfer ${r.number} berhasil — stok sudah pindah`,
      invalidate: KEYS,
      onSuccess: (r) => {
        form.resetFields();
        onClose();
        onDone(r.id);
      },
    },
  );
  const whOptions = warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }));
  const prodOptions = (products ?? [])
    .filter((p) => !from || (avail.get(p.id) ?? 0) > 0)
    .map((p) => ({
      value: p.id,
      label: `${p.sku} · ${p.name}${from ? ` — stok ${fmtQty(avail.get(p.id) ?? 0)} ${p.baseUom}` : ''}`,
    }));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={760}
      title="Transfer baru"
      destroyOnHidden
      extra={
        <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>
          {mode === 'IN_TRANSIT' ? 'Simpan & kirim' : 'Simpan & pindahkan stok'}
        </Button>
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ date: today(), mode: 'DIRECT', lines: [{}] }}
        onFinish={(v) => save.mutate(v)}
      >
        <Space wrap align="start" style={{ width: '100%' }}>
          <Form.Item name="fromWarehouseId" label="Dari gudang" rules={[{ required: true }]} style={{ width: 260 }}>
            <Select options={whOptions} onChange={() => form.setFieldValue('lines', [{}])} />
          </Form.Item>
          <Form.Item
            name="toWarehouseId"
            label="Ke gudang"
            dependencies={['fromWarehouseId']}
            rules={[
              { required: true },
              ({ getFieldValue }) => ({
                validator: (_, v) =>
                  v && v === getFieldValue('fromWarehouseId')
                    ? Promise.reject(new Error('Harus berbeda dari gudang asal'))
                    : Promise.resolve(),
              }),
            ]}
            style={{ width: 260 }}
          >
            <Select options={whOptions?.filter((o) => o.value !== from)} />
          </Form.Item>
          <Form.Item name="date" label="Tanggal" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
        </Space>
        <Form.Item name="mode" label="Cara transfer">
          <Radio.Group>
            <Space direction="vertical">
              <Radio value="DIRECT">
                <strong>Langsung</strong> — stok langsung pindah (gudang berdekatan / dicatat setelah barang tiba)
              </Radio>
              <Radio value="IN_TRANSIT">
                <strong>Dikirim, diterima belakangan</strong> — stok keluar sekarang, masuk ke gudang tujuan setelah
                petugas di sana menerima & menghitung barang
              </Radio>
            </Space>
          </Radio.Group>
        </Form.Item>
        <Form.Item name="notes" label="Catatan (mis. nama sopir / kendaraan)">
          <Input maxLength={255} />
        </Form.Item>
        <Typography.Text strong>Barang yang dipindahkan</Typography.Text>
        <Form.List name="lines">
          {(fields, { add, remove }) => (
            <>
              {fields.map((f) => (
                <Space key={f.key} align="baseline" style={{ display: 'flex', marginTop: 8 }}>
                  <Form.Item
                    name={[f.name, 'productId']}
                    rules={[{ required: true, message: 'Pilih produk' }]}
                    style={{ width: 460, marginBottom: 0 }}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder={from ? 'Pilih produk' : 'Pilih gudang asal dulu'}
                      disabled={!from}
                      options={prodOptions}
                    />
                  </Form.Item>
                  <Form.Item
                    name={[f.name, 'qty']}
                    dependencies={[['lines', f.name, 'productId']]}
                    rules={[
                      { required: true, message: 'Isi jumlah' },
                      ({ getFieldValue }) => ({
                        validator: (_, v) => {
                          const pid = getFieldValue(['lines', f.name, 'productId']);
                          const max = avail.get(pid) ?? 0;
                          return v > max ? Promise.reject(new Error(`Maks. ${fmtQty(max)}`)) : Promise.resolve();
                        },
                      }),
                    ]}
                    style={{ width: 160, marginBottom: 0 }}
                  >
                    <InputNumber min={0.0001} style={{ width: '100%' }} placeholder="Jumlah" />
                  </Form.Item>
                  <Form.Item name={[f.name, 'fromBinId']} style={{ marginBottom: 0 }}>
                    <BinSelect warehouseId={from} placeholder="Rak asal (otomatis)" width={170} />
                  </Form.Item>
                  {mode !== 'IN_TRANSIT' && (
                    <Form.Item name={[f.name, 'toBinId']} style={{ marginBottom: 0 }}>
                      <BinSelect warehouseId={to} placeholder="Rak tujuan (otomatis)" width={170} />
                    </Form.Item>
                  )}
                  {fields.length > 1 && <MinusCircleOutlined onClick={() => remove(f.name)} />}
                </Space>
              ))}
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() => add({})}
                style={{ marginTop: 12 }}
                disabled={!from}
              >
                Tambah barang
              </Button>
            </>
          )}
        </Form.List>
        <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
          Jumlah dalam satuan dasar produk. Nilai barang ikut pindah dengan HPP rata-rata gudang asal.{' '}
          {mode === 'IN_TRANSIT'
            ? 'Selama di perjalanan, nilainya dicatat di akun "Persediaan dalam Perjalanan"; kekurangan saat diterima dibebankan ke Selisih Persediaan.'
            : 'Tidak ada jurnal karena persediaan tetap milik perusahaan.'}
        </Typography.Paragraph>
      </Form>
    </Drawer>
  );
}
