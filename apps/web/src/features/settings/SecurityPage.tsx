import {
  CheckCircleFilled,
  CopyOutlined,
  DownloadOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { TwoFactorRequirement, TwoFactorStatus } from '@sansu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  QRCode,
  Radio,
  Result,
  Space,
  Steps,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post, put } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';

/** Daftar kode cadangan + tombol salin/unduh */
function BackupCodes({ codes }: { codes: string[] }) {
  const { message } = App.useApp();
  const text = codes.join('\n');
  const download = () => {
    const blob = new Blob([`Kode cadangan SANSU (masing-masing hanya bisa dipakai sekali)\n\n${text}\n`], {
      type: 'text/plain',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'kode-cadangan-sansu.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <>
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="Simpan kode cadangan ini sekarang"
        description="Jika HP hilang atau aplikasi authenticator terhapus, masuk dengan salah satu kode ini. Setiap kode hanya bisa dipakai sekali dan tidak akan ditampilkan lagi."
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 8,
          fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
          fontSize: 16,
          background: '#f5f7fa',
          padding: 16,
          borderRadius: 8,
          marginBottom: 12,
        }}
      >
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <Space wrap>
        <Button
          icon={<CopyOutlined />}
          onClick={() =>
            navigator.clipboard
              .writeText(text)
              .then(() => message.success('Kode disalin'))
              .catch(() => message.error('Gagal menyalin'))
          }
        >
          Salin
        </Button>
        <Button icon={<DownloadOutlined />} onClick={download}>
          Unduh .txt
        </Button>
      </Space>
    </>
  );
}

/** Aktifkan 2FA: scan QR → konfirmasi kode → kode cadangan */
function SetupWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
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

function MyTwoFactor() {
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
      qc.invalidateQueries({ queryKey: ['2fa'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const regenerate = useAction((code: string) => post<{ backupCodes: string[] }>('/auth/2fa/backup-codes', { code }), {
    onSuccess: (r) => {
      setNewCodes(r.backupCodes);
      regenForm.resetFields();
      qc.invalidateQueries({ queryKey: ['2fa'] });
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

const POLICY_OPTIONS: { value: TwoFactorRequirement; label: string; help: string }[] = [
  { value: 'NONE', label: 'Tidak wajib', help: 'Setiap pengguna boleh memilih sendiri.' },
  {
    value: 'ADMINS',
    label: 'Wajib untuk Pemilik, Admin & Keuangan',
    help: 'Disarankan: akun yang bisa mengubah keuangan & pengaturan wajib memakai 2FA.',
  },
  {
    value: 'ALL',
    label: 'Wajib untuk semua pengguna',
    help: 'Semua pengguna harus mengaktifkan 2FA sebelum bisa memakai SANSU.',
  },
];

function CompanyPolicy() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['security-settings'],
    queryFn: () => get<{ require2fa: TwoFactorRequirement }>('/settings/security'),
  });
  const save = useAction((require2fa: TwoFactorRequirement) => put('/settings/security', { require2fa }), {
    success: 'Kebijakan keamanan disimpan',
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['security-settings'] });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
  return (
    <Card title="Kebijakan keamanan perusahaan" style={{ marginBottom: 16 }}>
      <Radio.Group
        value={data?.require2fa ?? 'NONE'}
        onChange={(e) => save.mutate(e.target.value)}
        disabled={save.isPending}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        {POLICY_OPTIONS.map((o) => (
          <Radio key={o.value} value={o.value}>
            <strong>{o.label}</strong>
            <div style={{ color: '#6b7280', fontSize: 13 }}>{o.help}</div>
          </Radio>
        ))}
      </Radio.Group>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
        Pengguna yang belum mengaktifkan akan diarahkan ke halaman ini saat masuk. Jika ada yang kehilangan HP, Pemilik
        bisa me-reset 2FA-nya di menu Pengguna.
      </Typography.Paragraph>
    </Card>
  );
}

/** Halaman Keamanan akun: 2FA pribadi + kebijakan perusahaan (Pemilik) */
export default function SecurityPage() {
  const { me } = useAuth();
  return (
    <div style={{ maxWidth: 760 }}>
      <PageHeader title="Keamanan akun" />
      <MyTwoFactor />
      {me?.role === 'OWNER' && <CompanyPolicy />}
    </div>
  );
}
