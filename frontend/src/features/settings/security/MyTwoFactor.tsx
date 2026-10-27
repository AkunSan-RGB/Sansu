import { CheckCircleFilled, LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import type { TwoFactorStatus } from '@sansu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Modal, Space, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { SetupWizard } from './SetupWizard';
import { BackupCodes } from './BackupCodes';

export function MyTwoFactor() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['2fa'], queryFn: () => get<TwoFactorStatus>('/auth/2fa') });
  const [setup, setSetup] = useState(false);
  const [disable, setDisable] = useState(false);
  const [regen, setRegen] = useState(false);
  const [newCodes, setNewCodes] = useState<string[]>();
  const [form] = Form.useForm();
  const [regenForm] = Form.useForm();
  const off = useAction((v: { password: string; code: string }) => post('/auth/2fa/disable', v), {
    success: 'Verifikasi 2 langkah dimatikan',
    onSuccess: () => {
      setDisable(false);
      form.resetFields();
      void qc.invalidateQueries({ queryKey: ['2fa'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const regenerate = useAction((code: string) => post<{ backupCodes: string[] }>('/auth/2fa/backup-codes', { code }), {
    onSuccess: (r) => {
      setNewCodes(r.backupCodes);
      regenForm.resetFields();
      void qc.invalidateQueries({ queryKey: ['2fa'] });
    },
  });

  return (
    <Card
      title={
        <Space>
          <SafetyCertificateOutlined /> Verifikasi 2 langkah (2FA)
        </Space>
      }
      extra={
        data?.enabled ? (
          <Tag color="green" icon={<CheckCircleFilled />}>
            Aktif
          </Tag>
        ) : (
          <Tag>Belum aktif</Tag>
        )
      }
      style={{ marginBottom: 16 }}
    >
      <Typography.Paragraph type="secondary">
        Selain kata sandi, setiap kali masuk Anda diminta kode 6 angka dari aplikasi di HP. Akun tetap aman walaupun
        kata sandi bocor.
      </Typography.Paragraph>
      {data?.required && !data.enabled && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="Perusahaan Anda mewajibkan verifikasi 2 langkah"
          description="Aktifkan sekarang untuk bisa memakai SANSU kembali."
        />
      )}
      {data?.enabled ? (
        <>
          <Typography.Paragraph>
            Aktif sejak {dayjs(data.enabledAt).format('DD MMM YYYY HH:mm')} · sisa kode cadangan:{' '}
            <strong>{data.backupCodesLeft}</strong>
            {data.backupCodesLeft <= 3 && (
              <Tag color="orange" style={{ marginLeft: 8 }}>
                Hampir habis
              </Tag>
            )}
          </Typography.Paragraph>
          <Space wrap>
            <Button onClick={() => setRegen(true)}>Buat kode cadangan baru</Button>
            {!data.required && (
              <Button danger onClick={() => setDisable(true)}>
                Matikan
              </Button>
            )}
          </Space>
        </>
      ) : (
        <Button type="primary" icon={<LockOutlined />} onClick={() => setSetup(true)}>
          Aktifkan verifikasi 2 langkah
        </Button>
      )}

      <SetupWizard open={setup} onClose={() => setSetup(false)} />

      <Modal
        title="Matikan verifikasi 2 langkah"
        open={disable}
        onCancel={() => setDisable(false)}
        onOk={() => form.submit()}
        okText="Matikan"
        okButtonProps={{ danger: true, loading: off.isPending }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(v) => off.mutate(v)}>
          <Form.Item name="password" label="Kata sandi" rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item name="code" label="Kode 6 angka atau kode cadangan" rules={[{ required: true }]}>
            <Input autoComplete="one-time-code" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Kode cadangan baru"
        open={regen}
        onCancel={() => {
          setRegen(false);
          setNewCodes(undefined);
        }}
        footer={
          newCodes ? (
            <Button
              type="primary"
              onClick={() => {
                setRegen(false);
                setNewCodes(undefined);
              }}
            >
              Selesai
            </Button>
          ) : (
            <Button type="primary" loading={regenerate.isPending} onClick={() => regenForm.submit()}>
              Buat kode baru
            </Button>
          )
        }
        destroyOnHidden
      >
        {newCodes ? (
          <BackupCodes codes={newCodes} />
        ) : (
          <Form form={regenForm} layout="vertical" onFinish={(v) => regenerate.mutate(String(v.code).trim())}>
            <Typography.Paragraph type="secondary">
              Kode cadangan lama tidak berlaku lagi setelah kode baru dibuat.
            </Typography.Paragraph>
            <Form.Item
              name="code"
              label="Kode 6 angka dari aplikasi"
              rules={[{ required: true, pattern: /^\d{6}$/, message: 'Masukkan 6 angka' }]}
            >
              <Input inputMode="numeric" maxLength={6} autoComplete="one-time-code" />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </Card>
  );
}
