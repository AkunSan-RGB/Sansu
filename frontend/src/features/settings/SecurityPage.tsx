import type { TwoFactorRequirement } from '@sansu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Radio, Space, Tag, Typography } from 'antd';
import { del, get, post, put } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import { MyTwoFactor } from './security/MyTwoFactor';

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

/** Notifikasi Telegram: hubungkan akun sekali agar permintaan persetujuan juga masuk ke Telegram (gratis) */
function MyTelegram() {
  const q = useQuery({ queryKey: ['telegram'], queryFn: () => get<{ enabled: boolean; botUsername: string | null; linked: boolean }>('/auth/telegram'), refetchInterval: (query) => (query.state.data?.linked ? false : 4000) });
  const link = useAction(() => post<{ url: string | null; code: string; expiresInMinutes: number }>('/auth/telegram/link'), {
    onSuccess: (r) => {
      if (r.url) window.open(r.url, '_blank', 'noopener');
    },
  });
  const unlink = useAction(() => del('/auth/telegram'), { success: 'Telegram diputuskan', invalidate: ['telegram'] });
  const st = q.data;
  return (
    <Card title="Notifikasi Telegram" style={{ marginBottom: 16 }}>
      {!st?.enabled ? (
        <Alert type="info" showIcon message="Telegram belum diaktifkan di server" description="Pemilik layanan perlu mengisi TELEGRAM_BOT_TOKEN dan TELEGRAM_BOT_USERNAME di file .env server (bot dibuat gratis lewat @BotFather). Sampai itu, notifikasi tetap lewat email." />
      ) : st.linked ? (
        <Space direction="vertical">
          <Typography.Text>
            <Tag color="green">Terhubung</Tag> Permintaan persetujuan yang menunggu keputusan Anda dikirim ke Telegram beserta tautan pribadi untuk memutuskan.
          </Typography.Text>
          <Button danger loading={unlink.isPending} onClick={() => unlink.mutate(undefined)}>
            Putuskan Telegram
          </Button>
        </Space>
      ) : (
        <Space direction="vertical">
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            Terima permintaan persetujuan (PO, permintaan beli, faktur selisih harga, jurnal manual) langsung di Telegram, gratis. Klik tombol, buka bot, lalu tekan <strong>Start</strong>. Hanya chat pribadi yang diterima.
          </Typography.Paragraph>
          <Button type="primary" loading={link.isPending} disabled={!st.botUsername} onClick={() => link.mutate(undefined)}>
            Hubungkan Telegram
          </Button>
          {link.data && <Typography.Text type="secondary">Tautan berlaku {link.data.expiresInMinutes} menit. Halaman ini otomatis berubah setelah terhubung.</Typography.Text>}
          {!st.botUsername && <Typography.Text type="warning">Nama bot belum diisi (TELEGRAM_BOT_USERNAME).</Typography.Text>}
        </Space>
      )}
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
      <MyTelegram />
      {me?.role === 'OWNER' && <CompanyPolicy />}
    </div>
  );
}
