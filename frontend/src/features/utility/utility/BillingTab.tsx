import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Col, DatePicker, Popconfirm, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import { fmtMoney } from '@/lib/format';

interface Preview {
  period: string;
  ready: { connectionId: string; number: string; customerName: string; tariffName: string; usage: number | null; unit: string; subtotal: number; lateFee: number; lateFeeOf: string[] }[];
  held: { connectionId: string; number: string; customerName: string; reason: string }[];
  totals: { count: number; subtotal: number; lateFee: number };
}

interface RunResult { period: string; billedCount: number; billedTotal: number; billed: { number: string; invoice: string; total: number }[]; failed: { number: string; reason: string }[]; held: { number: string; reason: string }[] }

// ---------- Tagihan bulanan ----------
export function BillingTab() {
  const can = useCan();
  const [period, setPeriod] = useState(dayjs().subtract(1, 'month').format('YYYY-MM'));
  const preview = useQuery({ queryKey: ['utility', 'preview', period], queryFn: () => get<Preview>(`/utility/billing/preview?period=${period}`) });
  const [result, setResult] = useState<RunResult | null>(null);
  const run = useAction(() => post<RunResult>('/utility/billing/run', { period }), { success: 'Penagihan selesai', invalidate: ['utility', 'invoices'], onSuccess: (r) => setResult(r as RunResult) });
  const p = preview.data;
  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <span>Periode</span>
        <DatePicker picker="month" allowClear={false} value={dayjs(period + '-01')} onChange={(d) => { if (d) { setPeriod(d.format('YYYY-MM')); setResult(null); } }} disabledDate={(d) => d.isAfter(dayjs(), 'month')} />
        {can('POST', '/utility/billing/run') && (
          <Popconfirm title={`Terbitkan ${p?.totals.count ?? 0} tagihan periode ${period}?`} description="Faktur dibuat otomatis dan tidak bisa diterbitkan dua kali untuk periode yang sama." onConfirm={() => run.mutate(undefined)} disabled={!p?.totals.count}>
            <Button type="primary" disabled={!p?.totals.count} loading={run.isPending}>Terbitkan tagihan</Button>
          </Popconfirm>
        )}
      </Space>
      {result && (
        <Alert style={{ marginBottom: 12 }} type={result.failed.length ? 'warning' : 'success'} showIcon message={`${result.billedCount} tagihan diterbitkan, total ${fmtMoney(result.billedTotal)}`}
          description={result.failed.length ? <div>Gagal: {result.failed.map((f) => `${f.number} (${f.reason})`).join('; ')}</div> : undefined} />
      )}
      {p && (
        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col xs={8}><Statistic title="Akan ditagih" value={p.totals.count} /></Col>
          <Col xs={8}><Statistic title="Nilai tagihan" value={fmtMoney(p.totals.subtotal)} /></Col>
          <Col xs={8}><Statistic title="Denda ikut ditagih" value={fmtMoney(p.totals.lateFee)} /></Col>
        </Row>
      )}
      <ResponsiveTable<Preview['ready'][number]> rowKey="connectionId" size="small" loading={preview.isLoading} dataSource={p?.ready} pagination={{ pageSize: 15 }} scroll={{ x: 800 }} locale={{ emptyText: 'Tidak ada yang siap ditagih untuk periode ini' }}
        columns={[
          { title: 'Sambungan', render: (_: unknown, r) => `${r.number} · ${r.customerName}` },
          { title: 'Tarif', dataIndex: 'tariffName' },
          { title: 'Pemakaian', render: (_: unknown, r) => (r.usage == null ? 'tarif tetap' : `${r.usage} ${r.unit}`) },
          { title: 'Tagihan', align: 'right' as const, dataIndex: 'subtotal', render: (v: number) => fmtMoney(v) },
          { title: 'Denda', align: 'right' as const, render: (_: unknown, r) => (r.lateFee ? <span>{fmtMoney(r.lateFee)} <Tag color="orange">{r.lateFeeOf.join(', ')}</Tag></span> : '-') },
        ]}
      />
      {!!p?.held.length && (
        <>
          <Typography.Title level={5} style={{ marginTop: 20 }}>Tertahan ({p.held.length})</Typography.Title>
          <Table size="small" rowKey="connectionId" pagination={{ pageSize: 10 }} dataSource={p.held}
            columns={[{ title: 'Sambungan', render: (_: unknown, r: Preview['held'][number]) => `${r.number} · ${r.customerName}` }, { title: 'Alasan', dataIndex: 'reason' }]} />
        </>
      )}
    </>
  );
}
