import { useQuery } from '@tanstack/react-query';
import { Card, Collapse, Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { get } from '@/api/client';

interface Focus {
  focus: { title: string; points: string[] };
  checks: { key: string; status: 'PERLU' | 'INFO' | 'OK'; title: string; detail: string; link?: string }[];
  disclaimer: string;
}
const COLOR = { PERLU: 'orange', INFO: 'blue', OK: 'green' } as const;
const TEXT = { PERLU: 'Perlu dilengkapi', INFO: 'Catatan', OK: 'Sudah baik' } as const;

/** Fokus pajak sesuai jenis usaha dan daftar periksa kelengkapan data pajaknya */
export default function TaxFocusCard() {
  const { data } = useQuery({ queryKey: ['tax-focus'], queryFn: () => get<Focus>('/tax/focus') });
  if (!data) return null;
  const needs = data.checks.filter((c) => c.status === 'PERLU').length;
  return (
    <Card size="small" style={{ marginBottom: 16 }}>
      <Collapse ghost defaultActiveKey={needs ? ['f'] : []} items={[{
        key: 'f',
        label: <Space wrap><strong>Fokus pajak: {data.focus.title}</strong>{needs > 0 ? <Tag color="orange">{needs} perlu dilengkapi</Tag> : <Tag color="green">Data pajak lengkap</Tag>}</Space>,
        children: (
          <>
            <ul style={{ marginTop: 0, paddingLeft: 18 }}>{data.focus.points.map((p) => <li key={p}>{p}</li>)}</ul>
            <Space direction="vertical" style={{ width: '100%' }}>
              {data.checks.map((c) => (
                <div key={c.key}>
                  <Tag color={COLOR[c.status]}>{TEXT[c.status]}</Tag> <strong>{c.title}</strong>
                  <div style={{ color: '#475569' }}>{c.detail} {c.link && <Link to={c.link}>Buka</Link>}</div>
                </div>
              ))}
            </Space>
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, fontSize: 12 }}>{data.disclaimer}</Typography.Paragraph>
          </>
        ),
      }]} />
    </Card>
  );
}
