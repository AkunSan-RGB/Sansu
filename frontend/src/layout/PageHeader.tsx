import { t } from '@/lib/terms';
import { Flex, Typography } from 'antd';
import { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { PAGE_HINTS } from './pageHints';

/** Judul halaman berupa teks otomatis memakai istilah jenis usaha (mis. "Pelanggan" → "Klien" untuk jasa) */
export default function PageHeader({ title, extra, subtitle }: { title: ReactNode; extra?: ReactNode; /** Keterangan singkat di bawah judul: halaman ini untuk apa */ subtitle?: ReactNode }) {
  // berlangganan data pengguna: judul ikut berganti istilah saat jenis usaha / profil layanan berubah
  useAuth();
  const { pathname } = useLocation();
  const rawHint = subtitle ?? PAGE_HINTS[pathname.replace(/\/+$/, '') || '/'];
  const hint = typeof rawHint === 'string' ? t(rawHint) : rawHint;
  return (
    <Flex className="no-print" justify="space-between" align="center" wrap gap={12} style={{ marginBottom: 16 }}>
      <div style={{ minWidth: 0 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {typeof title === 'string' ? t(title) : title}
        </Typography.Title>
        {hint && <Typography.Text type="secondary">{hint}</Typography.Text>}
      </div>
      {extra}
    </Flex>
  );
}
