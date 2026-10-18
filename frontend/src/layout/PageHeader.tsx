import { localize } from '@sansu/shared';
import { Flex, Typography } from 'antd';
import { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { PAGE_HINTS } from './pageHints';

/** Judul halaman berupa teks otomatis memakai istilah jenis usaha (mis. "Pelanggan" → "Klien" untuk jasa) */
export default function PageHeader({ title, extra, subtitle }: { title: ReactNode; extra?: ReactNode; /** Keterangan singkat di bawah judul: halaman ini untuk apa */ subtitle?: ReactNode }) {
  const { me } = useAuth();
  const { pathname } = useLocation();
  const hint = subtitle ?? PAGE_HINTS[pathname.replace(/\/+$/, '') || '/'];
  return (
    <Flex className="no-print" justify="space-between" align="center" wrap gap={12} style={{ marginBottom: 16 }}>
      <div style={{ minWidth: 0 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {typeof title === 'string' ? localize(title, me?.businessModel) : title}
        </Typography.Title>
        {hint && <Typography.Text type="secondary">{hint}</Typography.Text>}
      </div>
      {extra}
    </Flex>
  );
}
