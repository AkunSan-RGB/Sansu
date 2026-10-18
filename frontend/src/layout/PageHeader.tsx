import { localize } from '@sansu/shared';
import { Flex, Typography } from 'antd';
import { ReactNode } from 'react';
import { useAuth } from '@/auth/AuthContext';

/** Judul halaman berupa teks otomatis memakai istilah jenis usaha (mis. "Pelanggan" → "Klien" untuk jasa) */
export default function PageHeader({ title, extra, subtitle }: { title: ReactNode; extra?: ReactNode; /** Keterangan singkat di bawah judul: halaman ini untuk apa */ subtitle?: ReactNode }) {
  const { me } = useAuth();
  return (
    <Flex className="no-print" justify="space-between" align="center" wrap gap={12} style={{ marginBottom: 16 }}>
      <div style={{ minWidth: 0 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {typeof title === 'string' ? localize(title, me?.businessModel) : title}
        </Typography.Title>
        {subtitle && <Typography.Text type="secondary">{subtitle}</Typography.Text>}
      </div>
      {extra}
    </Flex>
  );
}
