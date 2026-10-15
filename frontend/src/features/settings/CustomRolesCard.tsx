import { DeleteOutlined, EditOutlined, PlusOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { ROLE_LABELS, type CustomRole, type Role, type RolePermissionItem } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Collapse, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { del, get, patch, post } from '@/api/client';
import { useAction } from '@/api/queries';

const BASE_ROLES: Role[] = ['ADMIN', 'FINANCE', 'ACCOUNTANT', 'SALES', 'PURCHASING', 'WAREHOUSE', 'CASHIER', 'HR'];

/** Peran khusus (hanya Pemilik): peran dasar dikurangi hak tulis tertentu. Tidak pernah menambah hak di luar peran dasar. */
export default function CustomRolesCard() {
  const roles = useQuery({ queryKey: ['custom-roles'], queryFn: () => get<CustomRole[]>('/settings/roles') });
  const [editing, setEditing] = useState<CustomRole | 'new' | null>(null);
  const [form] = Form.useForm<{ name: string; baseRole: Role }>();
  const [denied, setDenied] = useState<string[]>([]);
  const baseRole: Role | undefined = Form.useWatch('baseRole', form);
  const base = editing && editing !== 'new' ? editing.baseRole : baseRole;
  const catalog = useQuery({ queryKey: ['custom-roles', 'catalog', base], queryFn: () => get<RolePermissionItem[]>(`/settings/roles/catalog?baseRole=${base}`), enabled: !!base });
  useEffect(() => {
    if (editing && editing !== 'new') setDenied(editing.denied);
    else setDenied([]);
  }, [editing]);

  const save = useAction(
    (v: { name: string; baseRole?: Role }) => (editing === 'new' ? post('/settings/roles', { name: v.name, baseRole: v.baseRole, denied }) : patch(`/settings/roles/${(editing as CustomRole).id}`, { name: v.name, denied })),
    { success: 'Peran khusus disimpan', invalidate: ['custom-roles', 'users'], onSuccess: () => setEditing(null) },
  );
  const remove = useAction((id: string) => del(`/settings/roles/${id}`), { success: 'Peran khusus dihapus', invalidate: ['custom-roles'] });

  const groups = new Map<string, RolePermissionItem[]>();
  for (const c of catalog.data ?? []) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);

  return (
    <Card
      style={{ marginTop: 16 }}
      title={
        <Space>
          <SafetyCertificateOutlined /> Peran khusus
        </Space>
      }
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            form.resetFields();
            form.setFieldsValue({ baseRole: 'ADMIN' });
            setEditing('new');
          }}
        >
          Peran khusus baru
        </Button>
      }
    >
      <Typography.Paragraph type="secondary">
        Peran khusus = peran bawaan dikurangi hak tertentu (mis. Admin yang tidak boleh membayar atau menjurnal). Hanya mempersempit: tidak pernah memberi hak di luar peran dasarnya,
        sehingga pemisahan fungsi tetap terjaga. Hanya Pemilik yang dapat membuat, mengubah, dan menetapkannya ke pengguna; semua perubahan tercatat di jejak audit.
      </Typography.Paragraph>
      <Table<CustomRole>
        size="small"
        rowKey="id"
        loading={roles.isLoading}
        dataSource={roles.data}
        pagination={false}
        locale={{ emptyText: 'Belum ada peran khusus.' }}
        scroll={{ x: 560 }}
        columns={[
          { title: 'Nama', dataIndex: 'name' },
          { title: 'Peran dasar', dataIndex: 'baseRole', render: (r: Role) => <Tag>{ROLE_LABELS[r]}</Tag> },
          { title: 'Hak dicabut', dataIndex: 'denied', align: 'right', render: (d: string[]) => d.length },
          { title: 'Pengguna', dataIndex: 'users', align: 'right' },
          {
            title: '',
            render: (_: unknown, r) => (
              <Space>
                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => (form.setFieldsValue({ name: r.name, baseRole: r.baseRole }), setEditing(r))}>
                  Ubah
                </Button>
                <Popconfirm title="Hapus peran khusus ini?" description={r.users ? `Masih dipakai ${r.users} pengguna; pindahkan dulu.` : undefined} okText="Hapus" cancelText="Batal" disabled={r.users > 0} onConfirm={() => remove.mutate(r.id)}>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={r.users > 0}>
                    Hapus
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={editing === 'new' ? 'Peran khusus baru' : 'Ubah peran khusus'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        okText="Simpan"
        cancelText="Batal"
        confirmLoading={save.isPending}
        width={680}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Form.Item name="name" label="Nama peran" rules={[{ required: true, min: 2, max: 40, message: '2–40 huruf' }]}>
            <Input placeholder="Mis. Admin Gudang" maxLength={40} />
          </Form.Item>
          <Form.Item name="baseRole" label="Berdasarkan peran" rules={[{ required: true }]} extra={editing !== 'new' ? 'Peran dasar tidak bisa diganti; buat peran baru bila perlu.' : 'Hak yang tidak dicabut mengikuti peran ini.'}>
            <Select disabled={editing !== 'new'} options={BASE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} onChange={() => setDenied([])} />
          </Form.Item>
        </Form>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Centang hak yang DICABUT dari peran ini. Yang tidak dicentang tetap boleh. Membaca data tidak dibatasi di sini." />
        <Collapse
          size="small"
          items={[...groups].map(([group, items]) => ({
            key: group,
            label: (
              <Space>
                {group}
                {items.some((i) => denied.includes(i.key)) && <Tag color="red">{items.filter((i) => denied.includes(i.key)).length} dicabut</Tag>}
              </Space>
            ),
            children: (
              <Checkbox.Group value={denied} onChange={(v) => setDenied([...denied.filter((d) => !items.some((i) => i.key === d)), ...(v as string[])])} style={{ display: 'grid', gap: 6 }}>
                {items.map((i) => (
                  <Checkbox key={i.key} value={i.key}>
                    {i.label}
                  </Checkbox>
                ))}
              </Checkbox.Group>
            ),
          }))}
        />
      </Modal>
    </Card>
  );
}
