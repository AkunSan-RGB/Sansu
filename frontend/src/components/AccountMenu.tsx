import {
  DownOutlined,
  KeyOutlined,
  LockOutlined,
  LogoutOutlined,
  SafetyOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { roleLabelFor } from '@sansu/shared';
import { App, Button, Dropdown, Form, Grid, Input, Modal, Tag } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, post, tokenStore } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';

export const PASSWORD_RULES = [
  { required: true, message: 'Wajib diisi' },
  { min: 8, message: 'Minimal 8 karakter' },
  { max: 72, message: 'Maksimal 72 karakter' },
  { pattern: /(?=.*[A-Za-z])(?=.*\d)/, message: 'Harus mengandung huruf dan angka' },
];

/** Menu akun di pojok kanan atas: ganti sandi, keluar dari semua perangkat, keluar. */
export default function AccountMenu() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const screens = Grid.useBreakpoint();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  if (!me) return null;

  const change = async (v: { currentPassword: string; newPassword: string }) => {
    setBusy(true);
    try {
      const r = await post<{ accessToken: string }>('/auth/change-password', {
        currentPassword: v.currentPassword,
        newPassword: v.newPassword,
      });
      tokenStore.set(r.accessToken);
      message.success('Kata sandi diganti. Perangkat lain otomatis keluar.');
      setOpen(false);
      form.resetFields();
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : 'Gagal mengganti kata sandi');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dropdown
        trigger={['click']}
        menu={{
          items: [
            { key: 'who', disabled: true, label: <span>{me.email}</span> },
            { type: 'divider' },
            { key: 'pw', icon: <KeyOutlined />, label: 'Ganti kata sandi', onClick: () => setOpen(true) },
            {
              key: 'sec',
              icon: <LockOutlined />,
              label: 'Keamanan akun (2FA)',
              onClick: () => navigate('/account/security'),
            },
            {
              key: 'all',
              icon: <SafetyOutlined />,
              label: 'Keluar dari semua perangkat',
              onClick: () =>
                modal.confirm({
                  title: 'Keluar dari semua perangkat?',
                  content:
                    'Semua sesi yang sedang terbuka (termasuk di HP/komputer lain) akan berakhir. Gunakan bila curiga akun dipakai orang lain.',
                  okText: 'Keluar semua',
                  onOk: async () => {
                    await post('/auth/logout-all');
                    logout();
                  },
                }),
            },
            { type: 'divider' },
            { key: 'out', icon: <LogoutOutlined />, label: 'Keluar', onClick: logout },
          ],
        }}
      >
        <Button icon={<UserOutlined />}>
          {screens.md && (
            <>
              {me.name}{' '}
              <Tag color="volcano" style={{ marginInline: 6 }}>
                {me.roleLabel ?? roleLabelFor(me.role, me.businessModel)}
              </Tag>
            </>
          )}
          <DownOutlined />
        </Button>
      </Dropdown>
      <Modal
        title="Ganti kata sandi"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        okText="Simpan"
        confirmLoading={busy}
        destroyOnHidden
      >
        <Form form={form} name="changePassword" layout="vertical" onFinish={change}>
          <Form.Item
            name="currentPassword"
            label="Kata sandi lama"
            rules={[{ required: true, message: 'Wajib diisi' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item name="newPassword" label="Kata sandi baru" rules={PASSWORD_RULES}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirm"
            label="Ulangi kata sandi baru"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: 'Wajib diisi' },
              ({ getFieldValue }) => ({
                validator: (_, v) =>
                  !v || v === getFieldValue('newPassword')
                    ? Promise.resolve()
                    : Promise.reject(new Error('Tidak sama')),
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
