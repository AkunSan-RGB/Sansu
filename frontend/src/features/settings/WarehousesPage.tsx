import { PlusOutlined } from '@ant-design/icons';
import { BRAND, type Warehouse } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Modal, Progress, Space, Switch, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, patch, post } from '@/api/client';
import { useAction, useWarehouses } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import ListPage from '@/components/ListPage';
import { t } from '@/lib/terms';

/** Daftar gudang: tambah, ubah nama/alamat, nonaktifkan. Jumlah gudang aktif dibatasi paket langganan. */
export default function WarehousesPage() {
  const { me } = useAuth();
  // semua pengguna inventori boleh melihat; menambah/mengubah khusus Pemilik & Admin
  const isAdmin = me?.role === 'OWNER' || me?.role === 'ADMIN';
  const navigate = useNavigate();
  const list = useWarehouses({ all: true });
  const usage = useQuery({ queryKey: ['billing'], queryFn: () => get<{ usage: { warehouses: number } }>('/billing') });
  const [editing, setEditing] = useState<Partial<Warehouse> | null>(null);
  const [form] = Form.useForm();
  const keys = ['warehouses', 'billing', 'me'];
  const save = useAction(
    (v: { code?: string; name: string; address?: string }) =>
      editing?.id
        ? patch(`/warehouses/${editing.id}`, { name: v.name, address: v.address ?? '' })
        : post('/warehouses', v),
    {
      success: editing?.id ? 'Gudang diperbarui' : 'Gudang ditambahkan',
      invalidate: keys,
      onSuccess: () => setEditing(null),
    },
  );
  const toggle = useAction(
    (v: { id: string; isActive: boolean }) => patch(`/warehouses/${v.id}`, { isActive: v.isActive }),
    {
      success: (r) => ((r as Warehouse).isActive ? 'Gudang diaktifkan' : 'Gudang dinonaktifkan'),
      invalidate: keys,
    },
  );

  const max = me?.subscription.plan?.maxWarehouses ?? null;
  const used = usage.data?.usage.warehouses ?? (list.data ?? []).filter((w) => w.isActive !== false).length;
  const full = max != null && used >= max;

  return (
    <>
      <ListPage<Warehouse>
        title={t('Gudang')}
        actions={
          isAdmin && (
            <Button type="primary" icon={<PlusOutlined />} disabled={full} onClick={() => setEditing({})}>
              Tambah gudang
            </Button>
          )
        }
        rows={list.data}
        loading={list.isLoading}
        summary={(r) => [
          { label: 'Semua gudang', value: r.length },
          { label: 'Aktif', value: r.filter((w) => w.isActive !== false).length, tone: 'good' },
          { label: 'Nonaktif', value: r.filter((w) => w.isActive === false).length },
        ]}
        views={[
          { value: 'all', label: 'Semua', test: () => true },
          { value: 'active', label: 'Aktif', test: (w) => w.isActive !== false },
          { value: 'off', label: 'Nonaktif', test: (w) => w.isActive === false },
        ]}
        searchText={(w) => `${w.code} ${w.name} ${w.address ?? ''}`}
        searchPlaceholder="Cari kode, nama, atau alamat"
        emptyText="Belum ada gudang"
        scrollX={640}
        below={
          isAdmin && (
            <Card size="small" style={{ marginBottom: 12 }}>
              <Space size={24} wrap align="center">
                <div>
                  <Typography.Text type="secondary">
                    Gudang aktif · paket {me?.subscription.plan?.name ?? '-'}
                  </Typography.Text>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>
                    {used} <Typography.Text type="secondary">/ {max ?? 'tanpa batas'}</Typography.Text>
                  </div>
                </div>
                {max != null && (
                  <Progress
                    percent={Math.min(100, Math.round((used / max) * 100))}
                    showInfo={false}
                    strokeColor={BRAND.colors.primary}
                    style={{ width: 220 }}
                    status={full ? 'exception' : 'normal'}
                  />
                )}
              </Space>
              {full && (
                <Alert
                  style={{ marginTop: 12 }}
                  type="info"
                  showIcon
                  message={`Paket ${me?.subscription.plan?.name} dibatasi ${max} gudang aktif.`}
                  description={t(
                    'Untuk menambah gudang, tingkatkan paket — atau nonaktifkan gudang yang sudah tidak dipakai (stoknya harus kosong).',
                  )}
                  action={
                    <Button size="small" type="primary" onClick={() => navigate('/billing')}>
                      Lihat paket
                    </Button>
                  }
                />
              )}
            </Card>
          )
        }
        columns={[
          { title: 'Kode', dataIndex: 'code', width: 110 },
          {
            title: 'Nama',
            dataIndex: 'name',
            render: (v, w) => (isAdmin ? <a onClick={() => setEditing(w)}>{v}</a> : v),
          },
          {
            title: 'Alamat',
            dataIndex: 'address',
            render: (v) => v || <Typography.Text type="secondary">-</Typography.Text>,
          },
          {
            title: 'Aktif',
            dataIndex: 'isActive',
            width: 90,
            render: (v: boolean | undefined, w) => (
              <Switch
                size="small"
                disabled={!isAdmin}
                checked={v !== false}
                loading={toggle.isPending && toggle.variables?.id === w.id}
                onChange={(on) => toggle.mutate({ id: w.id, isActive: on })}
              />
            ),
          },
          { title: '', width: 90, render: (_, w) => (w.isActive === false ? <Tag>Nonaktif</Tag> : null) },
        ]}
      />
      <Modal
        open={!!editing}
        title={editing?.id ? `Ubah gudang ${editing.code}` : 'Gudang baru'}
        okText="Simpan"
        cancelText="Batal"
        confirmLoading={save.isPending}
        onOk={() => form.submit()}
        onCancel={() => setEditing(null)}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          preserve={false}
          initialValues={editing ?? {}}
          onFinish={(v) => save.mutate(v)}
        >
          <Form.Item
            name="code"
            label="Kode"
            rules={[{ required: true, message: 'Isi kode, mis. GDG-02' }, { max: 20 }]}
            normalize={(v: string) => v?.toUpperCase()}
          >
            <Input placeholder="GDG-02" disabled={!!editing?.id} />
          </Form.Item>
          <Form.Item name="name" label={t('Nama gudang')} rules={[{ required: true }, { max: 120 }]}>
            <Input placeholder={t('Gudang Cabang Bekasi')} />
          </Form.Item>
          <Form.Item name="address" label="Alamat">
            <Input.TextArea rows={2} maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
