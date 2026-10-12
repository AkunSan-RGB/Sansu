import type { AppKey } from '@sansu/shared';
import { APP_BY_KEY } from '@sansu/shared';
import { Button, Result } from 'antd';
import { Outlet, useNavigate } from 'react-router-dom';
import { useApps } from '@/lib/apps';

/** Halaman milik aplikasi tertentu: tolak jika aplikasi nonaktif atau peran tidak berhak */
export default function AppGate({ app, admin }: { app?: AppKey | AppKey[]; admin?: boolean }) {
  const { can, enabled, isAdmin } = useApps();
  const navigate = useNavigate();
  const keys = app ? (Array.isArray(app) ? app : [app]) : [];
  const ok = admin ? isAdmin : keys.some(can);
  if (ok) return <Outlet />;
  const inactive = keys.length && !keys.some((k) => enabled.has(k));
  return (
    <Result
      status={inactive ? 'info' : '403'}
      title={inactive ? `Aplikasi ${keys.map((k) => APP_BY_KEY[k].name).join(' / ')} belum aktif` : 'Tidak punya akses'}
      subTitle={inactive ? 'Pemilik atau admin dapat mengaktifkannya di menu Aplikasi.' : 'Peran Anda tidak diizinkan membuka halaman ini. Hubungi admin perusahaan.'}
      extra={
        <Button type="primary" onClick={() => navigate('/')}>
          Kembali ke menu aplikasi
        </Button>
      }
    />
  );
}
