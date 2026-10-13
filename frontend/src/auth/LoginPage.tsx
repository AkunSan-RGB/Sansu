import { BRAND } from '@sansu/shared';
import { Alert, Button, Form, Grid, Input, Tabs } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { CSSProperties, useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { get, post } from '@/api/client';
import Logo, { LogoMark } from '@/brand/Logo';
import { PASSWORD_RULES } from '@/components/AccountMenu';
import BusinessModelPicker from '@/components/BusinessModelPicker';
import { useAuth } from './AuthContext';
import './login.css';
import { clearReturnTo, peekReturnTo } from './returnTo';

const LAST_EMAIL_KEY = 'sansu.lastEmail';
const readLastEmail = () => {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};
const saveLastEmail = (email: string) => {
  try {
    localStorage.setItem(LAST_EMAIL_KEY, email);
  } catch {
    /* penyimpanan browser tidak tersedia */
  }
};
const trim = (v?: string) => (v ?? '').trim();
const delay = (s: number): CSSProperties => ({ ['--d' as string]: `${s}s` });

export default function LoginPage() {
  const { me, login, loginTwoFactor, register } = useAuth();
  const screens = Grid.useBreakpoint();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [caps, setCaps] = useState(false);
  /** Langkah kedua: kode dari aplikasi authenticator */
  const [challenge, setChallenge] = useState<string>();
  /** Email yang belum diverifikasi: tampilkan petunjuk cek email + kirim ulang */
  const [verifyEmail, setVerifyEmail] = useState<string>();
  const [resent, setResent] = useState(false);
  const [useBackup, setUseBackup] = useState(false);
  const [codeForm] = Form.useForm<{ code: string }>();
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Status server + pendaftaran mandiri (bisa ditutup oleh pengelola server: ALLOW_SIGNUP=false)
  const health = useQuery({
    queryKey: ['health-public'],
    queryFn: () => get<{ signup?: boolean }>('/health'),
    staleTime: 60_000,
    retry: 1,
    retryDelay: 1500,
  });
  const signupOpen = health.data?.signup !== false;
  const server: 'ok' | 'wait' | 'down' = health.isError ? 'down' : health.isPending ? 'wait' : 'ok';

  // Sorotan cahaya mengikuti kursor (satu pembaruan per frame)
  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        root.style.setProperty('--mx', `${e.clientX}px`);
        root.style.setProperty('--my', `${e.clientY}px`);
        const card = cardRef.current?.getBoundingClientRect();
        if (card) {
          cardRef.current!.style.setProperty('--cx', `${e.clientX - card.left}px`);
          cardRef.current!.style.setProperty('--cy', `${e.clientY - card.top}px`);
        }
      });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  // setelah masuk: kembali ke halaman yang tadi dituju (bila ada), lalu bersihkan pengingatnya
  useEffect(() => {
    if (me) clearReturnTo();
  }, [me]);
  if (me) return <Navigate to={peekReturnTo() ?? '/'} replace />;

  const run = async (fn: () => Promise<unknown>, email?: string) => {
    if (busy) return; // cegah kirim ganda
    setBusy(true);
    setError(undefined);
    try {
      const r = (await fn()) as { challenge?: string; verifyEmail?: string } | void;
      if (r && r.challenge) {
        setChallenge(r.challenge);
        return;
      }
      if (r && r.verifyEmail) {
        setResent(false);
        setVerifyEmail(r.verifyEmail);
        return;
      }
      if (email) saveLastEmail(email);
      // pengalihan ke halaman tujuan dilakukan oleh <Navigate> di atas begitu profil pengguna terisi
    } catch (e) {
      const data = (e as { data?: { code?: string; email?: string } }).data;
      if (data?.code === 'EMAIL_UNVERIFIED') {
        setResent(false);
        setVerifyEmail(data.email ?? email);
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!verifyEmail || busy) return;
    setBusy(true);
    try {
      await post('/auth/resend-verification-public', { email: verifyEmail });
      setResent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verifyPanel = (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ borderRadius: 12, marginBottom: 16 }}
        message={`Cek email ${verifyEmail}`}
        description="Kami mengirim tautan verifikasi ke email itu. Klik tautannya, lalu masuk. Selama email belum diverifikasi, akun belum bisa dipakai. Periksa juga folder Spam."
      />
      <Button block size="large" loading={busy} disabled={resent} onClick={resend}>
        {resent ? 'Email verifikasi dikirim ulang' : 'Kirim ulang email verifikasi'}
      </Button>
      <div style={{ textAlign: 'center', marginTop: 12 }}>
        <Button type="link" onClick={() => setVerifyEmail(undefined)}>
          Kembali ke halaman masuk
        </Button>
      </div>
    </div>
  );

  const statusPill = (
    <div className={`lg-status ${server} lg-in`} style={delay(0.05)} role="status" aria-live="polite">
      <i />
      {server === 'ok' && 'Server SANSU terhubung'}
      {server === 'wait' && 'Menghubungkan ke server…'}
      {server === 'down' && (
        <>
          Server belum terhubung ·{' '}
          <button type="button" onClick={() => health.refetch()}>
            Coba lagi
          </button>
        </>
      )}
    </div>
  );

  const loginForm = (
    <Form
      name="login"
      layout="vertical"
      requiredMark={false}
      onFinish={(v) => run(() => login(trim(v.email).toLowerCase(), v.password), trim(v.email).toLowerCase())}
      initialValues={import.meta.env.DEV ? { email: 'admin@demo.id', password: 'demo12345' } : { email: readLastEmail() }}
    >
      <Form.Item name="email" label="Email" normalize={trim} rules={[{ required: true, message: 'Masukkan email' }, { type: 'email', message: 'Format email belum benar' }]}>
        <Input size="large" autoComplete="email" inputMode="email" autoFocus={!readLastEmail()} placeholder="nama@perusahaan.com" />
      </Form.Item>
      <Form.Item name="password" label="Kata sandi" rules={[{ required: true, message: 'Masukkan kata sandi' }]} style={{ marginBottom: 8 }}>
        <Input.Password
          size="large"
          autoComplete="current-password"
          autoFocus={!!readLastEmail()}
          onKeyUp={(e) => setCaps(e.getModifierState('CapsLock'))}
          onBlur={() => setCaps(false)}
        />
      </Form.Item>
      {caps && <div className="lg-caps">⚠ Caps Lock sedang aktif</div>}
      <div style={{ textAlign: 'right', marginBottom: 20 }}>
        <Link to="/forgot-password">Lupa kata sandi?</Link>
      </div>
      <Button className="lg-cta" type="primary" size="large" htmlType="submit" block loading={busy}>
        Masuk
      </Button>
    </Form>
  );

  const registerForm = (
    <Form name="register" layout="vertical" initialValues={{ businessModel: 'DAGANG' }} onFinish={(v) => run(() => register({ ...v, companyName: trim(v.companyName), name: trim(v.name), email: trim(v.email).toLowerCase() }))}>
      <Form.Item name="businessModel" label="Model bisnis Anda" extra="Menentukan aplikasi yang disiapkan. Bisa diubah kapan saja.">
        <BusinessModelPicker />
      </Form.Item>
      <Form.Item name="companyName" label="Nama perusahaan" rules={[{ required: true }]}>
        <Input />
      </Form.Item>
      <Form.Item name="name" label="Nama Anda" rules={[{ required: true }]}>
        <Input />
      </Form.Item>
      <Form.Item name="email" label="Email" normalize={trim} rules={[{ required: true, type: 'email' }]}>
        <Input autoComplete="email" />
      </Form.Item>
      <Form.Item name="password" label="Kata sandi (min. 8, huruf & angka)" rules={PASSWORD_RULES}>
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      <Button className="lg-cta" type="primary" htmlType="submit" block loading={busy}>
        Buat akun perusahaan
      </Button>
    </Form>
  );

  const twoFactorForm = challenge && (
    <Form form={codeForm} name="two-factor" layout="vertical" onFinish={(v) => run(() => loginTwoFactor(challenge, v.code.trim()))}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16, borderRadius: 12 }}
        message="Verifikasi 2 langkah"
        description={
          useBackup
            ? 'Masukkan salah satu kode cadangan yang Anda simpan saat mengaktifkan verifikasi 2 langkah.'
            : 'Buka aplikasi authenticator di HP (Google Authenticator, Microsoft Authenticator, dll.) lalu masukkan 6 angka untuk SANSU.'
        }
      />
      <Form.Item name="code" label={useBackup ? 'Kode cadangan' : 'Kode 6 angka'} rules={[{ required: true, message: 'Masukkan kode' }]}>
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
            onChange={(e) => {
              // hanya angka; kirim otomatis begitu 6 angka lengkap
              const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
              codeForm.setFieldValue('code', digits);
              if (digits.length === 6 && !busy) codeForm.submit();
            }}
          />
        )}
      </Form.Item>
      <Button className="lg-cta" type="primary" size="large" htmlType="submit" block loading={busy}>
        Verifikasi & masuk
      </Button>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
        <Button type="link" style={{ padding: 0 }} onClick={() => { setUseBackup((b) => !b); codeForm.resetFields(); }}>
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
  );

  return (
    <div className="lg-root" ref={rootRef}>
      <div className="lg-aurora" aria-hidden>
        <span className="lg-orb a" />
        <span className="lg-orb b" />
        <span className="lg-orb c" />
      </div>
      {screens.lg ? <Hero /> : null}
      <main className="lg-panel">
        {!screens.lg && (
          <div className="lg-in" style={{ textAlign: 'center' }}>
            <Logo size={44} />
            <div style={{ marginTop: 12, color: BRAND.colors.primary, fontWeight: 600, fontSize: 15 }}>{BRAND.tagline}</div>
          </div>
        )}
        {statusPill}
        <div className="lg-card lg-in" style={delay(0.12)} ref={cardRef}>
          <h2>{verifyEmail ? 'Verifikasi email Anda' : challenge ? 'Satu langkah lagi' : 'Selamat datang'}</h2>
          <p className="lg-lead">{challenge ? 'Pastikan ini benar-benar Anda.' : `Masuk untuk mengelola bisnis Anda di ${BRAND.name}.`}</p>
          {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16, borderRadius: 12 }} />}
          {verifyEmail ? (
            verifyPanel
          ) : challenge ? (
            twoFactorForm
          ) : (
            <Tabs
              onChange={() => setError(undefined)}
              items={[
                { key: 'login', label: 'Masuk', children: loginForm },
                { key: 'register', label: 'Coba gratis', children: registerForm },
              ].filter((t) => t.key !== 'register' || signupOpen)}
            />
          )}
        </div>
        {!screens.lg && <ValueChips />}
      </main>
    </div>
  );
}

/** Panel kiri (layar lebar): logo, tagline, dan makna SANSU yang menyala bergantian. */
function Hero() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = BRAND.values.length;

  useEffect(() => {
    if (paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setActive((a) => (a + 1) % n), 2800);
    return () => clearInterval(t);
  }, [paused, n]);

  return (
    <div className="lg-hero">
      <div className="lg-grid" aria-hidden />
      <div className="lg-bigmark" aria-hidden>
        <LogoMark size={460} tone="light" />
      </div>

      <div className="lg-in" style={{ position: 'relative' }}>
        <Logo size={42} tone="light" />
      </div>

      <div style={{ position: 'relative', maxWidth: 540 }}>
        <h1 className="lg-title lg-in" style={delay(0.1)}>
          Alur Bisnis Terhubung dalam <em>Satu Sistem</em>
        </h1>
        <p className="lg-sub lg-in" style={delay(0.2)}>
          Dari penjualan, stok, hingga pajak dan laporan — semuanya mengalir otomatis, akurat sampai rupiah terakhir.
        </p>

        <div className="lg-vals lg-in" style={delay(0.3)} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
          <div className="lg-rail" aria-hidden>
            <i style={{ height: `${((active + 1) / n) * 100}%` }} />
          </div>
          {BRAND.values.map((v, i) => (
            <div key={i} className={`lg-val${i === active ? ' on' : ''}`} onMouseEnter={() => setActive(i)}>
              <span className="lg-badge">{v.letter}</span>
              <div style={{ minWidth: 0, paddingTop: 1 }}>
                <div className="lg-word">
                  <b>{v.word.charAt(0)}</b>
                  {v.word.slice(1)}
                </div>
                <div className="lg-text">{v.text}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="lg-trust lg-in" style={delay(0.45)}>
          <span>Data tiap perusahaan terisolasi</span>
          <span>Verifikasi 2 langkah</span>
          <span>Jejak audit lengkap</span>
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
    <div className="lg-in" style={{ ...delay(0.25), display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, maxWidth: 420 }}>
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
            background: 'rgba(255,255,255,0.8)',
            border: '1px solid #e3e8f0',
            fontSize: 12.5,
            color: BRAND.colors.mark,
          }}
        >
          <b style={{ width: 22, height: 22, borderRadius: 999, display: 'grid', placeItems: 'center', background: BRAND.colors.primary, color: '#fff', fontSize: 12 }}>
            {v.letter}
          </b>
          {v.word}
        </span>
      ))}
    </div>
  );
}
