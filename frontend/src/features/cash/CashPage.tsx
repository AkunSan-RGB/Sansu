import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined, SwapOutlined } from '@ant-design/icons';
import { BRAND, CASH_TX_TYPE_LABELS, type CashTxType } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, Checkbox, Col, Form, Input, InputNumber, Modal, Row, Segmented, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, qs } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { LEDGER_KEYS, useBranches, useAction, useCashAccounts } from '@/api/queries';
import { withBudgetOverride } from '@/lib/budgetOverride';
import type { CashTransaction, Project } from '@/api/types';
import { useApps } from '@/lib/apps';
import CashAccountSelect from '@/components/CashAccountSelect';
import PageHeader from '@/layout/PageHeader';
import ExportButtons from '@/components/ExportButtons';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import { cashListSheet } from '@/lib/xlsx/reports';

interface CounterAccount {
  id: string;
  code: string;
  name: string;
  type: string;
}
interface FormValues {
  cashAccountId: string;
  toCashAccountId?: string;
  amount?: number;
  date: string;
  description: string;
  reference?: string;
  branchId?: string;
  lines?: { accountId?: string; amount?: number; memo?: string; projectId?: string; assetCategoryId?: string; assetName?: string; assetUsefulLifeMonths?: number; assetLocation?: string }[];
}

const TYPE_COLOR: Record<CashTxType, string> = { IN: 'green', OUT: 'red', TRANSFER: 'blue' };
const TITLE: Record<CashTxType, string> = {
  IN: 'Kas masuk — terima uang di luar penjualan',
  OUT: 'Kas keluar — bayar biaya / pengeluaran',
  TRANSFER: 'Transfer antar kas & bank',
};

export default function CashPage() {
  const navigate = useNavigate();
  const accounts = useCashAccounts();
  const [filter, setFilter] = useState<string>();
  const [from, setFrom] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [to, setTo] = useState(today());
  const [mode, setMode] = useState<CashTxType | null>(null);
  const [form] = Form.useForm<FormValues>();
  const lines = Form.useWatch('lines', form) ?? [];
  const { can } = useApps();
  const projectList = useQuery({ queryKey: ['projects'], queryFn: () => get<Project[]>('/services/projects'), enabled: can('sales') });
  const activeProjects = (projectList.data ?? []).filter((p) => p.status === 'ACTIVE');

  const [typeFilter, setTypeFilter] = useState<'ALL' | CashTxType>('ALL');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState<string>();
  const [noProofOnly, setNoProofOnly] = useState(false);
  const bankStatus = useQuery({ queryKey: ['bank', 'status'], queryFn: () => get<{ id: string; unmatched: number; stale: boolean }[]>('/bank/status'), retry: false });
  const txs = useQuery({
    queryKey: ['cash-tx', filter, from, to],
    queryFn: () => get<CashTransaction[]>(`/cash/transactions${qs({ cashAccountId: filter, from, to })}`),
  });
  // Akun aset tetap: pembelian tunai ke akun ini otomatis menjadi kartu aset di Aset Tetap
  const assetCats = useQuery({ queryKey: ['assets', 'categories'], queryFn: () => get<{ id: string; name: string; assetAccountId: string }[]>('/assets/categories') });
  const assetCatsByAccount = useMemo(() => {
    const m = new Map<string, { id: string; name: string }[]>();
    for (const c of assetCats.data ?? []) m.set(c.assetAccountId, [...(m.get(c.assetAccountId) ?? []), c]);
    return m;
  }, [assetCats.data]);
  const controls = useQuery({
    queryKey: ['cash', 'controls'],
    queryFn: () => get<{ items: { key: string; level: 'error' | 'warning' | 'info'; title: string; detail: string }[] }>('/cash/controls'),
  });
  const { me } = useAuth();
  const branchList = useBranches();
  const branchOpts = (branchList.data?.branches ?? []).filter((b) => b.isActive);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (txs.data ?? []).filter(
      (t) =>
        (typeFilter === 'ALL' || t.type === typeFilter) &&
        (!branchFilter || (branchFilter === 'NONE' ? !t.branchId : t.branchId === branchFilter)) &&
        (!noProofOnly || (t.type !== 'IN' && t.status !== 'VOID' && !t.reference?.trim())) &&
        (!q || `${t.number} ${t.description} ${t.reference ?? ''} ${t.cashAccount.name}`.toLowerCase().includes(q)),
    );
  }, [txs.data, typeFilter, branchFilter, noProofOnly, search]);
  const flow = useMemo(() => {
    const live = shown.filter((t) => t.status !== 'VOID');
    const inn = live.filter((t) => t.type === 'IN').reduce((a, t) => a + Number(t.amount), 0);
    const out = live.filter((t) => t.type === 'OUT').reduce((a, t) => a + Number(t.amount), 0);
    return { inn, out, net: inn - out, missing: live.filter((t) => t.type !== 'IN' && !t.reference?.trim()).length };
  }, [shown]);
  const canVoid = me?.role === 'OWNER' || me?.role === 'ADMIN';
  const [voiding, setVoiding] = useState<CashTransaction | null>(null);
  const [voidForm] = Form.useForm<{ reason: string }>();
  const canEvidence = me?.role === 'OWNER' || me?.role === 'ADMIN' || me?.role === 'FINANCE';
  const [proofing, setProofing] = useState<CashTransaction | null>(null);
  const [proofForm] = Form.useForm<{ reference: string }>();
  const doProof = useAction((v: { id: string; reference: string }) => post(`/cash/transactions/${v.id}/evidence`, { reference: v.reference }), {
    success: 'Nomor bukti disimpan',
    invalidate: ['cash'],
    onSuccess: () => setProofing(null),
  });
  const doVoid = useAction((v: { id: string; reason: string }) => post(`/cash/transactions/${v.id}/void`, { reason: v.reason }), {
    success: 'Transaksi dibatalkan (jurnal pembalik dibuat)',
    invalidate: [...LEDGER_KEYS, 'cash'],
    onSuccess: () => setVoiding(null),
  });
  const branches = useBranches();
  const counter = useQuery({
    queryKey: ['cash-counter-accounts'],
    queryFn: () => get<CounterAccount[]>('/cash/counter-accounts'),
    enabled: mode === 'IN' || mode === 'OUT',
  });

  const { modal } = App.useApp();
  const create = useAction(
    (v: FormValues) =>
      withBudgetOverride(modal, me?.role, (budgetOverrideReason) => post<{ number: string; journalNumber: string }>('/cash/transactions', {
        budgetOverrideReason,
        type: mode,
        cashAccountId: v.cashAccountId,
        date: v.date,
        description: v.description,
        reference: v.reference || undefined,
        branchId: v.branchId || undefined,
        ...(mode === 'TRANSFER'
          ? { toCashAccountId: v.toCashAccountId, amount: String(v.amount) }
          : {
              lines: (v.lines ?? []).map((l) => ({
                accountId: l.accountId,
                amount: String(l.amount),
                memo: l.memo || undefined,
                projectId: mode === 'OUT' ? l.projectId || undefined : undefined,
                ...(mode === 'OUT' && l.accountId && assetCatsByAccount.has(l.accountId)
                  ? { assetCategoryId: l.assetCategoryId, assetName: l.assetName || undefined, assetUsefulLifeMonths: l.assetUsefulLifeMonths, assetLocation: l.assetLocation || undefined }
                  : {}),
              })),
            }),
      })),
    {
      success: (r) => `${r.number} diposting · jurnal ${r.journalNumber}`,
      invalidate: LEDGER_KEYS,
      onSuccess: () => setMode(null),
    },
  );

  const openForm = (m: CashTxType) => {
    form.resetFields();
    const cash = accounts.data?.find((a) => a.code.startsWith('1-11')) ?? accounts.data?.[0];
    form.setFieldsValue({ date: today(), cashAccountId: filter ?? cash?.id, lines: [{}] });
    setMode(m);
  };

  const total = (accounts.data ?? []).reduce((a, x) => a + Number(x.balance), 0);
  const withProject = mode === 'OUT' && activeProjects.length > 0;
  const linesTotal = lines.reduce((a, l) => a + (l?.amount ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Kas & Bank"
        extra={
          <Space wrap>
            <Button icon={<ArrowDownOutlined />} onClick={() => openForm('IN')}>
              Kas masuk
            </Button>
            <Button icon={<ArrowUpOutlined />} onClick={() => openForm('OUT')}>
              Kas keluar
            </Button>
            <Button icon={<SwapOutlined />} onClick={() => openForm('TRANSFER')}>
              Transfer
            </Button>
          </Space>
        }
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} xl={6}>
          <Card loading={accounts.isLoading} hoverable onClick={() => setFilter(undefined)} style={!filter ? { borderColor: BRAND.colors.primary } : undefined}>
            <Statistic title="Total kas & bank" value={fmtMoney(total)} />
            <Typography.Text type="secondary">Semua akun</Typography.Text>
          </Card>
        </Col>
        {accounts.data?.map((a) => (
          <Col xs={24} sm={12} xl={6} key={a.id}>
            <Card hoverable onClick={() => setFilter(a.id)} style={filter === a.id ? { borderColor: BRAND.colors.primary } : undefined}>
              <Statistic title={`${a.code} · ${a.name}`} value={fmtMoney(a.balance)} />
              <Button
                type="link"
                size="small"
                style={{ padding: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/ledger?accountId=${a.id}`);
                }}
              >
                Lihat mutasi lengkap →
              </Button>
              {/bank/i.test(a.name) && (
                <div style={{ marginTop: 4 }}>
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/bank?account=${a.id}`);
                    }}
                  >
                    Rekonsiliasi bank →
                  </Button>
                  {(bankStatus.data?.find((b) => b.id === a.id)?.unmatched ?? 0) > 0 && <Tag color="orange">{bankStatus.data?.find((b) => b.id === a.id)?.unmatched} mutasi belum cocok</Tag>}
                  {bankStatus.data?.find((b) => b.id === a.id)?.stale && <Tag>mutasi belum diimpor</Tag>}
                </div>
              )}
              {/kecil/i.test(a.name) && (
                <div style={{ marginTop: 4 }}>
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate('/petty-cash');
                    }}
                  >
                    Kelola kas kecil (dana tetap) →
                  </Button>
                </div>
              )}
            </Card>
          </Col>
        ))}
      </Row>

      {!!controls.data?.items.length && (
        <Card size="small" title="Kontrol kas & bank (60 hari terakhir)" style={{ marginBottom: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            {controls.data.items.map((c) => (
              <Alert
                key={c.key}
                type={c.level}
                showIcon
                message={c.title}
                description={c.detail}
                action={
                  c.key === 'NO_EVIDENCE' ? (
                    <Button size="small" onClick={() => setNoProofOnly(true)}>
                      Tampilkan yang kurang bukti
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </Space>
        </Card>
      )}

      <Card title="Transaksi kas & bank">
        <Space wrap style={{ marginBottom: 12 }}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span>s/d</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Segmented
            value={typeFilter}
            onChange={(v) => setTypeFilter(v as 'ALL' | CashTxType)}
            options={[{ value: 'ALL', label: 'Semua' }, { value: 'IN', label: 'Masuk' }, { value: 'OUT', label: 'Keluar' }, { value: 'TRANSFER', label: 'Transfer' }]}
          />
          <Input.Search allowClear placeholder="Cari nomor / keterangan / bukti" style={{ width: 250 }} onChange={(e) => setSearch(e.target.value)} />
          {!!branchOpts.length && (
            <Select
              allowClear
              placeholder="Semua cabang"
              style={{ width: 200 }}
              value={branchFilter}
              onChange={setBranchFilter}
              options={[...branchOpts.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` })), { value: 'NONE', label: 'Pusat / tanpa cabang' }]}
            />
          )}
          <Checkbox checked={noProofOnly} onChange={(e) => setNoProofOnly(e.target.checked)}>
            Hanya yang belum ada bukti
          </Checkbox>
          <ExportButtons filename={`kas-bank-${from}-${to}`} title={`Transaksi kas & bank ${from} s/d ${to}`} sheets={() => (txs.data ? cashListSheet(shown, { from, to }, me?.tenantName) : null)} print={false} />
        </Space>
        <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
          <Col xs={24} md={8}>
            <Statistic title="Uang masuk" value={fmtMoney(flow.inn)} valueStyle={{ color: '#389e0d', fontSize: 20 }} />
          </Col>
          <Col xs={24} md={8}>
            <Statistic title="Uang keluar" value={fmtMoney(flow.out)} valueStyle={{ color: '#cf1322', fontSize: 20 }} />
          </Col>
          <Col xs={24} md={8}>
            <Statistic
              title={flow.net > 0 ? 'Kas bertambah' : flow.net < 0 ? 'Kas berkurang' : 'Perubahan kas'}
              value={flow.net === 0 ? 'Tidak ada perubahan' : fmtMoney(Math.abs(flow.net))}
              valueStyle={{ fontSize: 20, color: flow.net > 0 ? '#389e0d' : flow.net < 0 ? '#cf1322' : undefined }}
              suffix={flow.missing ? <Tag color="orange">{flow.missing} belum ada bukti</Tag> : undefined}
            />
          </Col>
        </Row>
        <Typography.Paragraph type="secondary">
          Penerimaan dari pelanggan & pembayaran ke supplier dicatat di menu Faktur. Di sini untuk biaya operasional, setoran modal, pinjaman, dan transfer. Pembelian ke akun aset tetap otomatis menjadi kartu aset.
        </Typography.Paragraph>
        <Table
          rowKey="id"
          loading={txs.isLoading}
          dataSource={shown}
          scroll={{ x: 1000 }}
          expandable={{
            rowExpandable: (t) => t.lines.length > 0 || !!t.journalNumber,
            expandedRowRender: (t) => (
              <>
                <Space wrap style={{ marginBottom: 8 }}>
                  {t.journalNumber && <Tag>Jurnal {t.journalNumber}</Tag>}
                  {t.branchName && <Tag color="purple">Cabang {t.branchName}</Tag>}
                  {t.assets?.map((a) => (
                    <Tag key={a.id} color="geekblue" style={{ cursor: 'pointer' }} onClick={() => navigate('/fixed-assets')}>
                      Aset tetap {a.code} · {a.name}
                    </Tag>
                  ))}
                </Space>
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={t.lines}
                columns={[
                  { title: 'Akun lawan', render: (_, l) => `${l.account.code} · ${l.account.name}` },
                  { title: 'Keterangan', dataIndex: 'memo' },
                  { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: fmtMoney },
                ]}
              />
              </>
            ),
          }}
          columns={[
            { title: 'Nomor', dataIndex: 'number' },
            { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
            { title: 'Jenis', dataIndex: 'type', render: (t: CashTxType) => <Tag color={TYPE_COLOR[t]}>{CASH_TX_TYPE_LABELS[t]}</Tag> },
            {
              title: 'Kas / bank',
              render: (_, t) => (t.toCashAccount ? `${t.cashAccount.name} → ${t.toCashAccount.name}` : t.cashAccount.name),
            },
            {
              title: 'Keterangan',
              dataIndex: 'description',
              render: (d: string, t: CashTransaction) => (
                <span>
                  {d}
                  {t.assets?.length ? (
                    <Tag color="geekblue" style={{ marginLeft: 6, cursor: 'pointer' }} onClick={() => navigate('/fixed-assets')}>
                      → Aset tetap {t.assets.map((a) => a.code).join(', ')}
                    </Tag>
                  ) : null}
                </span>
              ),
            },
            ...(branchOpts.length ? [{ title: 'Cabang', dataIndex: 'branchName', render: (b: string | null | undefined) => b ?? <Typography.Text type="secondary">Pusat</Typography.Text> }] : []),
            {
              title: 'Referensi',
              dataIndex: 'reference',
              render: (r: string | undefined, t: CashTransaction) =>
                r || t.status === 'VOID' || t.type === 'IN' || !canEvidence ? (
                  r
                ) : (
                  <Button
                    size="small"
                    type="link"
                    style={{ padding: 0 }}
                    onClick={() => {
                      proofForm.resetFields();
                      setProofing(t);
                    }}
                  >
                    Lengkapi bukti
                  </Button>
                ),
            },
            {
              title: 'Status',
              render: (_, t) =>
                t.status === 'VOID' ? (
                  <Tag color="default" title={t.voidReason ?? undefined}>
                    Dibatalkan
                  </Tag>
                ) : (
                  <Tag color="green">Diposting</Tag>
                ),
            },
            {
              title: 'Jumlah',
              dataIndex: 'amount',
              align: 'right',
              render: (v, t) => (
                <Typography.Text type={t.type === 'OUT' ? 'danger' : t.type === 'IN' ? 'success' : undefined}>
                  {fmtMoney(v)}
                </Typography.Text>
              ),
            },
            ...(canVoid
              ? [
                  {
                    title: '',
                    render: (_: unknown, t: CashTransaction) =>
                      t.status === 'VOID' ? null : (
                        <Button
                          size="small"
                          danger
                          type="text"
                          onClick={() => {
                            voidForm.resetFields();
                            setVoiding(t);
                          }}
                        >
                          Batalkan
                        </Button>
                      ),
                  },
                ]
              : []),
          ]}
        />
      </Card>

      <Modal title={`Nomor bukti ${proofing?.number ?? ''}`} open={!!proofing} onCancel={() => setProofing(null)} onOk={() => proofForm.submit()} confirmLoading={doProof.isPending} okText="Simpan">
        <Typography.Paragraph type="secondary">Isi nomor kuitansi / nota / bukti transfer. Hanya bisa diisi sekali dan tidak mengubah jurnal.</Typography.Paragraph>
        <Form form={proofForm} layout="vertical" onFinish={(v) => proofing && doProof.mutate({ id: proofing.id, reference: v.reference })}>
          <Form.Item name="reference" label="No. bukti" rules={[{ required: true, min: 2, message: 'Isi nomor bukti' }]}>
            <Input maxLength={100} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`Batalkan ${voiding?.number ?? ''}`} open={!!voiding} onCancel={() => setVoiding(null)} onOk={() => voidForm.submit()} confirmLoading={doVoid.isPending} okText="Batalkan transaksi" okButtonProps={{ danger: true }}>
        <Typography.Paragraph type="secondary">
          Transaksi tidak dihapus: SANSU membuat jurnal pembalik dan mencatat alasan serta pelakunya di jejak audit. Tidak bisa dibatalkan bila sudah dicocokkan dengan mutasi bank atau sudah menjadi aset tetap.
        </Typography.Paragraph>
        <Form form={voidForm} layout="vertical" onFinish={(v) => voiding && doVoid.mutate({ id: voiding.id, reason: v.reason })}>
          <Form.Item name="reason" label="Alasan pembatalan" rules={[{ required: true, min: 5, message: 'Isi alasan (min. 5 karakter)' }]}>
            <Input.TextArea rows={3} maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={mode && TITLE[mode]}
        open={!!mode}
        width={mode === 'TRANSFER' ? 520 : 760}
        onCancel={() => setMode(null)}
        onOk={() => form.submit()}
        okText="Posting"
        confirmLoading={create.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Row gutter={16}>
            <Col xs={24} md={mode === 'TRANSFER' ? 24 : 14}>
              <Form.Item
                name="cashAccountId"
                label={mode === 'IN' ? 'Masuk ke' : mode === 'OUT' ? 'Keluar dari' : 'Dari'}
                rules={[{ required: true }]}
              >
                <CashAccountSelect />
              </Form.Item>
            </Col>
            {mode === 'TRANSFER' && (
              <>
                <Col xs={24}>
                  <Form.Item name="toCashAccountId" label="Ke" rules={[{ required: true }]}>
                    <CashAccountSelect />
                  </Form.Item>
                </Col>
                <Col xs={24} md={14}>
                  <Form.Item name="amount" label="Jumlah" rules={[{ required: true }]}>
                    <InputNumber min={1} style={{ width: '100%' }} prefix="Rp" />
                  </Form.Item>
                </Col>
              </>
            )}
            <Col xs={24} md={10}>
              <Form.Item name="date" label="Tanggal" rules={[{ required: true }]}>
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col xs={24} md={14}>
              <Form.Item name="description" label="Keterangan" rules={[{ required: true }]}>
                <Input placeholder={mode === 'OUT' ? 'Bayar listrik gudang Oktober' : mode === 'IN' ? 'Setoran modal pemilik' : 'Setor kas ke bank'} />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Form.Item name="reference" label="No. bukti / referensi">
                <Input />
              </Form.Item>
            </Col>
          </Row>

          {(mode === 'IN' || mode === 'OUT') && !!branches.data?.branches.filter((b) => b.isActive).length && (
            <Form.Item name="branchId" label="Cabang" extra="Kosong = pusat. Biaya/pendapatan ini masuk laporan laba rugi cabang yang dipilih.">
              <Select allowClear placeholder="Pusat / semua" options={branches.data.branches.filter((b) => b.isActive).map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} />
            </Form.Item>
          )}

          {(mode === 'IN' || mode === 'OUT') && (
            <Form.List name="lines">
              {(fields, { add, remove }) => (
                <>
                  <Typography.Text strong>{mode === 'OUT' ? 'Dibebankan ke akun' : 'Sumber dana (akun lawan)'}</Typography.Text>
                  {fields.map((f) => (
                    <Row gutter={8} key={f.key} style={{ marginTop: 8 }}>
                      <Col xs={24} md={withProject ? 8 : 11}>
                        <Form.Item name={[f.name, 'accountId']} rules={[{ required: true, message: 'Pilih akun' }]} noStyle>
                          <Select
                            showSearch
                            optionFilterProp="label"
                            style={{ width: '100%' }}
                            placeholder="Pilih akun"
                            loading={counter.isLoading}
                            options={counter.data?.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={withProject ? 5 : 6}>
                        <Form.Item name={[f.name, 'amount']} rules={[{ required: true, message: 'Isi jumlah' }]} noStyle>
                          <InputNumber min={1} style={{ width: '100%' }} placeholder="Jumlah" />
                        </Form.Item>
                      </Col>
                      <Col xs={10} md={withProject ? 5 : 6}>
                        <Form.Item name={[f.name, 'memo']} noStyle>
                          <Input placeholder="Catatan" />
                        </Form.Item>
                      </Col>
                      {withProject && (
                        <Col xs={22} md={5}>
                          <Form.Item name={[f.name, 'projectId']} noStyle>
                            <Select
                              allowClear
                              style={{ width: '100%' }}
                              placeholder="Proyek (opsional)"
                              options={activeProjects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
                            />
                          </Form.Item>
                        </Col>
                      )}
                      {mode === 'OUT' && lines[f.name]?.accountId && assetCatsByAccount.has(lines[f.name]!.accountId!) && (
                        <Col span={24}>
                          <Alert
                            type="info"
                            showIcon
                            style={{ marginTop: 6 }}
                            message="Akun aset tetap: transaksi ini otomatis masuk ke daftar Aset Tetap"
                            description={
                              <Row gutter={8} style={{ marginTop: 6 }}>
                                {(assetCatsByAccount.get(lines[f.name]!.accountId!)?.length ?? 0) > 1 && (
                                  <Col xs={24} md={6}>
                                    <Form.Item name={[f.name, 'assetCategoryId']} rules={[{ required: true, message: 'Pilih kategori aset' }]} noStyle>
                                      <Select placeholder="Kategori aset" options={assetCatsByAccount.get(lines[f.name]!.accountId!)!.map((c) => ({ value: c.id, label: c.name }))} />
                                    </Form.Item>
                                  </Col>
                                )}
                                <Col xs={24} md={8}>
                                  <Form.Item name={[f.name, 'assetName']} noStyle>
                                    <Input placeholder="Nama aset (kosong = catatan)" maxLength={160} />
                                  </Form.Item>
                                </Col>
                                <Col xs={12} md={5}>
                                  <Form.Item name={[f.name, 'assetUsefulLifeMonths']} noStyle>
                                    <InputNumber min={0} max={600} style={{ width: '100%' }} placeholder="Masa manfaat (bln)" />
                                  </Form.Item>
                                </Col>
                                <Col xs={12} md={5}>
                                  <Form.Item name={[f.name, 'assetLocation']} noStyle>
                                    <Input placeholder="Lokasi" maxLength={120} />
                                  </Form.Item>
                                </Col>
                              </Row>
                            }
                          />
                        </Col>
                      )}
                      <Col xs={2} md={1}>
                        {fields.length > 1 && <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(f.name)} />}
                      </Col>
                    </Row>
                  ))}
                  <Button type="dashed" block icon={<PlusOutlined />} style={{ marginTop: 8 }} onClick={() => add({})}>
                    Tambah akun
                  </Button>
                  <div style={{ textAlign: 'right', marginTop: 12 }}>
                    Total: <strong>{fmtMoney(linesTotal)}</strong>
                  </div>
                </>
              )}
            </Form.List>
          )}
        </Form>
      </Modal>
    </>
  );
}
