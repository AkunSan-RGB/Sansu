import { BRAND } from '@sansu/shared';
import { Alert, Button, Card, Form, Grid, Input, Tabs, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { get } from '@/api/client';
import Logo, { LogoMark } from '@/brand/Logo';
import { PASSWORD_RULES } from '@/components/AccountMenu';
import BusinessModelPicker from '@/components/BusinessModelPicker';
import { useAuth } from './AuthContext';

export default function LoginPage() {
  const { me, login, loginTwoFactor, register } = useAuth();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  /** Langkah kedua: kode dari aplikasi authenticator */
  const [challenge, setChallenge] = useState<string>();
  const [useBackup, setUseBackup] = useState(false);
  // Pendaftaran mandiri bisa ditutup oleh pengelola server (ALLOW_SIGNUP=false)
  const health = useQuery({
    queryKey: ['health-public'],
    queryFn: () => get<{ signup?: boolean }>('/health'),
    staleTime: 60_000,
  });
  const signupOpen = health.data?.signup !== false;

  if (me) return <Navigate to="/" replace />;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      const r = (await fn()) as { challenge?: string } | void;
      if (r && r.challenge) {
        setChallenge(r.challenge);
        return;
      }
      navigate('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <Card
      variant="borderless"
      style={{
        width: '100%',
        maxWidth: 420,
        borderRadius: 16,
        boxShadow: '0 1px 2px rgba(13,22,40,0.04), 0 18px 48px -12px rgba(13,22,40,0.16)',
      }}
      styles={{ body: { padding: screens.sm ? 36 : 24 } }}
    >
      <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4, fontWeight: 700 }}>
        Selamat datang
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 20 }}>
        Masuk untuk mengelola bisnis Anda di {BRAND.name}.
      </Typography.Paragraph>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      {challenge ? (
        <Form name="two-factor" layout="vertical" onFinish={(v) => run(() => loginTwoFactor(challenge, v.code))}>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Verifikasi 2 langkah"
            description={
              useBackup
                ? 'Masukkan salah satu kode cadangan yang Anda simpan saat mengaktifkan verifikasi 2 langkah.'
                : 'Buka aplikasi authenticator di HP (Google Authenticator, Microsoft Authenticator, dll.) lalu masukkan 6 angka untuk SANSU.'
            }
          />
          <Form.Item
            name="code"
            label={useBackup ? 'Kode cadangan' : 'Kode 6 angka'}
            rules={[{ required: true, message: 'Masukkan kode' }]}
          >
            {useBackup ? (
              <Input size="large" autoFocus placeholder="xxxx-xxxx" autoComplete="off" />
            ) : (
              <Input
                size="large"
                autoFocus
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                autoComplete="one-time-code"
                style={{ letterSpacing: 8, fontSize: 22, textAlign: 'center' }}
              />
            )}
          </Form.Item>
          <Button type="primary" size="large" htmlType="submit" block loading={busy}>
            Verifikasi & masuk
          </Button>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
            <Button type="link" style={{ padding: 0 }} onClick={() => setUseBackup((b) => !b)}>
              {useBackup ? 'Pakai kode dari aplikasi' : 'Pakai kode cadangan'}
            </Button>
            <Button
              type="link"
              style={{ padding: 0 }}
              onClick={() => {
                setChallenge(undefined);
                setUseBackup(false);
                setError(undefined);
              }}
            >
              Kembali
            </Button>
          </div>
        </Form>
      ) : (
        <Tabs
          items={[
            {
              key: 'login',
              label: 'Masuk',
              children: (
                <Form
                  name="login"
                  layout="vertical"
                  onFinish={(v) => run(() => login(v.email, v.password))}
                  initialValues={import.meta.env.DEV ? { email: 'admin@demo.id', password: 'demo12345' } : undefined}
                >
                  <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
                    <Input size="large" autoComplete="email" />
                  </Form.Item>
                  <Form.Item
                    name="password"
                    label="Kata sandi"
                    rules={[{ required: true }]}
                    style={{ marginBottom: 8 }}
                  >
                    <Input.Password size="large" autoComplete="current-password" />
                  </Form.Item>
                  <div style={{ textAlign: 'right', marginBottom: 20 }}>
                    <Link to="/forgot-password">Lupa kata sandi?</Link>
                  </div>
                  <Button type="primary" size="large" htmlType="submit" block loading={busy}>
                    Masuk
                  </Button>
                </Form>
              ),
            },
            {
              key: 'register',
              label: 'Coba gratis',
              children: (
                <Form name="register" layout="vertical" initialValues={{ businessModel: 'DAGANG' }} onFinish={(v) => run(() => register(v))}>
                  <Form.Item name="businessModel" label="Model bisnis Anda" extra="Menentukan aplikasi yang disiapkan. Bisa diubah kapan saja.">
                    <BusinessModelPicker />
                  </Form.Item>
                  <Form.Item name="companyName" label="Nama perusahaan" rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="name" label="Nama Anda" rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="password" label="Kata sandi (min. 8, huruf & angka)" rules={PASSWORD_RULES}>
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block loading={busy}>
                    Buat akun perusahaan
                  </Button>
                </Form>
              ),
            },
          ].filter((t) => t.key !== 'register' || signupOpen)}
        />
      )}
    </Card>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: BRAND.colors.surface }}>
      {screens.lg ? <Hero /> : null}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px 16px',
          gap: 28,
        }}
      >
        {!screens.lg && (
          <div style={{ textAlign: 'center' }}>
            <Logo size={44} />
            <div style={{ marginTop: 12, color: BRAND.colors.primary, fontWeight: 600, fontSize: 15 }}>
              {BRAND.tagline}
            </div>
          </div>
        )}
        {form}
        {!screens.lg && <ValueChips />}
      </div>
    </div>
  );
}

/** Panel kiri (layar lebar): logo, tagline, dan makna SANSU. */
function Hero() {
  const c = BRAND.colors;
  return (
    <div
      style={{
        flex: '0 0 52%',
        maxWidth: 760,
        position: 'relative',
        overflow: 'hidden',
        color: '#fff',
        padding: '48px 64px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 40,
        background: `radial-gradient(900px 520px at 100% 0%, ${c.accent}26, transparent 60%), radial-gradient(700px 500px at 0% 100%, #2A4580aa, transparent 65%), linear-gradient(155deg, ${c.inkSoft} 0%, ${c.ink} 55%, #080F1D 100%)`,
      }}
    >
      {/* garis diagonal halus — gema dari garis hijau di logo */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'repeating-linear-gradient(-45deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 28px)',
          maskImage: 'linear-gradient(180deg, #000 0%, transparent 85%)',
          WebkitMaskImage: 'linear-gradient(180deg, #000 0%, transparent 85%)',
        }}
      />
      {/* tanda besar samar di pojok */}
      <div aria-hidden style={{ position: 'absolute', right: -90, bottom: -70, opacity: 0.06 }}>
        <LogoMark size={460} tone="light" />
      </div>

      <div style={{ position: 'relative' }}>
        <Logo size={42} tone="light" />
      </div>

      <div style={{ position: 'relative', maxWidth: 520 }}>
        <h1
          style={{
            color: '#fff',
            fontSize: 40,
            lineHeight: 1.15,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            margin: '0 0 36px',
          }}
        >
          {BRAND.tagline}
        </h1>

        {/* makna SANSU: lima huruf tersambung satu alur */}
        <div style={{ position: 'relative' }}>
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: 21,
              top: 26,
              bottom: 26,
              width: 1,
              background: `linear-gradient(180deg, ${c.accent}cc 0%, ${c.accent}55 50%, rgba(255,255,255,0.08) 100%)`,
            }}
          />
          {BRAND.values.map((v, i) => (
            <div
              key={i}
              style={{ position: 'relative', display: 'flex', gap: 20, alignItems: 'flex-start', padding: '9px 0' }}
            >
              <span
                style={{
                  flex: 'none',
                  width: 43,
                  height: 43,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 17,
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                  color: '#fff',
                  background: `radial-gradient(circle at 30% 25%, ${c.accent}55, ${c.ink} 72%)`,
                  boxShadow: `0 0 0 1px ${c.accent}80, 0 0 0 5px ${c.ink}, 0 8px 22px -10px ${c.accent}`,
                }}
              >
                {v.letter}
              </span>
              <div style={{ minWidth: 0, paddingTop: 1 }}>
                <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '0.03em', lineHeight: 1.35 }}>
                  <span style={{ color: c.accent }}>{v.word.charAt(0)}</span>
                  {v.word.slice(1)}
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.55, color: 'rgba(255,255,255,0.62)', marginTop: 2 }}>
                  {v.text}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <span style={{ position: 'relative', color: 'rgba(255,255,255,0.45)', fontSize: 12.5 }}>
        © {new Date().getFullYear()} {BRAND.company}
      </span>
    </div>
  );
}

/** Versi ringkas makna SANSU untuk layar HP. */
function ValueChips() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, maxWidth: 420 }}>
      {BRAND.values.map((v, i) => (
        <span
          key={i}
          title={v.text}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px 4px 4px',
            borderRadius: 999,
            background: '#fff',
            border: '1px solid #e3e8f0',
            fontSize: 12.5,
            color: BRAND.colors.mark,
          }}
        >
          <b
            style={{
              width: 22,
              height: 22,
              borderRadius: 999,
              display: 'grid',
              placeItems: 'center',
              background: BRAND.colors.primary,
              color: '#fff',
              fontSize: 12,
            }}
          >
            {v.letter}
          </b>
          {v.word}
        </span>
      ))}
    </div>
  );
}
