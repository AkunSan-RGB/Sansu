import { localize } from '@sansu/shared';
import { Flex, Typography } from 'antd';
import { ReactNode } from 'react';
import { useAuth } from '@/auth/AuthContext';

/** Judul halaman berupa teks otomatis memakai istilah jenis usaha (mis. "Pelanggan" → "Klien" untuk jasa) */
export default function PageHeader({ title, extra }: { title: ReactNode; extra?: ReactNode }) {
  const { me } = useAuth();
  return (
    <Flex justify="space-between" align="center" wrap gap={12} style={{ marginBottom: 16 }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {typeof title === 'string' ? localize(title, me?.businessModel) : title}
      </Typography.Title>
      {extra}
    </Flex>
  );
}
