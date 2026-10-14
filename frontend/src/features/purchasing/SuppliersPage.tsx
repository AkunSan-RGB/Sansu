import { useApps } from '@/lib/apps';
import { useNavigate } from 'react-router-dom';
import { FileExcelOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Form, Input, InputNumber, Modal, Space, Switch, Tag } from 'antd';
import { useState } from 'react';
import { ApiError, patch, post } from '@/api/client';
import { useAction, useSuppliers } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import type { Supplier } from '@/api/types';
import ListPage from '@/components/ListPage';
import { t } from '@/lib/terms';

interface FormValues {
  code: string;
  name: string;
  phone?: string;
  address?: string;
  npwp?: string;
  paymentTermDays: number;
  isActive?: boolean;
  isPreferred?: boolean;
  autoApproveLimit?: number;
}

export default function SuppliersPage() {
  const { isAdmin } = useApps();
  const navigate = useNavigate();
  const { data, isLoading } = useSuppliers();
  const can = useCan();
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const canSave = editing === 'new' ? can('POST', '/suppliers') : can('PATCH', '/suppliers/:id');
  const [form] = Form.useForm<FormValues>();

  const { modal } = App.useApp();
  const save = useAction(
    async (v: FormValues) => {
      // batas persetujuan otomatis hanya dikirim oleh pemilik/admin (server menolak peran lain)
      const body = isAdmin ? { ...v, autoApproveLimit: v.isPreferred ? String(v.autoApproveLimit ?? 0) : '0' } : { ...v, isPreferred: undefined, autoApproveLimit: undefined };
      const send = (extra: object) => (editing && editing !== 'new' ? patch(`/suppliers/${editing.id}`, { ...body, ...extra }) : post('/suppliers', { ...body, ...extra }));
      try {
        return await send({});
      } catch (e) {
        const data = e instanceof ApiError ? (e.data as { code?: string; message?: string } | undefined) : undefined;
        if (data?.code !== 'POSSIBLE_DUPLICATE_SUPPLIER') throw e;
        // anti pemasok ganda/fiktif: tampilkan yang mirip, simpan hanya bila pengguna yakin
        const ok = await new Promise<boolean>((resolve) =>
          modal.confirm({ title: 'Mirip dengan supplier lain', width: 520, content: data.message, okText: 'Tetap simpan', cancelText: 'Periksa dulu', onOk: () => resolve(true), onCancel: () => resolve(false) }),
        );
        if (!ok) throw new Error('Penyimpanan dibatalkan');
        return send({ confirmDuplicate: true });
      }
    },
    { success: 'Supplier disimpan', invalidate: ['suppliers'], onSuccess: () => setEditing(null) },
  );

  const open = (s: Supplier | 'new') => {
    form.resetFields();
    if (s !== 'new') {
      form.setFieldsValue({
        ...s,
        phone: s.phone ?? undefined,
        address: s.address ?? undefined,
        npwp: s.npwp ?? undefined,
        autoApproveLimit: Number(s.autoApproveLimit ?? 0),
      });
    }
    setEditing(s);
  };

  return (
    <>
      <ListPage<Supplier>
        title={t('Supplier')}
        actions={
          <>
            {isAdmin && (
              <Button icon={<FileExcelOutlined />} onClick={() => navigate('/settings/import?kind=suppliers')}>
                Impor Excel
              </Button>
            )}
            {can('POST', '/suppliers') && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
                Supplier baru
              </Button>
            )}
          </>
        }
        rows={data}
        loading={isLoading}
        summary={(rows) => [
          { label: `Jumlah ${t('Supplier').toLowerCase()}`, value: String(rows.length) },
          { label: 'Favorit', value: String(rows.filter((s) => s.isPreferred).length), hint: 'persetujuan otomatis', tone: 'good' },
          { label: 'Nonaktif', value: String(rows.filter((s) => !s.isActive).length) },
        ]}
        views={[
          { value: 'ALL', label: 'Semua', test: () => true },
          { value: 'ACTIVE', label: 'Aktif', test: (s) => s.isActive },
          { value: 'PREF', label: 'Favorit', test: (s) => !!s.isPreferred },
          { value: 'OFF', label: 'Nonaktif', test: (s) => !s.isActive },
        ]}
        searchText={(r) => `${r.code} ${r.name} ${r.phone ?? ''}`}
        searchPlaceholder="Cari nama, kode, atau telepon"
        emptyText="Belum ada supplier. Tambahkan lewat tombol di kanan atas atau impor dari Excel."
        onRowClick={(r) => open(r)}
        columns={[
          { title: 'Supplier', dataIndex: 'name', render: (n: string, s: Supplier) => (<div><div>{n}{s.isPreferred && <Tag color="gold" style={{ marginLeft: 6 }}>Favorit</Tag>}{!s.isActive && <Tag style={{ marginLeft: 6 }}>Nonaktif</Tag>}</div><span style={{ fontSize: 12, color: '#64748b' }}>{s.code}</span></div>) },
          { title: 'Telepon', dataIndex: 'phone', render: (p: string | null) => p || '-' },
          { title: 'NPWP', dataIndex: 'npwp', render: (p: string | null) => p || '-' },
          { title: 'Termin', dataIndex: 'paymentTermDays', align: 'right' as const, render: (d: number) => (d ? `${d} hari` : 'Tunai') },
        ]}
      />

      <Modal
        title={editing === 'new' ? 'Supplier baru' : 'Ubah supplier'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
        okButtonProps={{ style: canSave ? undefined : { display: 'none' } }}
        okText="Simpan"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ paymentTermDays: 30, isActive: true }} onFinish={(v) => save.mutate(v)}>
          <Form.Item name="code" label="Kode" rules={[{ required: true }]}>
            <Input placeholder="SUP-PANGAN" />
          </Form.Item>
          <Form.Item name="name" label="Nama perusahaan" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="Telepon">
            <Input />
          </Form.Item>
          <Form.Item name="address" label="Alamat">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="npwp" label="NPWP" extra="Dipakai di rekap PPN masukan">
            <Input />
          </Form.Item>
          <Space wrap size="large">
            <Form.Item name="paymentTermDays" label="Termin pembayaran">
              <InputNumber min={0} max={365} suffix="hari" />
            </Form.Item>
            {editing !== 'new' && (
              <Form.Item name="isActive" label="Aktif" valuePropName="checked">
                <Switch />
              </Form.Item>
            )}
          </Space>
          {isAdmin && (
            <>
              <Form.Item name="isPreferred" label="Supplier favorit" valuePropName="checked" extra="PO dan permintaan pembelian dari supplier ini sampai batas di bawah disetujui otomatis, tanpa menunggu pemilik/admin.">
                <Switch />
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(a, b) => a.isPreferred !== b.isPreferred}>
                {({ getFieldValue }) =>
                  getFieldValue('isPreferred') && (
                    <Form.Item name="autoApproveLimit" label="Batas persetujuan otomatis" rules={[{ required: true, type: 'number', min: 1, message: 'Isi batas nilai' }]}>
                      <InputNumber min={0} max={1_000_000_000_000} step={1_000_000} style={{ width: '100%' }} prefix="Rp" />
                    </Form.Item>
                  )
                }
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </>
  );
}
