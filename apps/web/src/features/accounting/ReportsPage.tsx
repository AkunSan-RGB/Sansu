import { REPORTING_FRAMEWORK_LABELS } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Checkbox, Input, Radio, Select, Space, Tabs, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { get, qs } from '@/api/client';
import type {
  CashFlowStatement,
  EquityStatement,
  FinancialNotes,
  FinancialPosition,
  IncomeStatement,
} from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import ExportButtons from '@/components/ExportButtons';
import QueryState from '@/components/QueryState';
import PageHeader from '@/layout/PageHeader';
import type { SheetSpec } from '@/lib/export';
import { cashFlowSheet, equitySheet, incomeSheet, notesSheet, positionSheet } from '@/lib/xlsx/reports';
import NotesView from './statements/NotesView';
import { CashFlowView, EquityView, IncomeView, PositionView } from './statements/views';
import { longDate } from './statements/format';

const TABS = {
  position: 'Laporan Posisi Keuangan',
  income: 'Laporan Laba Rugi',
  equity: 'Laporan Perubahan Ekuitas',
  cashflow: 'Laporan Arus Kas',
  notes: 'Catatan atas Laporan Keuangan',
} as const;
/** Laporan pembukuan yang kini punya halaman sendiri (tautan lama tetap berfungsi) */
const MOVED: Record<string, string> = { tb: '/trial-balance', worksheet: '/worksheet', vat: '/vat' };
type TabKey = keyof typeof TABS;
const SHORT: Record<TabKey, string> = {
  position: 'Posisi Keuangan',
  income: 'Laba Rugi',
  equity: 'Perubahan Ekuitas',
  cashflow: 'Arus Kas',
  notes: 'CALK',
};

export default function ReportsPage() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TabKey) in TABS ? (params.get('tab') as TabKey) : 'position';
  const setTab = (t: string) => setParams({ tab: t }, { replace: true });
  const [from, setFrom] = useState(dayjs().startOf('year').format('YYYY-MM-DD'));
  const [to, setTo] = useState(dayjs().format('YYYY-MM-DD'));
  const [compare, setCompare] = useState(true);
  const [detail, setDetail] = useState(false);
  const [method, setMethod] = useState<'indirect' | 'direct'>('indirect');
  const range = { from, to };
  const fy = Number(to.slice(0, 4));

  const fw = useQuery({ queryKey: ['framework'], queryFn: () => get<{ framework: 'SAK_EP' | 'SAK_EMKM' }>('/accounting/statements/framework') });
  const framework = fw.data?.framework ?? 'SAK_EP';
  const on = (k: TabKey) => tab === k;
  const position = useQuery({
    queryKey: ['statements', 'position', to],
    queryFn: () => get<FinancialPosition>(`/accounting/statements/financial-position${qs({ asOf: to })}`),
    enabled: on('position'),
  });
  const income = useQuery({
    queryKey: ['statements', 'income', from, to, framework],
    queryFn: () => get<IncomeStatement>(`/accounting/statements/income${qs({ ...range, framework })}`),
    enabled: on('income') && !fw.isPending,
  });
  const equity = useQuery({
    queryKey: ['statements', 'equity', from, to],
    queryFn: () => get<EquityStatement>(`/accounting/statements/equity${qs(range)}`),
    enabled: on('equity'),
  });
  const cashflow = useQuery({
    queryKey: ['statements', 'cashflow', from, to, method],
    queryFn: () => get<CashFlowStatement>(`/accounting/statements/cash-flow${qs({ ...range, method })}`),
    enabled: on('cashflow'),
  });
  const notes = useQuery({
    queryKey: ['notes', fy],
    queryFn: () => get<FinancialNotes>(`/accounting/notes/${fy}`),
    enabled: ['position', 'income', 'notes'].includes(tab),
  });
  const refs = notes.data?.refs ?? {};

  const moved = MOVED[params.get('tab') ?? ''];
  const pointInTime = tab === 'position';
  const period = pointInTime ? `Per ${longDate(to)}` : `Periode ${longDate(from)} s/d ${longDate(to)}`;
  const sheets = (): SheetSpec[] | null => {
    const meta = { company: me?.tenantName, framework, refs, detail };
    if (tab === 'position' && position.data) return positionSheet(position.data, meta);
    if (tab === 'income' && income.data) return incomeSheet(income.data, meta);
    if (tab === 'equity' && equity.data) return equitySheet(equity.data, meta);
    if (tab === 'cashflow' && cashflow.data) return cashFlowSheet(cashflow.data, meta);
    if (tab === 'notes' && notes.data) return notesSheet(notes.data, me?.tenantName);
    return null;
  };

  const showsCompare = ['position', 'income', 'equity', 'cashflow'].includes(tab);
  const showsDetail = ['position', 'income'].includes(tab);
  const emkmOptional = framework === 'SAK_EMKM' && ['equity', 'cashflow'].includes(tab);

  if (moved) return <Navigate to={moved} replace />;
  return (
    <>
      <PageHeader
        title="Laporan Keuangan"
        extra={
          <Space wrap className="no-print">
            <Tag color="blue" style={{ cursor: 'pointer' }} onClick={() => navigate('/settings/company')}>
              {REPORTING_FRAMEWORK_LABELS[framework]}
            </Tag>
            {!pointInTime && tab !== 'notes' && (
              <>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                <span>s/d</span>
              </>
            )}
            {tab === 'notes' ? (
              <Select
                style={{ width: 150 }}
                value={fy}
                prefix="Tahun"
                onChange={(y: number) => {
                  setFrom(`${y}-01-01`);
                  setTo(y === dayjs().year() ? dayjs().format('YYYY-MM-DD') : `${y}-12-31`);
                }}
                options={Array.from({ length: 8 }, (_, i) => dayjs().year() - i).map((y) => ({ value: y, label: String(y) }))}
              />
            ) : (
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            )}
            <ExportButtons filename={`${SHORT[tab].toLowerCase().replace(/ /g, '-')}-${to}`} title={`${TABS[tab]} ${period}`} sheets={sheets} />
          </Space>
        }
      />
      <Card className="print-area">
        <Space wrap className="no-print" style={{ marginBottom: 8 }}>
          {showsCompare && (
            <Checkbox checked={compare} onChange={(e) => setCompare(e.target.checked)}>
              Tampilkan pembanding
            </Checkbox>
          )}
          {showsDetail && (
            <Checkbox checked={detail} onChange={(e) => setDetail(e.target.checked)}>
              Rincian per akun
            </Checkbox>
          )}
          {tab === 'cashflow' && (
            <Radio.Group size="small" value={method} onChange={(e) => setMethod(e.target.value)} optionType="button">
              <Radio value="indirect">Metode tidak langsung</Radio>
              <Radio value="direct">Metode langsung</Radio>
            </Radio.Group>
          )}
        </Space>
        {emkmOptional && (
          <Alert
            className="no-print"
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="SAK EMKM hanya mewajibkan Laporan Posisi Keuangan, Laba Rugi, dan CALK. Laporan ini tetap tersedia sebagai informasi tambahan."
          />
        )}
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {me?.tenantName}
          </Typography.Title>
          <Typography.Text strong>{TABS[tab]}</Typography.Text>
          <br />
          <Typography.Text type="secondary">{period} · dalam Rupiah</Typography.Text>
        </div>
        <Tabs
          className="statement-tabs"
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: 'position', label: SHORT.position, children: <QueryState q={position}>{(d) => <PositionView d={d} refs={refs} compare={compare} detail={detail} />}</QueryState> },
            { key: 'income', label: SHORT.income, children: <QueryState q={income}>{(d) => <IncomeView d={d} refs={refs} compare={compare} detail={detail} />}</QueryState> },
            { key: 'equity', label: SHORT.equity, children: <QueryState q={equity}>{(d) => <EquityView d={d} compare={compare} />}</QueryState> },
            { key: 'cashflow', label: SHORT.cashflow, children: <QueryState q={cashflow}>{(d) => <CashFlowView d={d} compare={compare} />}</QueryState> },
            { key: 'notes', label: SHORT.notes, children: <QueryState q={notes}>{(d) => <NotesView d={d} />}</QueryState> },
          ]}
        />
      </Card>
    </>
  );
}
