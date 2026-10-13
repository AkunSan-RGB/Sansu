/** Temuan kontrol pembelian & stok (anti-fraud) 60 hari terakhir */
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Empty, Space, Typography } from 'antd';
import { get } from '@/api/client';
import PageHeader from '@/layout/PageHeader';
import { fmtDate } from '@/lib/format';

interface Finding {
  key: string;
  level: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  refs: string[];
}

export default function PurchaseControlsPage() {
  const q = useQuery({ queryKey: ['purchase-controls'], queryFn: () => get<{ asOf: string; since: string; items: Finding[] }>('/purchase-controls') });
  return (
    <>
      <PageHeader title="Kontrol pembelian" />
      <Card loading={q.isLoading}>
        <Typography.Paragraph type="secondary">
          Pola yang patut diperiksa pada pembelian, pembayaran supplier, dan stok sejak {q.data ? fmtDate(q.data.since) : '…'}. Temuan bukan berarti kecurangan, tetapi layak dikonfirmasi.
        </Typography.Paragraph>
        {q.data && !q.data.items.length && <Empty description="Tidak ada temuan. Bagus!" />}
        <Space direction="vertical" style={{ width: '100%' }}>
          {q.data?.items.map((f) => (
            <Alert
              key={f.key}
              type={f.level}
              showIcon
              message={f.title}
              description={
                <div>
                  <div>{f.detail}</div>
                  <div style={{ marginTop: 4 }}>
                    <strong>Contoh:</strong> {f.refs.slice(0, 6).join(', ')}
                    {f.refs.length > 6 ? `, dan ${f.refs.length - 6} lainnya` : ''}
                  </div>
                </div>
              }
            />
          ))}
        </Space>
      </Card>
    </>
  );
}
