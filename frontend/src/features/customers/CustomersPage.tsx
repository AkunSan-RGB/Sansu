import { useApps } from '@/lib/apps';
import { useNavigate } from 'react-router-dom';
import { FileExcelOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { App, Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Tag } from 'antd';
import { useState } from 'react';
import { ApiError, get, patch, post } from '@/api/client';
import { useAction, useCustomers } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import { useCan } from '@/auth/useCan';
import type { Customer } from '@/api/types';
import ListPage from '@/components/ListPage';
import { fmtMoney } from '@/lib/format';
import { t } from '@/lib/terms';

interface FormValues {
  code: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  creditLimit: number;
  paymentTermDays: number;
  priceListId?: string | null;
  requirePo?: boolean;
  geoLat?: number;
  geoLng?: number;
}

export default function CustomersPage() {
  const { isAdmin } = useApps();
  const navigate = useNavigate();
  const can = useCan();
  const { me } = useAuth();
  const isFmcg = me?.businessModel === 'FMCG';
  const usesPriceList = isFmcg || me?.businessModel === 'DAGANG';
  const usesGeo = usesPriceList || me?.businessModel === 'MANUFAKTUR';
  const { data: priceLists } = useQuery({ queryKey: ['price-lists'], queryFn: () => get<{ id: string; name: string; isActive: boolean }[]>('/price-lists'), enabled: usesPriceList });
  const { data, isLoading } = useCustomers();
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [form] = Form.useForm<FormValues>();

  const { modal } = App.useApp();
  const save = useAction(
    async (v: FormValues) => {
      const body: Record<string, unknown> = { ...v, creditLimit: String(v.creditLimit ?? 0), priceListId: v.priceListId ?? null, geoLat: v.geoLat ?? undefined, geoLng: v.geoLng ?? undefined };
      // Sales hanya mendaftarkan outlet; syarat komersial (limit kredit, termin, daftar harga, wajib PO) diatur Admin/Keuangan
      if (me?.role === 'SALES' && editing === 'new') for (const k of ['creditLimit', 'paymentTermDays', 'priceListId', 'requirePo']) delete body[k];
      const send = (extra: object) => (editing && editing !== 'new' ? patch(`/customers/${editing.id}`, { ...body, ...extra }) : post('/customers', { ...body, ...extra }));
      try {
        return await send({});
      } catch (e) {
        const data = e instanceof ApiError ? (e.data as { code?: string; message?: string } | undefined) : undefined;
        if (data?.code !== 'POSSIBLE_DUPLICATE_CUSTOMER') throw e;
        // anti pelanggan ganda/fiktif: tampilkan yang mirip, simpan hanya bila pengguna yakin
        const ok = await new Promise<boolean>((resolve) =>
          modal.confirm({ title: 'Mirip dengan pelanggan lain', width: 520, content: data.message, okText: 'Tetap simpan', cancelText: 'Periksa dulu', onOk: () => resolve(true), onCancel: () => resolve(false) }),
        );
        if (!ok) throw new Error('Penyimpanan dibatalkan');
        return send({ confirmDuplicate: true });
      }
    },
    {
      success: (r) => ((r as { termsPending?: boolean } | undefined)?.termsPending ? 'Perubahan limit kredit / termin dikirim ke Pemilik/Admin; berlaku setelah disetujui' : 'Pelanggan disimpan'),
      invalidate: ['customers', 'approvals'],
      onSuccess: () => setEditing(null),
    },
  );

  const open = (c: Customer | 'new') => {
    form.resetFields();
    if (c !== 'new') {
      form.setFieldsValue({
        ...c,
        phone: c.phone ?? undefined,
        email: c.email ?? undefined,
        address: c.address ?? undefined,
        creditLimit: Number(c.creditLimit),
        priceListId: c.priceListId ?? undefined,
        requirePo: c.requirePo ?? false,
        geoLat: c.geoLat != null ? Number(c.geoLat) : undefined,
        geoLng: c.geoLng != null ? Number(c.geoLng) : undefined,
      });
    }
    setEditing(c);
  };

  const canSave = editing === 'new' ? can('POST', '/customers') : can('PATCH', '/customers/:id');

  return (
    <>
      <ListPage<Customer>
        title={t('Pelanggan')}
        actions={
          <>
            {isAdmin && (
              <Button icon={<FileExcelOutlined />} onClick={() => navigate('/settings/import?kind=customers')}>
                Impor Excel
              </Button>
            )}
            {can('POST', '/customers') && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
                Pelanggan baru
              </Button>
            )}
          </>
        }
        rows={data}
        loading={isLoading}
        summary={(rows) => [
          { label: `Jumlah ${t('Pelanggan').toLowerCase()}`, value: String(rows.length) },
          { label: 'Dengan limit kredit', value: String(rows.filter((c) => Number(c.creditLimit) > 0).length), hint: 'piutang dibatasi' },
          { label: 'Bayar tunai', value: String(rows.filter((c) => !c.paymentTermDays).length), hint: 'tanpa termin' },
        ]}
        views={[
          { value: 'ALL', label: 'Semua', test: () => true },
          { value: 'LIMIT', label: 'Ada limit kredit', test: (c) => Number(c.creditLimit) > 0 },
          { value: 'CASH', label: 'Tunai', test: (c) => !c.paymentTermDays },
        ]}
        searchText={(r) => `${r.code} ${r.name} ${r.phone ?? ''}`}
        searchPlaceholder="Cari nama, kode, atau telepon"
        emptyText="Belum ada pelanggan. Tambahkan lewat tombol di kanan atas atau impor dari Excel."
        onRowClick={(r) => open(r)}
        columns={[
          { title: 'Pelanggan', dataIndex: 'name', render: (n: string, c: Customer) => <div><div>{n}</div><span style={{ fontSize: 12, color: '#64748b' }}>{c.code}</span></div> },
          { title: 'Telepon', dataIndex: 'phone', render: (p: string | null) => p || '-' },
          { title: 'Limit kredit', dataIndex: 'creditLimit', align: 'right' as const, render: (v: string) => (Number(v) === 0 ? <Tag>Tanpa batas</Tag> : fmtMoney(v)) },
          { title: 'Termin', dataIndex: 'paymentTermDays', align: 'right' as const, render: (d: number) => (d ? `${d} hari` : 'Tunai') },
        ]}
      />

      <Modal
        title={editing === 'new' ? 'Pelanggan baru' : 'Ubah pelanggan'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
        okText="Simpan"
        okButtonProps={{ style: canSave ? undefined : { display: 'none' } }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ creditLimit: 0, paymentTermDays: 30 }} onFinish={(v) => save.mutate(v)}>
          <Form.Item name="code" label="Kode" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name" label="Nama toko / perusahaan" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="Telepon">
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email" extra="Untuk pengingat tagihan otomatis" rules={[{ type: 'email', message: 'Format email belum benar' }]}>
            <Input placeholder="keuangan@pelanggan.co.id" />
          </Form.Item>
          <Form.Item name="address" label="Alamat">
            <Input.TextArea rows={2} />
          </Form.Item>
          {usesPriceList && (
            <Form.Item name="priceListId" label="Daftar harga (segmen)" extra="Harga di pesanan penjualan mengikuti daftar ini. Kosong = harga jual master.">
              <Select allowClear options={(priceLists ?? []).filter((l) => l.isActive).map((l) => ({ value: l.id, label: l.name }))} placeholder="Tanpa daftar harga" />
            </Form.Item>
          )}
          {isFmcg && (
            <>
              <Form.Item name="requirePo" label="Peritel modern (wajib nomor PO outlet)" valuePropName="checked" extra="Setiap pesanan harus membawa nomor PO outlet yang unik; mencegah satu PO ditagih dua kali.">
                <Switch />
              </Form.Item>
            </>
          )}
          {usesGeo && (
            <Space wrap>
                <Form.Item name="geoLat" label="Lintang outlet" extra={isFmcg ? 'Untuk memeriksa kunjungan kanvas dan mengurutkan rute pengiriman' : 'Untuk mengurutkan rute pengiriman'}><InputNumber min={-90} max={90} step={0.000001} style={{ width: 160 }} placeholder="-6.200000" /></Form.Item>
                <Form.Item name="geoLng" label="Bujur outlet"><InputNumber min={-180} max={180} step={0.000001} style={{ width: 160 }} placeholder="106.800000" /></Form.Item>
            </Space>
          )}
          <Space wrap>
            <Form.Item name="creditLimit" label="Limit kredit (0 = tanpa batas)">
              <InputNumber min={0} style={{ width: 220 }} prefix="Rp" />
            </Form.Item>
            <Form.Item name="paymentTermDays" label="Termin pembayaran">
              <InputNumber min={0} max={365} suffix="hari" />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </>
  );
}
