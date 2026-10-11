import { SUBSCRIPTION_STATUS_LABELS } from '@sansu/shared';
import { Alert, Button, Space } from 'antd';
import { useNavigate } from 'react-router-dom';
import { post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import { useApps } from '@/lib/apps';
import { fmtDate } from '@/lib/format';

/** Pengingat di atas setiap halaman: verifikasi email & status langganan */
export default function AccountStatusBanner() {
  const { me } = useAuth();
  const { isAdmin } = useApps();
  const navigate = useNavigate();
  const resend = useAction(() => post<{ sent?: boolean; alreadyVerified?: boolean }>('/auth/resend-verification'), {
    success: (r) => (r.alreadyVerified ? 'Email sudah terverifikasi' : 'Email verifikasi dikirim ulang — cek kotak masuk & folder spam'),
    invalidate: ['me'],
  });
  if (!me) return null;
  const s = me.subscription;
  const subOn = s.enabled !== false; // saklar langganan dimatikan di Panel SANSU (tahap uji): tanpa banner langganan
  const toBilling = isAdmin ? (
    <Button size="small" type="primary" onClick={() => navigate('/billing')}>
      {s.readOnly ? 'Perpanjang sekarang' : 'Pilih paket'}
    </Button>
  ) : undefined;
  const banners = [];

  if (!me.emailVerified) {
    banners.push(
      <Alert
        key="email"
        type={me.verificationRequired ? 'warning' : 'info'}
        showIcon
        message={me.verificationRequired ? `Verifikasi email ${me.email} untuk mulai mencatat transaksi.` : `Email ${me.email} belum diverifikasi.`}
        description={me.verificationRequired ? 'Klik tautan di email dari SANSU. Sebelum terverifikasi, data belum bisa ditambah atau diubah.' : undefined}
        action={
          <Button size="small" loading={resend.isPending} onClick={() => resend.mutate(undefined)}>
            Kirim ulang
          </Button>
        }
      />,
    );
  }
  if (subOn && s.readOnly) {
    banners.push(
      <Alert
        key="sub"
        type="error"
        showIcon
        message={`Langganan ${SUBSCRIPTION_STATUS_LABELS[s.status].toLowerCase()} — mode baca saja`}
        description={isAdmin ? 'Data tetap bisa dilihat & diekspor. Perpanjang langganan untuk kembali menambah atau mengubah data.' : 'Data tetap bisa dilihat & diekspor. Hubungi pemilik/admin perusahaan untuk memperpanjang langganan.'}
        action={toBilling}
      />,
    );
  } else if (subOn && s.status === 'OVERDUE') {
    banners.push(<Alert key="sub" type="warning" showIcon message={`Masa aktif sudah berakhir. Masa tenggang sampai ${fmtDate(s.graceUntil)}.`} action={toBilling} />);
  } else if (subOn && s.status === 'TRIAL') {
    banners.push(
      <Alert
        key="sub"
        type={(s.daysLeft ?? 0) <= 3 ? 'warning' : 'info'}
        showIcon
        message={`Uji coba gratis paket ${s.plan?.name ?? ''}: ${s.daysLeft} hari lagi (sampai ${fmtDate(s.endsAt)}).`}
        action={toBilling}
      />,
    );
  } else if (s.status === 'ACTIVE' && s.daysLeft != null && s.daysLeft <= 7) {
    banners.push(<Alert key="sub" type="warning" showIcon message={`Langganan berakhir ${s.daysLeft} hari lagi (${fmtDate(s.endsAt)}).`} action={toBilling} />);
  }
  if (!banners.length) return null;
  return (
    <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 16 }} className="no-print">
      {banners}
    </Space>
  );
}
