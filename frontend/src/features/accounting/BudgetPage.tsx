/** Anggaran vs realisasi: laporan selisih per akun + penyusunan, persetujuan, dan isi otomatis dari realisasi */
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { get, post, put } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney, rupiahInput } from '@/lib/format';

type Status = 'OK' | 'WARN' | 'OVER' | 'UNBUDGETED' | 'SHORT';
interface ReportRow {
  accountId: string;
  code: string;
  name: string;
  type: 'REVENUE' | 'EXPENSE';
  budgetMonth: string;
  actualMonth: string;
  budgetYtd: string;
  actualYtd: string;
  budgetYear: string;
  variance: string;
  variancePct: string | null;
  forecastYear: string;
  status: Status;
}
interface Report {
  year: number;
  month: number;
  budget: { status: 'DRAFT' | 'APPROVED'; name: string; tolerancePct: number } | null;
  rows: ReportRow[];
  totals: Record<'revenue' | 'expense' | 'profit', { budgetYtd: string; actualYtd: string; budgetYear: string }>;
}
interface Grid {
  budget: { status: 'DRAFT' | 'APPROVED'; tolerancePct: number } | null;
  accounts: { id: string; code: string; name: string; type: 'REVENUE' | 'EXPENSE' }[];
  rows: { accountId: string; months: string[] }[];
}

const STATUS: Record<Status, { color: string; text: string }> = {
  OK: { color: 'green', text: 'Sesuai' },
  WARN: { color: 'gold', text: 'Hampir habis' },
  OVER: { color: 'red', text: 'Melebihi' },
  UNBUDGETED: { color: 'volcano', text: 'Tanpa anggaran' },
  SHORT: { color: 'orange', text: 'Di bawah target' },
};
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function ReportTab({ year }: { year: number }) {
  const [month, setMonth] = useState<number>();
  const q = useQuery({ queryKey: ['budget', 'report', year, month], queryFn: () => get<Report>(`/budgets/${year}/report${month ? `?month=${month}` : ''}`) });
  const r = q.data;
  const col = (key: 'revenue' | 'expense' | 'profit', title: string) => (
    <Col xs={24} md={8}>
      <Card size="small" loading={q.isLoading}>
        <Statistic title={`${title} (s.d. ${MONTH_NAMES[(r?.month ?? 1) - 1]})`} value={Number(r?.totals[key].actualYtd ?? 0)} formatter={(v) => fmtMoney(Number(v))} />
        <Typography.Text type="secondary">Anggaran {fmtMoney(r?.totals[key].budgetYtd ?? 0)}</Typography.Text>
      </Card>
    </Col>
  );
  return (
    <>
      {!r?.budget && !q.isLoading && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`Anggaran ${year} belum dibuat. Susun di tab "Susun anggaran" atau isi otomatis dari realisasi tahun lalu.`} />}
      {r?.budget?.status === 'DRAFT' && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Anggaran masih draf (belum disetujui). Peringatan otomatis berjalan setelah disetujui." />}
      <Space style={{ marginBottom: 12 }}>
        <span>Sampai bulan</span>
        <Select value={month ?? r?.month} onChange={setMonth} options={MONTH_NAMES.map((n, i) => ({ value: i + 1, label: n }))} style={{ width: 100 }} />
      </Space>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {col('revenue', 'Pendapatan')}
        {col('expense', 'Beban')}
        {col('profit', 'Laba')}
      </Row>
      <Table
        size="small"
        rowKey="accountId"
        loading={q.isLoading}
        dataSource={r?.rows}
        pagination={false}
        scroll={{ x: 1000 }}
        columns={[
          { title: 'Akun', render: (_, a: ReportRow) => `${a.code} ${a.name}` },
          { title: `Anggaran ${r ? MONTH_NAMES[r.month - 1] : ''}`, dataIndex: 'budgetMonth', align: 'right', render: fmtMoney },
          { title: `Realisasi ${r ? MONTH_NAMES[r.month - 1] : ''}`, dataIndex: 'actualMonth', align: 'right', render: fmtMoney },
          { title: 'Anggaran s.d. bulan ini', dataIndex: 'budgetYtd', align: 'right', render: fmtMoney },
          { title: 'Realisasi s.d. bulan ini', dataIndex: 'actualYtd', align: 'right', render: fmtMoney },
          {
            title: 'Selisih',
            dataIndex: 'variance',
            align: 'right',
            render: (v: string, a: ReportRow) => (
              <Typography.Text type={Number(v) < 0 ? 'danger' : Number(v) > 0 ? 'success' : undefined}>
                {fmtMoney(v)}
                {a.variancePct !== null ? ` (${a.variancePct}%)` : ''}
              </Typography.Text>
            ),
          },
          { title: 'Proyeksi setahun', dataIndex: 'forecastYear', align: 'right', render: fmtMoney },
          { title: 'Anggaran setahun', dataIndex: 'budgetYear', align: 'right', render: fmtMoney },
          { title: 'Status', dataIndex: 'status', render: (s: Status) => <Tag color={STATUS[s].color}>{STATUS[s].text}</Tag> },
        ]}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
        Selisih positif = menguntungkan (pendapatan di atas anggaran atau beban di bawah anggaran). Peringatan: beban melebihi anggaran lebih dari toleransi {r?.budget?.tolerancePct ?? 10}%, beban tanpa anggaran, atau ≥ 90% anggaran setahun sudah terpakai.
      </Typography.Paragraph>
    </>
  );
}

function EditTab({ year }: { year: number }) {
  const { me } = useAuth();
  const admin = me?.role === 'OWNER' || me?.role === 'ADMIN';
  const q = useQuery({ queryKey: ['budget', 'grid', year], queryFn: () => get<Grid>(`/budgets/${year}`) });
  const [rows, setRows] = useState<Record<string, string[]>>({});
  const [growth, setGrowth] = useState<number>(5);
  const [reopen, setReopen] = useState(false);
  const [form] = Form.useForm<{ reason: string }>();
  const locked = q.data?.budget?.status === 'APPROVED';
  useEffect(() => {
    if (q.data) setRows(Object.fromEntries(q.data.rows.map((r) => [r.accountId, r.months])));
  }, [q.data]);
  const inv = ['budget', 'me'];
  const save = useAction(() => put(`/budgets/${year}`, { rows: Object.entries(rows).map(([accountId, months]) => ({ accountId, months: months.map((m) => String(m || 0)) })) }), { success: 'Anggaran disimpan', invalidate: inv });
  const seed = useAction(() => post(`/budgets/${year}/seed`, { fromYear: year - 1, growthPct: growth }), { success: 'Anggaran diisi dari realisasi', invalidate: inv });
  const approve = useAction(() => post(`/budgets/${year}/approve`), { success: 'Anggaran disetujui & dikunci', invalidate: inv });
  const doReopen = useAction((v: { reason: string }) => post(`/budgets/${year}/reopen`, v), { success: 'Anggaran dibuka kembali', invalidate: inv, onSuccess: () => setReopen(false) });
  const suggested = useQuery({ queryKey: ['budget', 'suggested'], queryFn: () => get<{ model: string; accountIds: string[] }>('/budgets/suggested') });
  const accounts = q.data?.accounts ?? [];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const set = (id: string, i: number, v: number | null) => setRows((r) => ({ ...r, [id]: r[id].map((x, j) => (j === i ? String(v ?? 0) : x)) }));
  return (
    <>
      {locked && <Alert type="success" showIcon style={{ marginBottom: 12 }} message="Anggaran sudah disetujui dan terkunci." />}
      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          showSearch
          placeholder="Tambah akun ke anggaran"
          style={{ width: 280 }}
          disabled={locked}
          value={null}
          optionFilterProp="label"
          options={accounts.filter((a) => !rows[a.id]).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))}
          onChange={(id: string) => setRows((r) => ({ ...r, [id]: Array(12).fill('0') }))}
        />
        <Button
          disabled={locked || !suggested.data?.accountIds.length}
          onClick={() => setRows((r) => ({ ...Object.fromEntries((suggested.data?.accountIds ?? []).map((id) => [id, Array(12).fill('0')])), ...r }))}
        >
          Akun yang disarankan untuk usaha Anda
        </Button>
        <Button onClick={() => seed.mutate(undefined)} disabled={locked} loading={seed.isPending}>
          Isi dari realisasi {year - 1}
        </Button>
        <span>naik</span>
        <InputNumber value={growth} onChange={(v) => setGrowth(Number(v ?? 0))} min={-90} max={500} style={{ width: 80 }} suffix="%" />
        <Button type="primary" onClick={() => save.mutate(undefined)} disabled={locked} loading={save.isPending}>
          Simpan
        </Button>
        {admin && !locked && q.data?.budget && (
          <Button onClick={() => approve.mutate(undefined)} loading={approve.isPending}>
            Setujui & kunci
          </Button>
        )}
        {admin && locked && <Button danger onClick={() => setReopen(true)}>Buka kunci</Button>}
      </Space>
      <Table
        size="small"
        rowKey="id"
        loading={q.isLoading}
        pagination={false}
        scroll={{ x: 1500 }}
        dataSource={Object.keys(rows).map((id) => ({ id }))}
        columns={[
          { title: 'Akun', fixed: 'left', width: 220, render: (_, r: { id: string }) => `${byId.get(r.id)?.code ?? ''} ${byId.get(r.id)?.name ?? ''}` },
          ...MONTH_NAMES.map((n, i) => ({
            title: n,
            width: 110,
            render: (_: unknown, r: { id: string }) => <InputNumber {...rupiahInput} size="small" min={0} disabled={locked} value={Number(rows[r.id]?.[i] ?? 0)} onChange={(v) => set(r.id, i, v)} style={{ width: 100 }} />,
          })),
          {
            title: '',
            width: 60,
            render: (_: unknown, r: { id: string }) => (
              <Button size="small" type="text" danger disabled={locked} onClick={() => setRows((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== r.id)))}>
                Hapus
              </Button>
            ),
          },
        ]}
      />
      <Modal title="Buka kunci anggaran" open={reopen} onCancel={() => setReopen(false)} onOk={() => form.submit()} confirmLoading={doReopen.isPending} okText="Buka kunci">
        <Form form={form} layout="vertical" onFinish={(v) => doReopen.mutate(v)}>
          <Form.Item name="reason" label="Alasan (tercatat di jejak audit)" rules={[{ required: true, min: 5 }]}>
            <Input.TextArea rows={2} maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export default function BudgetPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  return (
    <>
      <PageHeader
        title="Anggaran vs realisasi"
        extra={<Select value={year} onChange={setYear} options={[year - 2, year - 1, year, year + 1].map((y) => ({ value: y, label: `Tahun ${y}` }))} style={{ width: 130 }} />}
      />
      <Card>
        <Tabs
          items={[
            { key: 'report', label: 'Realisasi', children: <ReportTab year={year} /> },
            { key: 'edit', label: 'Susun anggaran', children: <EditTab year={year} /> },
          ]}
        />
      </Card>
    </>
  );
}
