import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Empty, Input, Row, Space, Statistic, Table, Tabs, Typography } from 'antd';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { get } from '@/api/client';
import ExportButtons from '@/components/ExportButtons';
import QueryState from '@/components/QueryState';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, fmtQty } from '@/lib/format';
import type { SheetSpec } from '@/lib/export';
import { SheetBuilder, d as toDate, n as toNum, type Fmt } from '@/lib/xlsx/book';

type ColType = 'text' | 'money' | 'qty' | 'int' | 'date' | 'pct' | 'hours';
interface Col { key: string; label: string; type?: ColType }
interface Section { key: string; title: string; note?: string; columns: Col[]; rows: Record<string, unknown>[]; empty?: string }
interface Kpi { label: string; value: string | number; type?: ColType; tone?: 'warn' | 'ok' }
interface Report { dept: string; title: string; description: string; period: { from: string; to: string }; kpis: Kpi[]; sections: Section[] }

/** Bagian yang punya laporan kerja, beserta bidang Laporan pendukung (pencocokan buku besar) yang terkait */
export const DEPT_REPORTS: Record<string, { title: string; support?: string }> = {
  sales: { title: 'Laporan penjualan', support: 'sales' },
  purchases: { title: 'Laporan pembelian', support: 'purchases' },
  inventory: { title: 'Laporan persediaan', support: 'inventory' },
  cash: { title: 'Laporan kas & bank', support: 'cash' },
  pos: { title: 'Laporan kasir', support: 'pos' },
  fnb: { title: 'Laporan F&B', support: 'fnb' },
  fmcg: { title: 'Laporan FMCG', support: 'fmcg' },
  mfg: { title: 'Laporan produksi', support: 'mfg' },
  jasa: { title: 'Laporan jasa & proyek', support: 'jasa' },
  utility: { title: 'Laporan utilitas', support: 'utility' },
  hr: { title: 'Laporan SDM' },
};

const fmtValue = (v: unknown, type: ColType | undefined): string => {
  if (v == null || v === '') return '-';
  switch (type) {
    case 'money': return fmtMoney(v as string | number);
    case 'qty': return fmtQty(v as string | number);
    case 'int': return Number(v).toLocaleString('id-ID');
    case 'date': return String(v).length > 10 ? dayjs(String(v)).format('D MMM YYYY HH:mm') : fmtDate(String(v));
    case 'pct': return `${Number(v).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
    case 'hours': return `${Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 })} jam`;
    default: return String(v);
  }
};
const FMT: Record<ColType, Fmt> = { text: 'text', money: 'money', qty: 'dec', int: 'int', date: 'date', pct: 'dec', hours: 'dec' };

/** Satu lembar Excel per bagian laporan */
function toSheets(r: Report, company?: string): SheetSpec[] {
  return r.sections.map((s) => {
    const b = new SheetBuilder(s.title, { company, title: `${r.title} — ${s.title}`, subtitle: [`Periode ${fmtDate(r.period.from)} s/d ${fmtDate(r.period.to)}`, s.note], columns: s.columns.map((c) => ({ key: c.key, header: c.label, fmt: FMT[c.type ?? 'text'] })), filter: true });
    for (const row of s.rows) b.row(s.columns.map((c) => (c.type === 'date' ? toDate(String(row[c.key] ?? '').slice(0, 10)) : c.type && c.type !== 'text' ? toNum(row[c.key] as string | number | null) : (row[c.key] as string | null | undefined))));
    return b.spec;
  });
}

function SectionTable({ s }: { s: Section }) {
  const columns: ColumnsType<Record<string, unknown>> = s.columns.map((c) => ({
    title: c.label,
    dataIndex: c.key,
    align: c.type && c.type !== 'text' && c.type !== 'date' ? 'right' : 'left',
    render: (v: unknown) => fmtValue(v, c.type),
  }));
  return (
    <>
      {s.note && <Typography.Paragraph type="secondary" style={{ textAlign: 'justify' }}>{s.note}</Typography.Paragraph>}
      <Table size="small" rowKey={(_, i) => String(i)} columns={columns} dataSource={s.rows} pagination={s.rows.length > 20 ? { pageSize: 20, showSizeChanger: false } : false} scroll={{ x: 'max-content' }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={s.empty ?? 'Tidak ada data pada rentang ini'} /> }} />
    </>
  );
}

/**
 * Laporan kerja satu bagian (penjualan, pembelian, persediaan, kas, kasir, F&B, FMCG, produksi, jasa, utilitas, SDM): ringkasan angka
 * di atas, lalu tab rincian. Ini laporan untuk mengelola bagian itu; pencocokan dengan buku besar ada di Akuntansi › Laporan pendukung.
 */
export default function DeptReportPage() {
  const { dept = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const meta = DEPT_REPORTS[dept];
  const [from, setFrom] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [to, setTo] = useState(dayjs().format('YYYY-MM-DD'));
  const q = useQuery({ queryKey: ['dept-report', dept, from, to], queryFn: () => get<Report>(`/dept-reports/${dept}?from=${from}&to=${to}`), enabled: !!meta && !!from && !!to && from <= to });
  const sheets = useMemo(() => (q.data ? toSheets(q.data) : []), [q.data]);
  if (!meta) return <Navigate to="/dashboard" replace />;
  const now = dayjs();
  const last = now.subtract(1, 'month');
  const preset = (label: string, f: string, t: string) => (
    <Button size="small" key={label} type={from === f && to === t ? 'primary' : 'default'} onClick={() => { setFrom(f); setTo(t); }}>{label}</Button>
  );
  return (
    <>
      <PageHeader
        title={meta.title}
        subtitle={q.data?.description}
        extra={
          <Space wrap className="no-print">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span>s/d</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <ExportButtons filename={`${dept}-${to}`} title={`${meta.title} ${fmtDate(from)} s/d ${fmtDate(to)}`} sheets={() => (sheets.length ? sheets : null)} />
          </Space>
        }
      />
      <Space wrap size={[8, 8]} className="no-print" style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">Periode:</Typography.Text>
        {preset('Bulan ini', now.startOf('month').format('YYYY-MM-DD'), now.format('YYYY-MM-DD'))}
        {preset('Bulan lalu', last.startOf('month').format('YYYY-MM-DD'), last.endOf('month').format('YYYY-MM-DD'))}
        {preset('Tahun ini', now.startOf('year').format('YYYY-MM-DD'), now.format('YYYY-MM-DD'))}
      </Space>
      {from > to && <Alert type="warning" showIcon message="Tanggal awal tidak boleh setelah tanggal akhir" style={{ marginBottom: 12 }} />}
      <QueryState q={q}>
        {(r) => (
          <div className="print-area">
            <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
              {r.kpis.map((k) => (
                <Col key={k.label} xs={12} md={8} xl={6}>
                  <Card size="small">
                    <Statistic title={k.label} value={fmtValue(k.value, k.type)} valueStyle={{ fontSize: 20, color: k.tone === 'warn' ? '#cf1322' : undefined }} />
                  </Card>
                </Col>
              ))}
            </Row>
            <Card>
              <Tabs
                className="no-print"
                activeKey={r.sections.some((s) => s.key === params.get('tab')) ? params.get('tab')! : r.sections[0]?.key}
                onChange={(k) => setParams({ tab: k }, { replace: true })}
                items={r.sections.map((s) => ({ key: s.key, label: s.title, children: <SectionTable s={s} /> }))}
              />
            </Card>
            {meta.support && (
              <Typography.Paragraph type="secondary" className="no-print" style={{ marginTop: 12 }}>
                Mencocokkan angka bagian ini dengan buku besar? Lihat <Link to={`/support-reports?kind=${meta.support}`}>Akuntansi › Laporan pendukung</Link>.
              </Typography.Paragraph>
            )}
          </div>
        )}
      </QueryState>
    </>
  );
}
