/** Temuan kontrol (anti-fraud) 60 hari terakhir; dipakai halaman Kontrol pembelian dan Kontrol penjualan */
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Empty, Space, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
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

export function ControlFindingsPage({ title, endpoint, intro, settings, fixedRules }: { title: string; endpoint: string; intro: string; settings: string[]; fixedRules: string }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: [endpoint.slice(1)], queryFn: () => get<{ asOf: string; since: string; items: Finding[] }>(endpoint) });
  return (
    <>
      <PageHeader title={title} />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Di mana mengatur kontrol ini?"
        description={
          <div>
            <div>
              Halaman ini hanya menampilkan temuan. Batas dan saklarnya diatur di <strong>Pengaturan › Perusahaan › tab Kebijakan</strong> (hanya Pemilik/Admin): {settings.join('; ')}.
            </div>
            <div style={{ marginTop: 4 }}>{fixedRules}</div>
          </div>
        }
        action={
          <Button size="small" onClick={() => navigate('/settings/company?tab=kebijakan')}>
            Buka pengaturan
          </Button>
        }
      />
      <Card loading={q.isLoading}>
        <Typography.Paragraph type="secondary">
          {intro} sejak {q.data ? fmtDate(q.data.since) : '…'}. Temuan bukan berarti kecurangan, tetapi layak dikonfirmasi.
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

export default function PurchaseControlsPage() {
  return (
    <ControlFindingsPage
      title="Kontrol pembelian"
      endpoint="/purchase-controls"
      intro="Pola yang patut diperiksa pada pembelian, pembayaran supplier, dan stok"
      settings={[
        'nilai PO yang butuh persetujuan',
        'toleransi kenaikan harga faktur',
        'pembayaran pertama ke supplier wajib disetujui',
        'penerimaan buta',
        'tahan pembayaran setelah rekening supplier diubah',
      ]}
      fixedRules="Aturan tetap (tidak bisa diatur): alasan wajib saat membatalkan PO, dan tagihan hanya atas barang yang sudah diterima Gudang. Rekening supplier diubah di Pembelian › Supplier."
    />
  );
}
