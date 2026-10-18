import { CheckCircleTwoTone, InboxOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from 'antd';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, get, post, put } from '@/api/client';
import { canBookkeep, canHandleMoney } from '@sansu/shared';
import { useAuth } from '@/auth/AuthContext';
import { LEDGER_KEYS, useAccounts, useAction, useCashAccounts } from '@/api/queries';
import type { BankCandidate, BankLineStatus, BankReconciliation, BankStatement, BankStatementLine, BankStatementSummary } from '@/api/types';
import PageHeader from '@/layout/PageHeader';
import { type ColumnMap, findHeader, type Grid, guessColumns, readGrid, toLines } from '@/lib/bankParse';
import { fmtDate, fmtMoney, today } from '@/lib/format';

const STATUS: Record<BankLineStatus, { color: string; label: string }> = {
  UNMATCHED: { color: 'orange', label: 'Belum cocok' },
  MATCHED: { color: 'green', label: 'Cocok' },
  CREATED: { color: 'blue', label: 'Dijurnal' },
  IGNORED: { color: 'default', label: 'Diabaikan' },
};
const KEYS = ['bank', ...LEDGER_KEYS];
const signed = (v: string | number) => {
  const n = Number(v);
  return <span style={{ color: n < 0 ? '#cf1322' : '#389e0d', whiteSpace: 'nowrap' }}>{n < 0 ? `− ${fmtMoney(-n)}` : `+ ${fmtMoney(n)}`}</span>;
};

/** Impor file mutasi: pilih file → kolom ditebak otomatis → periksa → simpan */
function ImportModal({ open, onClose, cashAccountId, onDone }: { open: boolean; onClose: () => void; cashAccountId?: string; onDone: (id: string) => void }) {
  const cash = useCashAccounts();
  const [account, setAccount] = useState<string | undefined>(cashAccountId);
  const [file, setFile] = useState<File | null>(null);
  const [grid, setGrid] = useState<Grid>([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [map, setMap] = useState<ColumnMap>({});
  const [year, setYear] = useState(dayjs().year());
  const header = grid[headerRow] ?? [];
  const colOptions = header.map((h, i) => ({ value: i, label: `${String.fromCharCode(65 + (i % 26))} · ${String(h ?? '').slice(0, 30) || '(kosong)'}` }));
  const parsed = useMemo(() => (grid.length ? toLines(grid, headerRow, map, year) : { lines: [], skipped: 0, pending: 0 }), [grid, headerRow, map, year]);
  const totalIn = parsed.lines.filter((l) => Number(l.amount) > 0).reduce((a, l) => a + Number(l.amount), 0);
  const totalOut = parsed.lines.filter((l) => Number(l.amount) < 0).reduce((a, l) => a + Number(l.amount), 0);

  const save = useAction(
    () => post<BankStatement & { skippedDuplicates?: number }>('/bank/statements', { cashAccountId: account, fileName: file?.name, lines: parsed.lines }),
    {
      success: (s) => `${s.lines.length} mutasi diimpor · ${s.summary.counts.MATCHED} cocok dengan buku${s.skippedDuplicates ? ` · ${s.skippedDuplicates} mutasi ganda dilewati` : ''}`,
      invalidate: KEYS,
      onSuccess: (s) => {
        onDone(s.id);
        onClose();
        setGrid([]);
        setFile(null);
      },
    },
  );

  const load = async (f: File) => {
    const g = await readGrid(f);
    const h = findHeader(g);
    setFile(f);
    setGrid(g);
    setHeaderRow(h);
    setMap(guessColumns(g[h] ?? []));
    return false;
  };
  const sel = (k: keyof ColumnMap, label: string) => (
    <Form.Item label={label} style={{ marginBottom: 8 }}>
      <Select allowClear value={map[k]} onChange={(v) => setMap((m) => ({ ...m, [k]: v }))} options={colOptions} style={{ width: 200 }} />
    </Form.Item>
  );

  return (
    <Modal
      title="Impor mutasi rekening"
      open={open}
      width={1000}
      onCancel={onClose}
      onOk={() => save.mutate(undefined)}
      okText={`Impor ${parsed.lines.length} mutasi`}
      okButtonProps={{ disabled: !account || !parsed.lines.length }}
      confirmLoading={save.isPending}
    >
      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          placeholder="Rekening bank"
          value={account}
          onChange={setAccount}
          style={{ width: 280 }}
          options={cash.data?.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))}
        />
        <InputNumber value={year} onChange={(v) => v && setYear(v)} prefix="Tahun" min={2000} max={2100} style={{ width: 150 }} />
      </Space>
      <Upload.Dragger accept=".csv,.xls,.xlsx,.txt" maxCount={1} beforeUpload={load} showUploadList={false}>
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p>{file ? file.name : 'Seret file mutasi (CSV / Excel) dari internet banking ke sini'}</p>
        <Typography.Text type="secondary">BCA, Mandiri, BRI, BNI, BSI, CIMB, dll. — kolom dikenali otomatis</Typography.Text>
      </Upload.Dragger>
      {grid.length > 0 && (
        <>
          <Card size="small" title="Kolom" style={{ marginTop: 12 }}>
            <Space wrap>
              <Form.Item label="Baris judul" style={{ marginBottom: 8 }}>
                <InputNumber min={1} max={grid.length} value={headerRow + 1} onChange={(v) => v && (setHeaderRow(v - 1), setMap(guessColumns(grid[v - 1] ?? [])))} />
              </Form.Item>
              {sel('date', 'Tanggal')}
              {sel('description', 'Keterangan')}
              {sel('debit', 'Debet (keluar)')}
              {sel('credit', 'Kredit (masuk)')}
              {sel('amount', 'Atau: mutasi')}
              {sel('dc', 'Penanda DB/CR')}
              {sel('balance', 'Saldo')}
            </Space>
          </Card>
          <Row gutter={16} style={{ margin: '12px 0' }}>
            <Col span={8}>
              <Statistic
                title="Mutasi terbaca"
                value={parsed.lines.length}
                suffix={[parsed.skipped && `${parsed.skipped} baris dilewati`, parsed.pending && `${parsed.pending} tertunda (belum dibukukan bank)`].filter(Boolean).join(' · ')}
              />
            </Col>
            <Col span={8}>
              <Statistic title="Uang masuk" value={totalIn} formatter={(v) => fmtMoney(Number(v))} valueStyle={{ color: '#389e0d' }} />
            </Col>
            <Col span={8}>
              <Statistic title="Uang keluar" value={-totalOut} formatter={(v) => fmtMoney(Number(v))} valueStyle={{ color: '#cf1322' }} />
            </Col>
          </Row>
          <Table
            size="small"
            rowKey="_k"
            dataSource={parsed.lines.slice(0, 8).map((l, i) => ({ ...l, _k: i }))}
            pagination={false}
            columns={[
              { title: 'Tanggal', dataIndex: 'date', render: fmtDate, width: 110 },
              { title: 'Keterangan', dataIndex: 'description', ellipsis: true },
              { title: 'Mutasi', dataIndex: 'amount', align: 'right', render: signed },
              { title: 'Saldo', dataIndex: 'balance', align: 'right', render: (v) => (v ? fmtMoney(v) : '') },
            ]}
            footer={() => (parsed.lines.length > 8 ? `… dan ${parsed.lines.length - 8} mutasi lainnya` : null)}
          />
        </>
      )}
    </Modal>
  );
}

function StatementDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const money = canHandleMoney(useAuth().me?.role);
  const accounts = useAccounts();
  const [filter, setFilter] = useState<BankLineStatus | 'ALL'>('ALL');
  const [creating, setCreating] = useState<BankStatementLine | null>(null);
  const [matching, setMatching] = useState<BankStatementLine | null>(null);
  const [form] = Form.useForm();
  const st = useQuery({ queryKey: ['bank', 'statement', id], queryFn: () => get<BankStatement>(`/bank/statements/${id}`), enabled: !!id });
  const cand = useQuery({ queryKey: ['bank', 'candidates', matching?.id], queryFn: () => get<BankCandidate[]>(`/bank/lines/${matching!.id}/candidates`), enabled: !!matching });
  const auto = useAction(() => post<{ matched: number }>(`/bank/statements/${id}/auto-match`), { success: (r) => `${r.matched} mutasi baru cocok`, invalidate: KEYS });
  const create = useAction((v: { accountId: string; description?: string }) => post<{ journalNumber: string }>(`/bank/lines/${creating!.id}/create`, v), {
    success: (r) => `Jurnal ${r.journalNumber} dibuat`,
    invalidate: KEYS,
    onSuccess: () => setCreating(null),
  });
  const match = useAction((journalLineId: string) => post(`/bank/lines/${matching!.id}/match`, { journalLineId }), {
    success: 'Dicocokkan',
    invalidate: KEYS,
    onSuccess: () => setMatching(null),
  });
  const action = useAction(({ line, act }: { line: string; act: 'unmatch' | 'ignore' }) => post(`/bank/lines/${line}/${act}`), { invalidate: KEYS });
  const [ignoring, setIgnoring] = useState<BankStatementLine | null>(null);
  const [ignoreForm] = Form.useForm<{ reason: string }>();
  const ignore = useAction((v: { reason: string }) => post(`/bank/lines/${ignoring!.id}/ignore`, v), { success: 'Mutasi diabaikan (tercatat di jejak audit)', invalidate: KEYS, onSuccess: () => setIgnoring(null) });
  const d = st.data;
  const byKey = (k: string) => accounts.data?.find((a) => a.systemKey === k)?.id;
  const counterOptions = accounts.data?.filter((a) => a.isPostable && a.id !== d?.cashAccount.id).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }));
  const rows = d?.lines.filter((l) => filter === 'ALL' || l.status === filter) ?? [];

  return (
    <Drawer title={d ? `${d.cashAccount.name} · ${fmtDate(d.periodFrom)} – ${fmtDate(d.periodTo)}` : 'Rekening koran'} open={!!id} onClose={onClose} width={1100}>
      {d && (
        <>
          <Row gutter={16} style={{ marginBottom: 12 }}>
            {(Object.keys(STATUS) as BankLineStatus[]).map((k) => (
              <Col xs={12} md={6} key={k}>
                <Card size="small" hoverable onClick={() => setFilter(filter === k ? 'ALL' : k)} style={{ borderColor: filter === k ? '#1677ff' : undefined }}>
                  <Statistic title={STATUS[k].label} value={d.summary.counts[k] ?? 0} />
                </Card>
              </Col>
            ))}
          </Row>
          <Space style={{ marginBottom: 12 }} wrap>
            {money && (
              <Button icon={<ReloadOutlined />} loading={auto.isPending} onClick={() => auto.mutate(undefined)}>
                Cocokkan otomatis lagi
              </Button>
            )}
            <Typography.Text type="secondary">
              Masuk {fmtMoney(d.summary.totalIn)} · keluar {fmtMoney(-Number(d.summary.totalOut))}
              {d.closingBalance && ` · saldo akhir bank ${fmtMoney(d.closingBalance)}`}
            </Typography.Text>
          </Space>
          <Table
            size="small"
            rowKey="id"
            dataSource={rows}
            pagination={{ pageSize: 50, hideOnSinglePage: true }}
            scroll={{ x: 1000 }}
            columns={[
              { title: 'Tanggal', dataIndex: 'date', render: fmtDate, width: 105 },
              { title: 'Keterangan bank', dataIndex: 'description', ellipsis: true },
              { title: 'Mutasi', dataIndex: 'amount', align: 'right', render: signed, width: 150 },
              { title: 'Status', dataIndex: 'status', width: 110, render: (s: BankLineStatus) => <Tag color={STATUS[s].color}>{STATUS[s].label}</Tag> },
              {
                title: 'Transaksi di buku',
                render: (_, l) =>
                  l.book ? (
                    <span>
                      <Typography.Text code>{l.book.number}</Typography.Text> {fmtDate(l.book.date)} · <Typography.Text type="secondary">{l.book.description}</Typography.Text>
                    </span>
                  ) : null,
                ellipsis: true,
              },
              {
                width: 250,
                render: (_, l) =>
                  !money ? null : l.status === 'UNMATCHED' ? (
                    <Space size={4}>
                      <Button
                        size="small"
                        type="primary"
                        onClick={() => {
                          const neg = Number(l.amount) < 0;
                          const text = l.description.toUpperCase();
                          const guess = /BIAYA|ADM|CHARGE|FEE/.test(text) ? byKey('BANK_CHARGES') : /BUNGA|JASA GIRO|INTEREST/.test(text) ? byKey('INTEREST_INCOME') : undefined;
                          form.setFieldsValue({ accountId: guess ?? (neg ? byKey('BANK_CHARGES') : undefined), description: l.description });
                          setCreating(l);
                        }}
                      >
                        Buat jurnal
                      </Button>
                      <Button size="small" onClick={() => setMatching(l)}>
                        Cocokkan
                      </Button>
                      <Button size="small" type="text" onClick={() => { ignoreForm.resetFields(); setIgnoring(l); }}>
                        Abaikan
                      </Button>
                    </Space>
                  ) : l.status === 'MATCHED' || l.status === 'IGNORED' ? (
                    <Button size="small" type="link" onClick={() => action.mutate({ line: l.id, act: 'unmatch' })}>
                      Batalkan
                    </Button>
                  ) : null,
              },
            ]}
          />
        </>
      )}
      <Modal title="Abaikan mutasi bank" open={!!ignoring} onCancel={() => setIgnoring(null)} onOk={() => ignoreForm.submit()} confirmLoading={ignore.isPending} okText="Abaikan">
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Mutasi yang diabaikan tidak ikut rekonsiliasi. Uang keluar hanya boleh diabaikan Pemilik/Admin. Alasan tercatat di jejak audit." />
        <Form form={ignoreForm} layout="vertical" onFinish={(v) => ignore.mutate(v)}>
          <Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5, message: 'Isi alasan (min. 5 karakter)' }]}>
            <Input.TextArea rows={2} maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal title="Buat jurnal dari mutasi bank" open={!!creating} onCancel={() => setCreating(null)} onOk={() => form.submit()} confirmLoading={create.isPending} okText="Posting">
        {creating && (
          <Typography.Paragraph>
            {fmtDate(creating.date)} · {creating.description} · {signed(creating.amount)}
          </Typography.Paragraph>
        )}
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Form.Item name="accountId" label="Akun lawan" rules={[{ required: true }]} extra="Biaya admin → Beban Administrasi Bank; bunga/jasa giro → Pendapatan Bunga; pajak bunga → Beban Pajak.">
            <Select showSearch optionFilterProp="label" options={counterOptions} />
          </Form.Item>
          <Form.Item name="description" label="Keterangan jurnal">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
      <Modal title="Cocokkan dengan transaksi di buku" open={!!matching} onCancel={() => setMatching(null)} footer={null} width={860}>
        {matching && (
          <Typography.Paragraph>
            Mutasi bank: {fmtDate(matching.date)} · {matching.description} · {signed(matching.amount)}
          </Typography.Paragraph>
        )}
        <Table
          size="small"
          rowKey="id"
          loading={cand.isLoading}
          dataSource={cand.data}
          pagination={false}
          locale={{ emptyText: <Empty description="Tidak ada transaksi buku yang belum dicocokkan di sekitar tanggal ini" /> }}
          columns={[
            { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
            { title: 'Jurnal', dataIndex: 'number' },
            { title: 'Keterangan', dataIndex: 'description', ellipsis: true },
            { title: 'Nilai', dataIndex: 'amount', align: 'right', render: (v, c) => <span style={{ fontWeight: c.same ? 600 : 400 }}>{signed(v)}</span> },
            {
              render: (_, c) =>
                c.same ? (
                  <Button size="small" type="primary" loading={match.isPending} onClick={() => match.mutate(c.id)}>
                    Pilih
                  </Button>
                ) : (
                  <Typography.Text type="secondary">nilai beda</Typography.Text>
                ),
            },
          ]}
        />
      </Modal>
    </Drawer>
  );
}

function ReconciliationTab({ cashAccountId }: { cashAccountId?: string }) {
  const [asOf, setAsOf] = useState(today());
  const rec = useQuery({
    queryKey: ['bank', 'rec', cashAccountId, asOf],
    queryFn: () => get<BankReconciliation>(`/bank/reconciliation?cashAccountId=${cashAccountId}&asOf=${asOf}`),
    enabled: !!cashAccountId,
  });
  const d = rec.data;
  if (!cashAccountId) return <Empty description="Pilih rekening bank" />;
  const list = (title: string, rows: { date: string; number?: string; description: string; amount: string }[], total: string, sign: string) => (
    <Table
      size="small"
      rowKey="_k"
      dataSource={rows.map((r, i) => ({ ...r, _k: `${r.number ?? r.date}-${i}` }))}
      pagination={{ pageSize: 10, hideOnSinglePage: true }}
      title={() => <strong>{title}</strong>}
      locale={{ emptyText: 'Tidak ada' }}
      columns={[
        { title: 'Tanggal', dataIndex: 'date', render: fmtDate, width: 110 },
        { title: 'Nomor', dataIndex: 'number', width: 150 },
        { title: 'Keterangan', dataIndex: 'description', ellipsis: true },
        { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: fmtMoney },
      ]}
      summary={() => (
        <Table.Summary.Row>
          <Table.Summary.Cell index={0} colSpan={3}>
            <strong>Jumlah ({sign})</strong>
          </Table.Summary.Cell>
          <Table.Summary.Cell index={3} align="right">
            <strong>{fmtMoney(total)}</strong>
          </Table.Summary.Cell>
        </Table.Summary.Row>
      )}
      style={{ marginBottom: 16 }}
    />
  );
  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value || today())} prefix="Per" />
      </Space>
      {d && (
        <>
          {d.bankBalance === null ? (
            <Alert type="info" showIcon message="Belum ada mutasi bersaldo yang diimpor untuk rekening ini sampai tanggal tersebut." style={{ marginBottom: 12 }} />
          ) : d.reconciled ? (
            <Alert type="success" showIcon icon={<CheckCircleTwoTone twoToneColor="#52c41a" />} message="Saldo bank dan saldo buku cocok setelah penyesuaian." style={{ marginBottom: 12 }} />
          ) : (
            <Alert type="warning" showIcon message={`Masih ada selisih ${fmtMoney(d.difference)} — periksa mutasi yang belum dicocokkan.`} style={{ marginBottom: 12 }} />
          )}
          <Row gutter={16}>
            <Col xs={24} lg={12}>
              <Card size="small" title="Menurut rekening koran bank">
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label={`Saldo bank ${d.bankBalanceDate ? `(${fmtDate(d.bankBalanceDate)})` : ''}`}>{d.bankBalance ? fmtMoney(d.bankBalance) : '—'}</Descriptions.Item>
                  <Descriptions.Item label="+ Setoran dalam perjalanan">{fmtMoney(d.totals.depositsInTransit)}</Descriptions.Item>
                  <Descriptions.Item label="− Pembayaran belum dicairkan">{fmtMoney(d.totals.outstandingPayments)}</Descriptions.Item>
                  <Descriptions.Item label="Saldo bank disesuaikan">
                    <strong>{d.adjustedBank ? fmtMoney(d.adjustedBank) : '—'}</strong>
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card size="small" title="Menurut buku (SANSU)">
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="Saldo buku">{fmtMoney(d.bookBalance)}</Descriptions.Item>
                  <Descriptions.Item label="± Mutasi bank belum dicatat">{fmtMoney(d.totals.unrecorded)}</Descriptions.Item>
                  <Descriptions.Item label="Saldo buku disesuaikan">
                    <strong>{fmtMoney(d.adjustedBook)}</strong>
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
          </Row>
          <div style={{ marginTop: 16 }}>
            {list('Setoran dalam perjalanan (di buku, belum di bank)', d.depositsInTransit, d.totals.depositsInTransit, '+')}
            {list('Pembayaran belum dicairkan (di buku, belum di bank)', d.outstandingPayments, d.totals.outstandingPayments, '−')}
            {list('Mutasi bank belum dicatat di buku', d.unrecorded, d.totals.unrecorded, '±')}
          </div>
        </>
      )}
    </>
  );
}

interface BankFinding {
  key: string;
  level: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  refs: string[];
}
interface BankRule {
  id: string;
  name: string;
  keyword: string;
  direction: 'IN' | 'OUT' | 'ANY';
  accountId: string;
  maxAmount: string;
  isActive: boolean;
}

/** Aturan kategori otomatis: mutasi dengan kata tertentu langsung dijurnal saat impor */
function RulesTab() {
  const accounts = useAccounts();
  const q = useQuery({ queryKey: ['bank', 'rules'], queryFn: () => get<BankRule[]>('/bank/rules') });
  const [editing, setEditing] = useState<BankRule | 'new' | null>(null);
  const [form] = Form.useForm<{ name: string; keyword: string; direction: 'IN' | 'OUT' | 'ANY'; accountId: string; maxAmount: number }>();
  const save = useAction(
    (v: { name: string; keyword: string; direction: 'IN' | 'OUT' | 'ANY'; accountId: string; maxAmount: number }) => {
      const body = { ...v, maxAmount: String(v.maxAmount ?? 5000000) };
      return editing && editing !== 'new' ? put(`/bank/rules/${editing.id}`, body) : post('/bank/rules', body);
    },
    { success: 'Aturan disimpan', invalidate: ['bank', 'rules'], onSuccess: () => setEditing(null) },
  );
  const del = useAction((id: string) => api(`/bank/rules/${id}`, { method: 'DELETE' }), { success: 'Aturan dihapus', invalidate: ['bank', 'rules'] });
  const { me } = useAuth();
  const admin = me?.role === 'OWNER' || me?.role === 'ADMIN';
  const defaults = useAction(() => post<{ added: number }>('/bank/rules/defaults'), { success: (r) => (r.added ? `${r.added} aturan bawaan dipasang` : 'Aturan bawaan sudah ada semua'), invalidate: ['bank', 'rules'] });
  const options = (accounts.data ?? []).filter((a) => a.isPostable && (a.type === 'EXPENSE' || a.type === 'REVENUE')).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }));
  const name = (id: string) => accounts.data?.find((a) => a.id === id);
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Saat mutasi diimpor, mutasi yang belum cocok dengan buku dan memuat kata kunci aturan langsung dijurnal otomatis (mis. 'BIAYA ADM' → Beban Administrasi Bank). Hanya akun pendapatan/beban, dan hanya sampai batas nilai aturan; di atasnya tetap manual." />
      {admin ? (
        <Space style={{ marginBottom: 12 }}>
          <Button type="primary" onClick={() => { form.resetFields(); form.setFieldsValue({ direction: 'OUT', maxAmount: 5000000 }); setEditing('new'); }}>
            Aturan baru
          </Button>
          <Button onClick={() => defaults.mutate(undefined)} loading={defaults.isPending}>
            Pasang aturan bawaan untuk usaha Anda
          </Button>
        </Space>
      ) : (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Aturan otomatis hanya dapat diubah Pemilik/Admin." />
      )}
      <Table
        rowKey="id"
        size="small"
        loading={q.isLoading}
        dataSource={q.data}
        pagination={false}
        columns={[
          { title: 'Nama', dataIndex: 'name' },
          { title: 'Kata kunci', dataIndex: 'keyword' },
          { title: 'Arah', dataIndex: 'direction', render: (d: string) => ({ IN: 'Uang masuk', OUT: 'Uang keluar', ANY: 'Keduanya' })[d] },
          { title: 'Akun', render: (_, r: BankRule) => `${name(r.accountId)?.code ?? ''} ${name(r.accountId)?.name ?? ''}` },
          { title: 'Batas nilai', dataIndex: 'maxAmount', align: 'right', render: fmtMoney },
          {
            render: (_, r: BankRule) => admin && (
              <Space>
                <Button size="small" type="link" onClick={() => { form.setFieldsValue({ ...r, maxAmount: Number(r.maxAmount) }); setEditing(r); }}>Ubah</Button>
                <Popconfirm title="Hapus aturan ini?" onConfirm={() => del.mutate(r.id)}>
                  <Button size="small" type="link" danger>Hapus</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Modal title={editing === 'new' ? 'Aturan baru' : 'Ubah aturan'} open={!!editing} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={save.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Form.Item name="name" label="Nama" rules={[{ required: true }]}><Input maxLength={80} /></Form.Item>
          <Form.Item name="keyword" label="Kata kunci di keterangan mutasi" rules={[{ required: true, min: 3, message: 'Min. 3 huruf' }]}><Input maxLength={80} placeholder="BIAYA ADM" /></Form.Item>
          <Form.Item name="direction" label="Arah"><Radio.Group options={[{ label: 'Uang keluar', value: 'OUT' }, { label: 'Uang masuk', value: 'IN' }, { label: 'Keduanya', value: 'ANY' }]} /></Form.Item>
          <Form.Item name="accountId" label="Akun lawan (pendapatan / beban)" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={options} /></Form.Item>
          <Form.Item name="maxAmount" label="Otomatis sampai nilai" extra="Mutasi lebih besar dari ini tetap diproses manual."><InputNumber min={1} style={{ width: '100%' }} prefix="Rp" /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

/** Pengesahan rekonsiliasi akhir bulan oleh orang selain pengimpor */
function SignoffTab({ cashAccountId }: { cashAccountId?: string }) {
  const canSign = canBookkeep(useAuth().me?.role);
  const q = useQuery({ queryKey: ['bank', 'signoffs', cashAccountId], queryFn: () => get<{ id: string; period: string; bookBalance: string; signedAt: string }[]>(`/bank/signoffs?cashAccountId=${cashAccountId}`), enabled: !!cashAccountId });
  const periods = Array.from({ length: 6 }, (_, i) => dayjs().subtract(i + 1, 'month').format('YYYY-MM'));
  const sign = useAction((period: string) => post('/bank/signoffs', { cashAccountId, period }), { success: 'Rekonsiliasi disahkan', invalidate: ['bank', 'signoffs'] });
  const done = new Map((q.data ?? []).map((x) => [x.period, x]));
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Setelah rekonsiliasi akhir bulan selisihnya nol, sahkan di sini. Pengesah harus orang lain dari yang mengimpor rekening koran bulan itu (Pemilik boleh)." />
      <Table
        rowKey="period"
        size="small"
        pagination={false}
        dataSource={periods.map((p) => ({ period: p }))}
        columns={[
          { title: 'Bulan', dataIndex: 'period' },
          { title: 'Status', render: (_, r: { period: string }) => (done.has(r.period) ? <Tag color="green">Disahkan</Tag> : <Tag>Belum</Tag>) },
          { title: 'Saldo buku', render: (_, r: { period: string }) => (done.has(r.period) ? fmtMoney(done.get(r.period)!.bookBalance) : '-'), align: 'right' },
          { title: 'Disahkan', render: (_, r: { period: string }) => (done.has(r.period) ? fmtDate(done.get(r.period)!.signedAt) : '-') },
          { render: (_, r: { period: string }) => (done.has(r.period) || !canSign ? null : <Button size="small" onClick={() => sign.mutate(r.period)} loading={sign.isPending}>Sahkan</Button>) },
        ]}
      />
    </>
  );
}

export default function BankPage() {
  const cash = useCashAccounts();
  const [params, setParams] = useSearchParams();
  const banks = cash.data ?? [];
  const accountId = params.get('account') ?? banks.find((b) => /bank/i.test(b.name))?.id ?? banks[0]?.id;
  const [importing, setImporting] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState('statements');
  const list = useQuery({
    queryKey: ['bank', 'statements', accountId],
    queryFn: () => get<BankStatementSummary[]>(`/bank/statements?cashAccountId=${accountId}`),
    enabled: !!accountId,
  });
  const { me } = useAuth();
  const admin = me?.role === 'OWNER' || me?.role === 'ADMIN';
  const controls = useQuery({ queryKey: ['bank', 'controls'], queryFn: () => get<{ items: BankFinding[] }>('/bank/controls') });
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeForm] = Form.useForm<{ reason: string }>();
  const remove = useAction((v: { id: string; reason: string }) => api(`/bank/statements/${v.id}?reason=${encodeURIComponent(v.reason)}`, { method: 'DELETE' }), { success: 'Rekening koran dihapus', invalidate: KEYS, onSuccess: () => setRemoving(null) });

  return (
    <>
      <PageHeader
        title="Cocokkan dengan bank (rekonsiliasi)"
        extra={
          <Space wrap>
            <Radio.Group
              value={accountId}
              onChange={(e) => setParams({ account: e.target.value }, { replace: true })}
              optionType="button"
              options={banks.map((b) => ({ value: b.id, label: b.name }))}
            />
            {canHandleMoney(me?.role) && (
              <Button type="primary" icon={<UploadOutlined />} onClick={() => setImporting(true)}>
                Impor mutasi
              </Button>
            )}
          </Space>
        }
      />
      {!!controls.data?.items.length && (
        <Card size="small" title="Kontrol bank" style={{ marginBottom: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            {controls.data.items.map((c) => (
              <Alert key={c.key} type={c.level} showIcon message={c.title} description={<div><div>{c.detail}</div><div style={{ marginTop: 4 }}><strong>Contoh:</strong> {c.refs.slice(0, 4).join(' · ')}{c.refs.length > 4 ? ` · +${c.refs.length - 4}` : ''}</div></div>} />
            ))}
          </Space>
        </Card>
      )}
      <Card>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'statements',
              label: 'Rekening koran',
              children: (
                <Table
                  rowKey="id"
                  loading={list.isLoading}
                  dataSource={list.data}
                  onRow={(r) => ({ onClick: () => setOpen(r.id), style: { cursor: 'pointer' } })}
                  locale={{ emptyText: <Empty description="Belum ada mutasi. Unduh mutasi rekening (CSV/Excel) dari internet banking, lalu klik Impor mutasi." /> }}
                  columns={[
                    { title: 'Periode', render: (_, r) => `${fmtDate(r.period_from)} – ${fmtDate(r.period_to)}` },
                    { title: 'File', dataIndex: 'file_name', render: (f) => f ?? '-' },
                    { title: 'Mutasi', dataIndex: 'lines' },
                    {
                      title: 'Sudah cocok',
                      render: (_, r) => (
                        <Tag color={r.matched === r.lines ? 'green' : 'orange'}>
                          {r.matched} / {r.lines}
                        </Tag>
                      ),
                    },
                    { title: 'Saldo akhir bank', dataIndex: 'closing_balance', align: 'right', render: (v) => (v ? fmtMoney(v) : '-') },
                    {
                      render: (_, r) => (
                        <span onClick={(e) => e.stopPropagation()}>
                          {admin && (
                            <Button size="small" type="text" danger onClick={() => { removeForm.resetFields(); setRemoving(r.id); }}>
                              Hapus
                            </Button>
                          )}
                        </span>
                      ),
                    },
                  ]}
                />
              ),
            },
            { key: 'rec', label: 'Laporan rekonsiliasi', children: <ReconciliationTab cashAccountId={accountId} /> },
            { key: 'sign', label: 'Pengesahan bulanan', children: <SignoffTab cashAccountId={accountId} /> },
            { key: 'rules', label: 'Aturan otomatis', children: <RulesTab /> },
          ]}
        />
      </Card>
      <ImportModal key={accountId} open={importing} onClose={() => setImporting(false)} cashAccountId={accountId} onDone={setOpen} />
      <StatementDrawer id={open} onClose={() => setOpen(null)} />
      <Modal title="Hapus rekening koran" open={!!removing} onCancel={() => setRemoving(null)} onOk={() => removeForm.submit()} confirmLoading={remove.isPending} okText="Hapus" okButtonProps={{ danger: true }}>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Jurnal yang sudah dibuat dari mutasi tetap ada; hanya pencocokannya yang dilepas. Alasan tercatat di jejak audit." />
        <Form form={removeForm} layout="vertical" onFinish={(v) => removing && remove.mutate({ id: removing, reason: v.reason })}>
          <Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5, message: 'Isi alasan (min. 5 karakter)' }]}><Input.TextArea rows={2} maxLength={300} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
