import { SafetyCertificateOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Empty, Space, Tag, Typography } from 'antd';
import { get } from '@/api/client';
import PageHeader from '@/layout/PageHeader';

interface Finding { key: string; flow: 'PENJUALAN' | 'KASIR' | 'KAS' | 'SDM'; level: 'error' | 'warning' | 'info'; title: string; detail: string; refs: string[] }
const FLOW = { PENJUALAN: 'Penjualan', KASIR: 'Kasir', KAS: 'Kas & bank', SDM: 'SDM & penggajian' } as const;
const COLOR = { error: 'red', warning: 'orange', info: 'blue' } as const;
const LABEL = { error: 'Penting', warning: 'Periksa', info: 'Catatan' } as const;

/** Pola yang patut diperiksa per alur (60 hari terakhir). Hanya menandai, tidak menuduh; kontrol pembelian ada di menu Pembelian. */
export default function FlowControlsPage() {
  const { data, isLoading } = useQuery({ queryKey: ['controls', 'flows'], queryFn: () => get<Finding[]>('/controls/flows') });
  const groups = (Object.keys(FLOW) as (keyof typeof FLOW)[]).map((k) => ({ k, items: (data ?? []).filter((f) => f.flow === k) })).filter((g) => g.items.length);
  return (
    <>
      <PageHeader title="Kontrol anti-fraud per alur" />
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Penanda pola yang lazim dipakai untuk kecurangan: diskon besar, jual rugi, retur besar, selisih kas berulang, kas keluar dipecah di bawah batas persetujuan, rekening karyawan ganda, dan lainnya. Ini bukan bukti kesalahan — telusuri dokumennya." />
      {!isLoading && !groups.length && <Card><Empty image={<SafetyCertificateOutlined style={{ fontSize: 40, color: '#16a34a' }} />} description="Tidak ada pola yang mencurigakan dalam 60 hari terakhir." /></Card>}
      <Space direction="vertical" style={{ width: '100%' }}>
        {groups.map((g) => (
          <Card key={g.k} size="small" title={FLOW[g.k]} loading={isLoading}>
            <Space direction="vertical" style={{ width: '100%' }}>
              {g.items.map((f) => (
                <div key={f.key}>
                  <Tag color={COLOR[f.level]}>{LABEL[f.level]}</Tag> <strong>{f.title}</strong>
                  <div style={{ color: '#475569' }}>{f.detail}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>{f.refs.slice(0, 8).join(' · ')}{f.refs.length > 8 ? ` · dan ${f.refs.length - 8} lainnya` : ''}</Typography.Text>
                </div>
              ))}
            </Space>
          </Card>
        ))}
      </Space>
    </>
  );
}
