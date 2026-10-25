import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Modal, QRCode, Result, Space, Steps, Typography } from 'antd';
import { useState } from 'react';
import { post } from '@/api/client';
import { useAction } from '@/api/queries';
import { BackupCodes } from './BackupCodes';

/** Aktifkan 2FA: scan QR → konfirmasi kode → kode cadangan */
export function SetupWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [secret, setSecret] = useState<{ secret: string; otpauthUrl: string }>();
  const [codes, setCodes] = useState<string[]>();
  const [form] = Form.useForm();
  const start = useAction(() => post<{ secret: string; otpauthUrl: string }>('/auth/2fa/setup'), {
    onSuccess: (r) => setSecret(r),
  });
  const enable = useAction((code: string) => post<{ backupCodes: string[] }>('/auth/2fa/enable', { code }), {
    onSuccess: (r) => {
      setCodes(r.backupCodes);
      setStep(2);
      qc.invalidateQueries({ queryKey: ['2fa'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const close = () => {
    setStep(0);
    setSecret(undefined);
    setCodes(undefined);
    form.resetFields();
    onClose();
  };
  return (
    <Modal
      title="Aktifkan verifikasi 2 langkah"
      open={open}
      onCancel={step === 2 ? close : close}
      afterOpenChange={(o) => o && !secret && start.mutate(undefined)}
      footer={
        step === 0 ? (
          <Button type="primary" disabled={!secret} onClick={() => setStep(1)}>
            Sudah, lanjut
          </Button>
        ) : step === 1 ? (
          <Space>
            <Button onClick={() => setStep(0)}>Kembali</Button>
            <Button type="primary" loading={enable.isPending} onClick={() => form.submit()}>
              Aktifkan
            </Button>
          </Space>
        ) : (
          <Button type="primary" onClick={close}>
            Saya sudah menyimpan kodenya
          </Button>
        )
      }
      width={520}
      maskClosable={false}
      destroyOnHidden
    >
      <Steps
        size="small"
        current={step}
        items={[{ title: 'Scan QR' }, { title: 'Masukkan kode' }, { title: 'Kode cadangan' }]}
        style={{ marginBottom: 20 }}
      />
      {step === 0 && (
        <>
          <Typography.Paragraph>
            1. Pasang aplikasi <strong>Google Authenticator</strong> atau <strong>Microsoft Authenticator</strong> di
            HP.
            <br />
            2. Di aplikasi, pilih <em>Tambah akun → Pindai kode QR</em>, lalu arahkan kamera ke kode berikut.
          </Typography.Paragraph>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0 12px' }}>
            {secret ? (
              <QRCode value={secret.otpauthUrl} size={200} bordered />
            ) : (
              <QRCode value="-" status="loading" size={200} />
            )}
          </div>
          {secret && (
            <Typography.Paragraph type="secondary" style={{ textAlign: 'center', fontSize: 12 }}>
              Tidak bisa memindai? Masukkan kunci ini secara manual:
              <br />
              <Typography.Text copyable code style={{ fontSize: 13 }}>
                {secret.secret.replace(/(.{4})/g, '$1 ').trim()}
              </Typography.Text>
            </Typography.Paragraph>
          )}
        </>
      )}
      {step === 1 && (
        <Form form={form} layout="vertical" onFinish={(v) => enable.mutate(String(v.code).trim())}>
          <Typography.Paragraph>Masukkan 6 angka yang muncul di aplikasi untuk akun SANSU.</Typography.Paragraph>
          <Form.Item name="code" rules={[{ required: true, pattern: /^\d{6}$/, message: 'Masukkan 6 angka' }]}>
            <Input
              size="large"
              autoFocus
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              autoComplete="one-time-code"
              style={{ letterSpacing: 8, fontSize: 22, textAlign: 'center' }}
            />
          </Form.Item>
        </Form>
      )}
      {step === 2 && codes && (
        <>
          <Result status="success" title="Verifikasi 2 langkah aktif" style={{ padding: '0 0 12px' }} />
          <BackupCodes codes={codes} />
        </>
      )}
    </Modal>
  );
}
