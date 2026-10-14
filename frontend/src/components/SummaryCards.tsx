import { Card, Col, Row, Typography } from 'antd';
import type { ReactNode } from 'react';

export type SummaryTone = 'neutral' | 'good' | 'bad' | 'warn';

const TONES: Record<SummaryTone, { bg?: string; border?: string; color?: string }> = {
  neutral: {},
  good: { bg: '#F1FAF6', border: '#CBEBDD', color: '#0E7A5C' },
  bad: { bg: '#FEF3F2', border: '#FAD4D0', color: '#B42318' },
  warn: { bg: '#FFF8E8', border: '#F5E3B3', color: '#8A6A1F' },
};

export interface SummaryItem {
  label: string;
  value: ReactNode;
  tone?: SummaryTone;
  /** Keterangan kecil di bawah angka */
  hint?: ReactNode;
  onClick?: () => void;
  active?: boolean;
}

/** Kotak ringkasan di atas daftar: angka penting terbaca sekilas (konsisten di semua halaman daftar) */
export default function SummaryCards({ items }: { items: SummaryItem[] }) {
  const span = items.length >= 4 ? 6 : items.length === 3 ? 8 : 12;
  return (
    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
      {items.map((it) => {
        const t = TONES[it.tone ?? 'neutral'];
        return (
          <Col xs={24} sm={span === 6 ? 12 : span} lg={span} key={it.label}>
            <Card
              size="small"
              hoverable={!!it.onClick}
              onClick={it.onClick}
              style={{ background: t.bg, borderColor: it.active ? '#1C3160' : t.border, height: '100%' }}
            >
              <Typography.Text type="secondary">{it.label}</Typography.Text>
              <div style={{ fontSize: 22, fontWeight: 600, color: t.color, lineHeight: 1.35 }}>{it.value}</div>
              {it.hint && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{it.hint}</Typography.Text>}
            </Card>
          </Col>
        );
      })}
    </Row>
  );
}
