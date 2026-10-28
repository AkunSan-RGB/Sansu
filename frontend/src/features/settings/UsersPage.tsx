import { PlusOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { APPS, canUseApp, type CustomRole, roleCatalog, roleLabelFor, type Role, ROLES } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Form, Input, Modal, Select, Space, Switch, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { get, patch, post } from '@/api/client';
import { useAction, useBranches, useWarehouses } from '@/api/queries';
import type { UserRow } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import ListPage from '@/components/ListPage';
import CustomRolesCard from './CustomRolesCard';
import { fmtDate } from '@/lib/format';
import { t } from '@/lib/terms';

const ROLE_HELP: Record<Role, string> = {
  OWNER: 'Semua akses, termasuk membuka kembali periode yang dikunci',
  ADMIN: 'Semua aplikasi & pengaturan',
  FINANCE: 'Kas & bank, pembayaran, faktur, setor pajak, bayar gaji (tidak membukukan jurnal)',
  ACCOUNTANT: 'Jurnal, bagan akun, tutup buku, aset tetap, laporan & pajak (tidak memegang uang)',
  SALES: 'CRM, penawaran, sales order, pelanggan',
  PURCHASING: 'Permintaan beli, pesanan pembelian, pemasok baru (tidak menerima barang, tidak membayar, tidak memasukkan tagihan)',
  WAREHOUSE: 'Stok, produk, penerimaan barang',
  CASHIER: 'Layar kasir saja',
  HR: 'Karyawan, absensi, cuti, penggajian',
};

export default function UsersPage() {
  const { me } = useAuth();
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const [form] = Form.useForm();
  const role: Role | undefined = Form.useWatch('role', form);
  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: () => get<UserRow[]>('/users') });
  const { data: warehouses } = useWarehouses({ all: true });
  const branches = useBranches();
  const customRoles = useQuery({ queryKey: ['custom-roles'], queryFn: () => get<CustomRole[]>('/settings/roles'), enabled: me?.role === 'OWNER' });
  const brName = new Map((branches.data?.branches ?? []).map((b) => [b.id, b.code]));
  const whName = new Map((warehouses ?? []).map((w) => [w.id, w.code]));

  const save = useAction(
    (v: {
      name: string;
      email?: string;
      password?: string;
      role: Role;
      customRoleId?: string | null;
      isActive?: boolean;
      warehouseIds?: string[];
      branchIds?: string[];
    }) => {
      // peran khusus hanya ditetapkan Pemilik dan hanya berlaku bila turunan dari peran dasar yang dipilih
      const cr = (customRoles.data ?? []).find((c) => c.id === v.customRoleId && c.baseRole === v.role);
      const body = { ...v, customRoleId: undefined, ...(me?.role === 'OWNER' ? { customRoleId: cr?.id ?? null } : {}), warehouseIds: v.warehouseIds ?? [], branchIds: v.branchIds ?? [] };
      return editing === 'new'
        ? post('/users', body)
        : patch(`/users/${(editing as UserRow).id}`, { ...body, email: undefined, password: v.password || undefined });
    },
    { success: 'Pengguna disimpan', invalidate: ['users'], onSuccess: () => setEditing(null) },
  );

  const { modal } = App.useApp();
  const reset2fa = useAction((u: UserRow) => patch(`/users/${u.id}`, { resetTwoFactor: true }), {
    success: 'Verifikasi 2 langkah di-reset. Pengguna perlu mengaktifkannya lagi saat masuk.',
    invalidate: ['users'],
    onSuccess: () => setEditing(null),
  });
  const canReset = (u: UserRow) =>
    u.id !== me?.id && (me?.role === 'OWNER' || !['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'].includes(u.role));

  const roles = ROLES.filter((r) => r !== 'OWNER' || me?.role === 'OWNER');

  return (
    <>
      <ListPage<UserRow>
        title="Pengguna"
        actions={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields();
              form.setFieldsValue({ role: 'SALES' });
              setEditing('new');
            }}
          >
            Pengguna baru
          </Button>
        }
        rows={data}
        loading={isLoading}
        below={
          data && data.some((u) => u.isActive && u.role === 'FINANCE') && !data.some((u) => u.isActive && u.role === 'ACCOUNTANT') ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="Belum ada pengguna Akuntan"
              description="Pemisahan fungsi: Keuangan memegang uang (kas, bank, pembayaran, setor pajak, bayar gaji) dan tidak membukukan. Selama belum ada Akuntan, Pemilik/Admin bertindak sebagai akuntan, dan sistem mengerjakan pembukuan rutin otomatis (penyusutan, jurnal berulang, posting gaji, penilaian ulang valas; kunci periode dan tutup buku dapat dinyalakan di menu Tutup Buku). Tetapkan peran Akuntan bila tim bertambah; jangan menetapkan orang yang sama memegang uang dan membukukan."
            />
          ) : null
        }
        summary={(r) => [
          { label: 'Semua pengguna', value: r.length },
          { label: 'Aktif', value: r.filter((u) => u.isActive).length, tone: 'good' },
          {
            label: 'Verifikasi 2 langkah aktif',
            value: r.filter((u) => u.twoFactor).length,
            hint: 'Makin banyak makin aman',
          },
        ]}
        views={[
          { value: 'all', label: 'Semua', test: () => true },
          { value: 'active', label: 'Aktif', test: (u) => u.isActive },
          { value: 'off', label: 'Nonaktif', test: (u) => !u.isActive },
        ]}
        searchText={(u) => `${u.name} ${u.email}`}
        searchPlaceholder="Cari nama atau email"
        emptyText="Belum ada pengguna"
        scrollX={700}
        onRowClick={(u) => {
          form.resetFields();
          form.setFieldsValue({
            ...u,
            password: undefined,
            warehouseIds: u.warehouseIds ?? [],
            branchIds: u.branchIds ?? [],
          });
          setEditing(u);
        }}
        columns={[
          {
            title: 'Nama',
            dataIndex: 'name',
            render: (n, u) =>
              u.id === me?.id ? (
                <>
                  {n} <Tag>Anda</Tag>
                </>
              ) : (
                n
              ),
          },
          { title: 'Email', dataIndex: 'email' },
          {
            title: 'Peran',
            dataIndex: 'role',
            render: (r: Role, u: UserRow) => (
              <>
                <Tag color={r === 'OWNER' ? 'gold' : 'volcano'}>{roleLabelFor(r, me?.businessModel, me?.roleCustomization)}</Tag>
                {u.customRoleName && <Tag color="purple">{u.customRoleName}</Tag>}
              </>
            ),
          },
          ...((branches.data?.branches.length ?? 0) > 0
            ? [
                {
                  title: 'Akses cabang',
                  dataIndex: 'branchIds',
                  render: (ids: string[] | null | undefined) =>
                    ids?.length ? (
                      ids.map((id) => <Tag key={id}>{brName.get(id) ?? '?'}</Tag>)
                    ) : (
                      <Typography.Text type="secondary">Semua</Typography.Text>
                    ),
                },
              ]
            : []),
          {
            title: t('Akses gudang'),
            dataIndex: 'warehouseIds',
            render: (ids: string[] | null) =>
              ids?.length ? (
                ids.map((id) => <Tag key={id}>{whName.get(id) ?? '?'}</Tag>)
              ) : (
                <Typography.Text type="secondary">Semua</Typography.Text>
              ),
          },
          {
            title: '2FA',
            dataIndex: 'twoFactor',
            render: (on: boolean) =>
              on ? (
                <Tooltip title="Verifikasi 2 langkah aktif">
                  <Tag color="green" icon={<SafetyCertificateOutlined />}>
                    Aktif
                  </Tag>
                </Tooltip>
              ) : (
                <Typography.Text type="secondary">—</Typography.Text>
              ),
          },
          {
            title: 'Status',
            dataIndex: 'isActive',
            render: (a) => (a ? <Tag color="green">Aktif</Tag> : <Tag>Nonaktif</Tag>),
          },
          { title: 'Dibuat', dataIndex: 'createdAt', render: fmtDate },
        ]}
      />
      <Modal
        title={editing === 'new' ? 'Pengguna baru' : 'Ubah pengguna'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
        okText="Simpan"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Form.Item name="name" label="Nama" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email (untuk login)" rules={[{ required: editing === 'new', type: 'email' }]}>
            <Input disabled={editing !== 'new'} />
          </Form.Item>
          <Form.Item
            name="password"
            label={editing === 'new' ? 'Kata sandi awal' : 'Atur ulang kata sandi (opsional)'}
            rules={[
              { required: editing === 'new', min: 8, message: 'Minimal 8 karakter' },
              { max: 72, message: 'Maksimal 72 karakter' },
              { pattern: /(?=.*[A-Za-z])(?=.*\d)/, message: 'Harus mengandung huruf dan angka' },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="role" label="Peran" rules={[{ required: true }]} extra={role && (roleCatalog(me?.businessModel, me?.roleCustomization, me?.apps).find((o) => o.role === role)?.desc ?? ROLE_HELP[role])}>
            <Select
              options={roleCatalog(me?.businessModel, me?.roleCustomization, me?.apps)
                // peran yang tidak ditawarkan tidak muncul, kecuali peran yang sedang dipegang pengguna yang diubah
                .filter((o) => roles.includes(o.role) && (o.offered || (editing && editing !== 'new' && editing.role === o.role)))
                .map((o) => ({ value: o.role, label: o.label }))}
            />
          </Form.Item>
          {me?.role === 'OWNER' && role && role !== 'OWNER' && (customRoles.data ?? []).some((c) => c.baseRole === role) && (
            <Form.Item name="customRoleId" label="Peran khusus (opsional)" extra="Membatasi hak peran ini. Kosong = peran bawaan penuh.">
              <Select allowClear placeholder="Peran bawaan" options={(customRoles.data ?? []).filter((c) => c.baseRole === role).map((c) => ({ value: c.id, label: c.name }))} />
            </Form.Item>
          )}
          {editing && editing !== 'new' && role && role !== editing.role && [role, editing.role].every((r) => r === 'FINANCE' || r === 'ACCOUNTANT') && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="Perpindahan Keuangan ↔ Akuntan"
              description="Dua peran ini saling mengawasi. Perpindahan ini dicatat di jejak audit dan ditandai di Cek kesehatan selama 180 hari. Pastikan alasannya sah dan tinjau transaksi yang dibuat pengguna ini."
            />
          )}
          {role && (
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
              Aplikasi yang bisa dibuka:{' '}
              {APPS.filter((a) => canUseApp(role, a.key))
                .map((a) => a.name)
                .join(', ')}
            </Typography.Paragraph>
          )}
          {(branches.data?.branches.length ?? 0) > 0 && (
            <Form.Item
              name="branchIds"
              label="Akses cabang"
              extra="Kosongkan = boleh melihat semua cabang dan laporan gabungan. Jika diisi, pengguna hanya melihat laporan cabang itu (tidak bisa melihat cabang lain, Pusat, atau konsolidasi)."
            >
              <Select
                mode="multiple"
                allowClear
                placeholder="Semua cabang"
                options={branches.data?.branches
                  .filter((b) => b.isActive)
                  .map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))}
              />
            </Form.Item>
          )}
          {(warehouses?.length ?? 0) > 1 && (
            <Form.Item
              name="warehouseIds"
              label={t('Akses gudang')}
              extra={t(
                'Kosongkan = boleh semua gudang. Jika diisi, pengguna hanya melihat & mengubah stok gudang tersebut (tetap boleh mengirim transfer ke gudang lain).',
              )}
            >
              <Select
                mode="multiple"
                allowClear
                placeholder={t('Semua gudang')}
                options={warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))}
              />
            </Form.Item>
          )}
          {editing !== 'new' && editing && (
            <Space align="start" size="large" wrap>
              <Form.Item name="isActive" label="Aktif" valuePropName="checked">
                <Switch />
              </Form.Item>
              {editing.twoFactor && canReset(editing) && (
                <Form.Item label="Verifikasi 2 langkah" extra="Gunakan bila pengguna kehilangan HP">
                  <Button
                    danger
                    loading={reset2fa.isPending}
                    onClick={() =>
                      modal.confirm({
                        title: `Reset verifikasi 2 langkah ${editing.name}?`,
                        content:
                          'Pengguna akan keluar dari semua perangkat dan bisa masuk hanya dengan kata sandi, lalu mengaktifkan 2FA lagi. Pastikan Anda sudah memastikan identitasnya.',
                        okText: 'Reset 2FA',
                        okButtonProps: { danger: true },
                        onOk: () => reset2fa.mutateAsync(editing),
                      })
                    }
                  >
                    Reset 2FA
                  </Button>
                </Form.Item>
              )}
            </Space>
          )}
        </Form>
      </Modal>
      {me?.role === 'OWNER' && <CustomRolesCard />}
    </>
  );
}
