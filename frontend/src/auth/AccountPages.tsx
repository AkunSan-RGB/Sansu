import { CheckCircleFilled, CloseCircleFilled, MailOutlined } from '@ant-design/icons';
import { BRAND } from '@sansu/shared';
import { Alert, Button, Card, Form, Input, Result, Spin, Typography } from 'antd';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { post } from '@/api/client';
import Logo from '@/brand/Logo';
import { PASSWORD_RULES } from '@/components/AccountMenu';

/** Kerangka halaman akun publik (lupa sandi, atur ulang, verifikasi) */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: BRAND.colors.surface, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 16px', gap: 24 }}>
      <Link to="/login" aria-label="Kembali ke halaman masuk">
        <Logo size={40} />
      </Link>
      <Card variant="borderless" style={{ width: '100%', maxWidth: 420, borderRadius: 16, boxShadow: '0 1px 2px rgba(13,22,40,0.04), 0 18px 48px -12px rgba(13,22,40,0.16)' }} styles={{ body: { padding: 32 } }}>
        {children}
      </Card>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string>();
  const [error, setError] = useState<string>();
  return (
    <Shell>
      {sent ? (
        <Result
          icon={<MailOutlined style={{ color: BRAND.colors.primary }} />}
          title="Cek email Anda"
          subTitle={sent}
          extra={<Link to="/login">Kembali ke halaman masuk</Link>}
        />
      ) : (
        <>
          <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
            Lupa kata sandi
          </Typography.Title>
          <Typography.Paragraph type="secondary">Masukkan email akun Anda. Kami kirimkan tautan untuk membuat kata sandi baru.</Typography.Paragraph>
          {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
          <Form
            name="forgot"
            layout="vertical"
            onFinish={async (v: { email: string }) => {
              setBusy(true);
              setError(undefined);
              try {
                const r = await post<{ message: string }>('/auth/forgot-password', v);
                setSent(r.message);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email', message: 'Isi email yang valid' }]}>
              <Input size="large" autoComplete="email" autoFocus />
            </Form.Item>
            <Button type="primary" size="large" htmlType="submit" block loading={busy}>
              Kirim tautan
            </Button>
          </Form>
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Link to="/login">Kembali ke halaman masuk</Link>
          </div>
        </>
      )}
    </Shell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Shell>
      {done ? (
        <Result status="success" title="Kata sandi sudah diganti" subTitle="Silakan masuk dengan kata sandi baru Anda." extra={<Button type="primary" onClick={() => navigate('/login')}>Masuk</Button>} />
      ) : !token ? (
        <Result status="warning" title="Tautan tidak lengkap" subTitle="Buka tautan langsung dari email, atau minta tautan baru." extra={<Link to="/forgot-password">Minta tautan baru</Link>} />
      ) : (
        <>
          <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
            Buat kata sandi baru
          </Typography.Title>
          <Typography.Paragraph type="secondary">Minimal 8 karakter, berisi huruf dan angka. Semua perangkat lain akan otomatis keluar.</Typography.Paragraph>
          {error && (
            <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} action={<Link to="/forgot-password">Minta ulang</Link>} />
          )}
          <Form
            name="reset"
            layout="vertical"
            onFinish={async (v: { password: string }) => {
              setBusy(true);
              setError(undefined);
              try {
                await post('/auth/reset-password', { token, password: v.password });
                setDone(true);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Form.Item name="password" label="Kata sandi baru" rules={PASSWORD_RULES}>
              <Input.Password size="large" autoComplete="new-password" autoFocus />
            </Form.Item>
            <Form.Item
              name="confirm"
              label="Ulangi kata sandi"
              dependencies={['password']}
              rules={[
                { required: true, message: 'Ulangi kata sandi' },
                ({ getFieldValue }) => ({ validator: (_, v) => (v === getFieldValue('password') ? Promise.resolve() : Promise.reject(new Error('Kata sandi tidak sama'))) }),
              ]}
            >
              <Input.Password size="large" autoComplete="new-password" />
            </Form.Item>
            <Button type="primary" size="large" htmlType="submit" block loading={busy}>
              Simpan kata sandi
            </Button>
          </Form>
        </>
      )}
    </Shell>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'loading' | 'ok' | 'error'>(token ? 'loading' : 'error');
  const [error, setError] = useState('Tautan tidak lengkap. Buka tautan langsung dari email.');
  const once = useRef(false);
  useEffect(() => {
    if (!token || once.current) return;
    once.current = true;
    post('/auth/verify-email', { token })
      .then(() => setState('ok'))
      .catch((e: Error) => {
        setError(e.message);
        setState('error');
      });
  }, [token]);
  return (
    <Shell>
      {state === 'loading' ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>Memverifikasi email…</div>
        </div>
      ) : state === 'ok' ? (
        <Result icon={<CheckCircleFilled style={{ color: BRAND.colors.accent }} />} title="Email terverifikasi" subTitle="Terima kasih. Akun Anda sudah siap dipakai sepenuhnya." extra={<Link to="/">Buka SANSU</Link>} />
      ) : (
        <Result icon={<CloseCircleFilled style={{ color: '#c0392b' }} />} title="Verifikasi gagal" subTitle={error} extra={<Link to="/">Buka SANSU untuk kirim ulang</Link>} />
      )}
    </Shell>
  );
}
