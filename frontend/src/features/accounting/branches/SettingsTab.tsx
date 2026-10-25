import { Alert, Button, Form, Input, Modal, Select, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { patch, post, put } from '@/api/client';
import { useAction, useBranches } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';

export function SettingsTab() {
  const { me } = useAuth();
  const admin = me?.role === 'OWNER' || me?.role === 'ADMIN';
  const q = useBranches();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ code: string; name: string; address?: string }>();
  const create = useAction((v: { code: string; name: string; address?: string }) => post('/branches', v), { success: 'Cabang dibuat', invalidate: ['branches'], onSuccess: () => setOpen(false) });
  const toggle = useAction((v: { id: string; isActive: boolean }) => patch(`/branches/${v.id}`, { isActive: v.isActive }), { success: 'Tersimpan', invalidate: ['branches'] });
  const assign = useAction((v: { warehouseId: string; branchId: string | null }) => put(`/branches/warehouses/${v.warehouseId}`, { branchId: v.branchId }), { success: 'Gudang/toko dipasangkan', invalidate: ['branches'] });
  const assignAcc = useAction((v: { accountId: string; branchId: string | null }) => put(`/branches/accounts/${v.accountId}`, { branchId: v.branchId }), { success: 'Rekening dipasangkan ke cabang', invalidate: ['branches'] });
  const all = [...(q.data?.branches.flatMap((b) => b.warehouses.map((w) => ({ ...w, branchId: b.id }))) ?? []), ...(q.data?.unassignedWarehouses.map((w) => ({ ...w, isActive: true, branchId: null as string | null })) ?? [])];
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Satu perusahaan, satu pembukuan. Pasangkan setiap toko/gudang ke cabangnya; semua transaksi di toko itu otomatis berlabel cabang. Perubahan pasangan hanya berlaku untuk transaksi berikutnya." />
      {admin && (
        <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { form.resetFields(); setOpen(true); }}>
          Cabang baru
        </Button>
      )}
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        loading={q.isLoading}
        dataSource={q.data?.branches}
        columns={[
          { title: 'Kode', dataIndex: 'code' },
          { title: 'Cabang', dataIndex: 'name' },
          { title: 'Toko / gudang', render: (_, b: NonNullable<typeof q.data>['branches'][number]) => (b.warehouses.length ? b.warehouses.map((w) => <Tag key={w.id}>{w.name}</Tag>) : '-') },
          { title: 'Status', dataIndex: 'isActive', render: (a: boolean) => (a ? <Tag color="green">Aktif</Tag> : <Tag>Nonaktif</Tag>) },
          ...(admin ? [{ title: '', render: (_: unknown, b: { id: string; isActive: boolean }) => <Button size="small" type="link" onClick={() => toggle.mutate({ id: b.id, isActive: !b.isActive })}>{b.isActive ? 'Nonaktifkan' : 'Aktifkan'}</Button> }] : []),
        ]}
      />
      <Typography.Title level={5} style={{ marginTop: 20 }}>
        Toko / gudang milik cabang
      </Typography.Title>
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={all}
        columns={[
          { title: 'Toko / gudang', render: (_, w: (typeof all)[number]) => `${w.code} · ${w.name}` },
          {
            title: 'Cabang',
            render: (_, w: (typeof all)[number]) => (
              <Select
                allowClear
                disabled={!admin}
                placeholder="Belum ada cabang"
                style={{ width: 240 }}
                value={w.branchId ?? undefined}
                options={(q.data?.branches ?? []).filter((b) => b.isActive).map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))}
                onChange={(v) => assign.mutate({ warehouseId: w.id, branchId: v ?? null })}
              />
            ),
          },
        ]}
      />
      {(q.data?.cashAccounts?.length ?? 0) > 0 && (
        <>
          <Typography.Title level={5} style={{ marginTop: 20 }}>
            Kas / bank milik cabang
          </Typography.Title>
          <Alert type="info" showIcon style={{ marginBottom: 8 }} message="Transaksi, mutasi bank, dan aturan otomatis lewat rekening ini otomatis berlabel cabangnya. Kosong = milik Pusat." />
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={q.data?.cashAccounts}
            columns={[
              { title: 'Rekening', render: (_: unknown, a: { id: string; code: string; name: string; branchId: string | null }) => `${a.code} · ${a.name}` },
              {
                title: 'Cabang',
                render: (_: unknown, a: { id: string; code: string; name: string; branchId: string | null }) => (
                  <Select
                    allowClear
                    disabled={!admin}
                    placeholder="Pusat"
                    style={{ width: 240 }}
                    value={a.branchId ?? undefined}
                    options={(q.data?.branches ?? []).filter((b) => b.isActive).map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))}
                    onChange={(v) => assignAcc.mutate({ accountId: a.id, branchId: v ?? null })}
                  />
                ),
              },
            ]}
          />
        </>
      )}
      <Modal title="Cabang baru" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={create.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Form.Item name="code" label="Kode" rules={[{ required: true, min: 2 }]}><Input maxLength={20} placeholder="CB-BKS" /></Form.Item>
          <Form.Item name="name" label="Nama cabang" rules={[{ required: true, min: 2 }]}><Input maxLength={120} placeholder="Cabang Bekasi" /></Form.Item>
          <Form.Item name="address" label="Alamat"><Input.TextArea rows={2} maxLength={300} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
