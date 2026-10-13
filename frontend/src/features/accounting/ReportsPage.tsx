import { REPORTING_FRAMEWORK_LABELS, type ReportingFramework, type StatementKind, statementTitle } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Checkbox, Input, Radio, Select, Space, Tabs, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { get, qs } from '@/api/client';
import type {
  CashFlowStatement,
  EquityStatement,
  FinancialAppendix,
  FinancialNotes,
  FinancialPosition,
  IncomeStatement,
} from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { useBranches } from '@/api/queries';
import { BranchBalanceTab, BranchReportTab } from './BranchesPage';
import ExportButtons from '@/components/ExportButtons';
import QueryState from '@/components/QueryState';
import PageHeader from '@/layout/PageHeader';
import type { SheetSpec } from '@/lib/export';
import { appendixSheet, cashFlowSheet, equitySheet, incomeSheet, notesSheet, positionSheet } from '@/lib/xlsx/reports';
import AppendixView from './statements/AppendixView';
import NotesView from './statements/NotesView';
import { CashFlowView, EquityView, IncomeView, PositionView } from './statements/views';
import { longDate } from './statements/format';

const TABS = {
  position: 'Laporan Posisi Keuangan',
  income: 'Laporan Laba Rugi',
  equity: 'Laporan Perubahan Ekuitas',
  cashflow: 'Laporan Arus Kas',
  notes: 'Catatan atas Laporan Keuangan',
  appendix: 'Lampiran Laporan Keuangan',
  branches: 'Perbandingan Cabang',
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
  appendix: 'Lampiran',
  branches: 'Perbandingan cabang',
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
  const [showOptional, setShowOptional] = useState(false);
  const branchList = useBranches();
  const branchOpts = (branchList.data?.branches ?? []).filter((b) => b.isActive);
  const [branch, setBranch] = useState<string>();
  const branchSel = branchOpts.length ? branch : undefined;
  const branchName = branchSel === 'NONE' ? 'Pusat / tanpa cabang' : branchOpts.find((b) => b.id === branchSel)?.name;
  const range = { from, to };
  const fy = Number(to.slice(0, 4));

  const fw = useQuery({ queryKey: ['framework'], queryFn: () => get<{ framework: ReportingFramework }>('/accounting/statements/framework') });
  const framework = fw.data?.framework ?? 'SAK_EP';
  const KIND: Partial<Record<TabKey, StatementKind>> = { position: 'position', income: 'income', equity: 'equity', cashflow: 'cashflow', notes: 'notes' };
  const tabTitle = (k: TabKey) => (KIND[k] ? statementTitle(KIND[k]!, framework) : TABS[k]);
  const on = (k: TabKey) => tab === k;
  const position = useQuery({
    queryKey: ['statements', 'position', to, branchSel],
    queryFn: () => get<FinancialPosition>(`/accounting/statements/financial-position${qs({ asOf: to, branchId: branchSel })}`),
    enabled: on('position'),
  });
  const income = useQuery({
    queryKey: ['statements', 'income', from, to, framework, branchSel],
    queryFn: () => get<IncomeStatement>(`/accounting/statements/income${qs({ ...range, framework, branchId: branchSel })}`),
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
  const appendix = useQuery({
    queryKey: ['appendix', fy],
    queryFn: () => get<FinancialAppendix>(`/accounting/appendix/${fy}`),
    enabled: on('appendix'),
  });
  const refs = notes.data?.refs ?? {};

  const moved = MOVED[params.get('tab') ?? ''];
  const pointInTime = tab === 'position';
  /** CALK dan Lampiran disusun per tahun buku, bukan per rentang tanggal */
  const yearly = tab === 'notes' || tab === 'appendix';
  const period = pointInTime ? `Per ${longDate(to)}` : `Periode ${longDate(from)} s/d ${longDate(to)}`;
  const sheets = (): SheetSpec[] | null => {
    const meta = { company: me?.tenantName, framework, refs, detail, signer: notes.data?.company };
    if (tab === 'position' && position.data) return positionSheet(position.data, meta);
    if (tab === 'income' && income.data) return incomeSheet(income.data, meta);
    if (tab === 'equity' && equity.data) return equitySheet(equity.data, meta);
    if (tab === 'cashflow' && cashflow.data) return cashFlowSheet(cashflow.data, meta);
    if (tab === 'notes' && notes.data) return notesSheet(notes.data, me?.tenantName);
    if (tab === 'appendix' && appendix.data) return appendixSheet(appendix.data, me?.tenantName);
    return null;
  };

  const showsCompare = ['position', 'income', 'equity', 'cashflow'].includes(tab);
  const showsDetail = ['position', 'income'].includes(tab);
  const emkmOptional = framework === 'SAK_EMKM' && ['equity', 'cashflow'].includes(tab);
  // SAK EMKM hanya mewajibkan Posisi Keuangan, Laba Rugi, dan CALK → dua laporan lain opsional (tersembunyi bawaan).
  // Tab yang sedang dibuka lewat tautan tetap tampil agar tidak "hilang" dari pengguna.
  const hideOptional = framework === 'SAK_EMKM' && !showOptional && !['equity', 'cashflow'].includes(tab);

  if (moved) return <Navigate to={moved} replace />;
  return (
    <>
      <PageHeader
        title="Laporan Keuangan"
        extra={
          <Space wrap className="no-print">
            <Tag color="blue" style={{ cursor: 'pointer' }} onClick={() => navigate('/settings/company?tab=kebijakan')}>
              {REPORTING_FRAMEWORK_LABELS[framework]}
            </Tag>
            {!!branchOpts.length && ['position', 'income'].includes(tab) && (
              <Select
                allowClear
                placeholder="Semua cabang (gabungan)"
                style={{ width: 220 }}
                value={branchSel}
                onChange={setBranch}
                options={[...branchOpts.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` })), { value: 'NONE', label: 'Pusat / tanpa cabang' }]}
              />
            )}
            {!pointInTime && !yearly && tab !== 'branches' && (
              <>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                <span>s/d</span>
              </>
            )}
            {yearly ? (
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
            <ExportButtons filename={`${SHORT[tab].toLowerCase().replace(/ /g, '-')}-${to}`} title={`${tabTitle(tab)} ${period}`} sheets={sheets} />
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
              Rincian per akun (klik akun untuk membuka buku besar dan dokumen asalnya)
            </Checkbox>
          )}
          {framework === 'SAK_EMKM' && (
            <Checkbox checked={showOptional || emkmOptional} disabled={emkmOptional} onChange={(e) => setShowOptional(e.target.checked)}>
              Tampilkan laporan opsional (Perubahan Ekuitas, Arus Kas)
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
          <Typography.Text strong>{tabTitle(tab)}{branchName && ['position', 'income'].includes(tab) ? ` — ${branchName}` : ''}</Typography.Text>
          <br />
          <Typography.Text type="secondary">{period} · dalam Rupiah</Typography.Text>
        </div>
        <Tabs
          className="statement-tabs"
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: 'position', label: SHORT.position, children: <QueryState q={position}>{(d) => <PositionView d={d} refs={refs} compare={compare} detail={detail} signer={notes.data?.company} />}</QueryState> },
            { key: 'income', label: SHORT.income, children: <QueryState q={income}>{(d) => <IncomeView d={d} refs={refs} compare={compare} detail={detail} signer={notes.data?.company} />}</QueryState> },
            { key: 'equity', label: SHORT.equity, children: branchSel ? <Alert type="info" showIcon message="Laporan Perubahan Ekuitas hanya untuk gabungan semua cabang. Kosongkan pilihan cabang." /> : <QueryState q={equity}>{(d) => <EquityView d={d} compare={compare} />}</QueryState> },
            { key: 'cashflow', label: SHORT.cashflow, children: branchSel ? <Alert type="info" showIcon message="Laporan Arus Kas hanya untuk gabungan semua cabang. Kosongkan pilihan cabang." /> : <QueryState q={cashflow}>{(d) => <CashFlowView d={d} compare={compare} />}</QueryState> },
            { key: 'notes', label: SHORT.notes, children: <QueryState q={notes}>{(d) => <NotesView d={d} />}</QueryState> },
            { key: 'appendix', label: SHORT.appendix, children: <QueryState q={appendix}>{(d) => <AppendixView d={d} />}</QueryState> },
            ...(branchOpts.length
              ? [
                  {
                    key: 'branches',
                    label: SHORT.branches,
                    children: (
                      <Tabs
                        size="small"
                        items={[
                          { key: 'pl', label: 'Laba rugi per cabang', children: <BranchReportTab /> },
                          { key: 'bs', label: 'Neraca per cabang', children: <BranchBalanceTab /> },
                        ]}
                      />
                    ),
                  },
                ]
              : []),
          ].filter((i) => !(hideOptional && (i.key === 'equity' || i.key === 'cashflow')))}
        />
      </Card>
    </>
  );
}
