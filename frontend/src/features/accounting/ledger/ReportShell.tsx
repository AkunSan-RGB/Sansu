import { Card, Input, Space, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useAuth } from '@/auth/AuthContext';
import ExportButtons from '@/components/ExportButtons';
import PageHeader from '@/layout/PageHeader';
import type { SheetSpec } from '@/lib/export';
import { longDate } from '../statements/format';

/** Kerangka halaman laporan pembukuan (neraca saldo, neraca lajur, rekap PPN): periode, Excel, cetak */
export default function ReportShell({
  title,
  from,
  to,
  onFrom,
  onTo,
  sheets,
  controls,
  children,
}: {
  title: string;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  sheets: () => SheetSpec[] | null;
  controls?: ReactNode;
  children: ReactNode;
}) {
  const { me } = useAuth();
  const period = `Periode ${longDate(from)} s/d ${longDate(to)}`;
  return (
    <>
      <PageHeader
        title={title}
        extra={
          <Space wrap className="no-print">
            <Input type="date" value={from} onChange={(e) => e.target.value && onFrom(e.target.value)} />
            <span>s/d</span>
            <Input type="date" value={to} onChange={(e) => e.target.value && onTo(e.target.value)} />
            <ExportButtons filename={`${title.toLowerCase().replace(/ /g, '-')}-${from}-${to}`} title={`${title} ${period}`} sheets={sheets} />
          </Space>
        }
      />
      <Card className="print-area">
        {controls && (
          <Space wrap className="no-print" style={{ marginBottom: 8 }}>
            {controls}
          </Space>
        )}
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {me?.tenantName}
          </Typography.Title>
          <Typography.Text strong>{title}</Typography.Text>
          <br />
          <Typography.Text type="secondary">{period} · dalam Rupiah</Typography.Text>
        </div>
        {children}
      </Card>
    </>
  );
}

