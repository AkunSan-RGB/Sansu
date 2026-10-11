import { useApps } from '@/lib/apps';
import { useNavigate } from 'react-router-dom';
import { FileExcelOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, InputNumber, Modal, Space, Switch, Tag } from 'antd';
import { useState } from 'react';
import { patch, post } from '@/api/client';
import { useAction, useSuppliers } from '@/api/queries';
import type { Supplier } from '@/api/types';
import PageHeader from '@/layout/PageHeader';
import ResponsiveTable from '@/components/ResponsiveTable';
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
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [form] = Form.useForm<FormValues>();

  const save = useAction(
    (v: FormValues) => {
      // batas persetujuan otomatis hanya dikirim oleh pemilik/admin (server menolak peran lain)
      const body = isAdmin ? { ...v, autoApproveLimit: v.isPreferred ? String(v.autoApproveLimit ?? 0) : '0' } : { ...v, isPreferred: undefined, autoApproveLimit: undefined };
      return editing && editing !== 'new' ? patch(`/suppliers/${editing.id}`, body) : post('/suppliers', body);
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

  const rows = (data ?? []).filter((s) => `${s.code} ${s.name}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <PageHeader
        title={t('Supplier')}
        extra={
          <Space wrap>
            <Input.Search placeholder="Cari kode / nama" allowClear onChange={(e) => setSearch(e.target.value)} />
            {isAdmin && (
              <Button icon={<FileExcelOutlined />} onClick={() => navigate('/settings/import?kind=suppliers')}>
                Impor Excel
              </Button>
            )}
            <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
              Supplier baru
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
            { title: 'Kode', dataIndex: 'code', width: 150 },
            { title: 'Nama', dataIndex: 'name', render: (n, s) => (<>{n}{s.isPreferred && <Tag color="gold" style={{ marginLeft: 6 }}>Favorit</Tag>}{!s.isActive && <Tag style={{ marginLeft: 6 }}>Nonaktif</Tag>}</>) },
            { title: 'Telepon', dataIndex: 'phone' },
            { title: 'NPWP', dataIndex: 'npwp' },
            { title: 'Termin', dataIndex: 'paymentTermDays', align: 'right', render: (d) => `${d} hari` },
          ]}
        />
      </Card>

      <Modal
        title={editing === 'new' ? 'Supplier baru' : 'Ubah supplier'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
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
