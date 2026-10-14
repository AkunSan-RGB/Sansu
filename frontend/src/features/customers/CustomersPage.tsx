import { useApps } from '@/lib/apps';
import { useNavigate } from 'react-router-dom';
import { FileExcelOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Form, Input, InputNumber, Modal, Space, Tag } from 'antd';
import { useState } from 'react';
import { patch, post } from '@/api/client';
import { useAction, useCustomers } from '@/api/queries';
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
}

export default function CustomersPage() {
  const { isAdmin } = useApps();
  const navigate = useNavigate();
  const { data, isLoading } = useCustomers();
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [form] = Form.useForm<FormValues>();

  const save = useAction(
    (v: FormValues) => {
      const body = { ...v, creditLimit: String(v.creditLimit ?? 0) };
      return editing && editing !== 'new' ? patch(`/customers/${editing.id}`, body) : post('/customers', body);
    },
    { success: 'Pelanggan disimpan', invalidate: ['customers'], onSuccess: () => setEditing(null) },
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
      });
    }
    setEditing(c);
  };

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
            <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
              Pelanggan baru
            </Button>
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
