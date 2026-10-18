import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, FilterOutlined, PlusOutlined, SwapOutlined } from '@ant-design/icons';
import { BRAND, CASH_TX_TYPE_LABELS, canHandleMoney, type CashTxType } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, App, Badge, Button, Card, Checkbox, Col, Collapse, Empty, Form, Input, InputNumber, Modal, Popover, Row, Segmented, Select, Space, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, put, qs } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { LEDGER_KEYS, useBranches, useAction, useCashAccounts } from '@/api/queries';
import { withBudgetOverride } from '@/lib/budgetOverride';
import type { CashTransaction, Project } from '@/api/types';
import { useApps } from '@/lib/apps';
import CashAccountSelect from '@/components/CashAccountSelect';
import PageHeader from '@/layout/PageHeader';
import ExportButtons from '@/components/ExportButtons';
import ResponsiveTable from '@/components/ResponsiveTable';
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

  const [periodPreset, setPeriodPreset] = useState<string>('month');
  const [detail, setDetail] = useState<CashTransaction | null>(null);
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
  const canEvidence = canHandleMoney(me?.role);
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

  const cfg = useQuery({ queryKey: ['cash', 'settings'], queryFn: () => get<{ evidenceFrom: number; blockNegative: boolean; maxCashBalance: number }>('/cash/settings'), retry: false, enabled: !!me && ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'].includes(me.role) });
  const [hideTip, setHideTip] = useState(() => {
    try {
      return localStorage.getItem('sansu.cashControlTip') === '1';
    } catch {
      return false;
    }
  });
  const applyControls = useAction(() => put('/cash/settings', { evidenceFrom: 1_000_000, blockNegative: true }), { success: 'Kontrol kas diaktifkan', invalidate: ['cash'] });
  const controlsOff = !!cfg.data && cfg.data.evidenceFrom === 0 && !cfg.data.blockNegative;
  return (
    <>
      {controlsOff && !hideTip && (
        <Alert
          type="warning"
          showIcon
          closable
          onClose={() => {
            setHideTip(true);
            try {
              localStorage.setItem('sansu.cashControlTip', '1');
            } catch {
              /* penyimpanan browser tidak tersedia */
            }
          }}
          style={{ marginBottom: 12 }}
          message="Kontrol uang keluar belum aktif"
          description={
            <span>
              Saat ini uang keluar berapa pun tanpa nomor bukti dan saldo kas boleh minus. Rekomendasi: wajib nomor bukti mulai Rp1.000.000 dan blokir saldo negatif.{' '}
              {me && ['OWNER', 'ADMIN'].includes(me.role) ? (
                <Button size="small" type="primary" loading={applyControls.isPending} onClick={() => applyControls.mutate(undefined)}>
                  Terapkan rekomendasi
                </Button>
              ) : (
                <span>Minta Pemilik atau Admin mengaktifkannya (Pengaturan › Perusahaan).</span>
              )}
            </span>
          }
        />
      )}
      <PageHeader
        title="Uang masuk & keluar"
        extra={
          canEvidence && (
          <Space wrap>
            <Button type="primary" icon={<ArrowDownOutlined />} onClick={() => openForm('IN')} style={{ background: '#16A37B' }}>
              Uang masuk
            </Button>
            <Button type="primary" danger icon={<ArrowUpOutlined />} onClick={() => openForm('OUT')}>
              Uang keluar
            </Button>
            <Button icon={<SwapOutlined />} onClick={() => openForm('TRANSFER')}>
              Pindah antar rekening
            </Button>
          </Space>
          )
        }
      />

      {/* Saldo: klik satu rekening untuk melihat transaksinya saja */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} xl={8}>
          <Card loading={accounts.isLoading} hoverable onClick={() => setFilter(undefined)} style={{ height: '100%', borderColor: !filter ? BRAND.colors.primary : undefined }}>
            <Typography.Text type="secondary">Total uang kas & bank</Typography.Text>
            <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.3 }}>{fmtMoney(total)}</div>
            <Typography.Text type="secondary">{!filter ? 'Menampilkan transaksi semua rekening' : 'Klik untuk lihat semua rekening'}</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} xl={16}>
          <Row gutter={[12, 12]}>
            {accounts.data?.map((a) => {
              const st = bankStatus.data?.find((b) => b.id === a.id);
              const isBank = /bank/i.test(a.name);
              const isPetty = /kecil/i.test(a.name);
              return (
                <Col xs={24} sm={12} lg={8} key={a.id}>
                  <Card size="small" hoverable onClick={() => setFilter(a.id)} style={{ height: '100%', borderColor: filter === a.id ? BRAND.colors.primary : undefined }}>
                    <Typography.Text type="secondary">{a.name}</Typography.Text>
                    <div style={{ fontSize: 20, fontWeight: 600 }}>{fmtMoney(a.balance)}</div>
                    <Space size={[8, 4]} wrap style={{ marginTop: 4 }}>
                      <Typography.Link
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/ledger?accountId=${a.id}`);
                        }}
                      >
                        Buku besar
                      </Typography.Link>
                      {isBank && (
                        <Typography.Link
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/bank?account=${a.id}`);
                          }}
                        >
                          Cocokkan dengan bank
                        </Typography.Link>
                      )}
                      {isPetty && (
                        <Typography.Link
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate('/petty-cash');
                          }}
                        >
                          Kelola kas kecil
                        </Typography.Link>
                      )}
                    </Space>
                    {isBank && ((st?.unmatched ?? 0) > 0 || st?.stale) && (
                      <div style={{ marginTop: 6 }}>
                        {(st?.unmatched ?? 0) > 0 && <Tag color="orange">{st?.unmatched} mutasi belum cocok</Tag>}
                        {st?.stale && <Tag>mutasi bank belum diimpor</Tag>}
                      </div>
                    )}
                  </Card>
                </Col>
              );
            })}
          </Row>
        </Col>
      </Row>

      {/* Hal yang perlu diperhatikan: ringkas, bisa dibuka */}
      {!!controls.data?.items.length && (
        <Collapse
          style={{ marginBottom: 16 }}
          items={[
            {
              key: 'c',
              label: (
                <Space>
                  <Badge status={controls.data.items.some((c) => c.level === 'error') ? 'error' : 'warning'} />
                  <span>Perlu diperhatikan ({controls.data.items.length})</span>
                  <Typography.Text type="secondary">kas & bank 60 hari terakhir</Typography.Text>
                </Space>
              ),
              children: (
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
              ),
            },
          ]}
        />
      )}

      <Card
        title={
          <Space wrap>
            <span>Riwayat uang masuk & keluar</span>
            {filter && <Tag closable onClose={() => setFilter(undefined)} color="blue">{accounts.data?.find((a) => a.id === filter)?.name}</Tag>}
          </Space>
        }
      >
        {/* Filter: periode cepat, jenis, cari; sisanya di "Filter lain" */}
        <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
          <Segmented
            value={periodPreset}
            onChange={(v) => {
              const p = v as string;
              setPeriodPreset(p);
              if (p === 'month') { setFrom(dayjs().startOf('month').format('YYYY-MM-DD')); setTo(today()); }
              if (p === 'last') { setFrom(dayjs().subtract(1, 'month').startOf('month').format('YYYY-MM-DD')); setTo(dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD')); }
              if (p === '30') { setFrom(dayjs().subtract(30, 'day').format('YYYY-MM-DD')); setTo(today()); }
            }}
            options={[{ value: 'month', label: 'Bulan ini' }, { value: 'last', label: 'Bulan lalu' }, { value: '30', label: '30 hari' }, { value: 'custom', label: 'Pilih tanggal' }]}
          />
          {periodPreset === 'custom' && (
            <>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
              <span>s/d</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
            </>
          )}
          <Segmented
            value={typeFilter}
            onChange={(v) => setTypeFilter(v as 'ALL' | CashTxType)}
            options={[{ value: 'ALL', label: 'Semua' }, { value: 'IN', label: 'Masuk' }, { value: 'OUT', label: 'Keluar' }, { value: 'TRANSFER', label: 'Pindah' }]}
          />
          <Input.Search allowClear placeholder="Cari keterangan atau nomor bukti" style={{ width: 240 }} onChange={(e) => setSearch(e.target.value)} />
          <Popover
            trigger="click"
            placement="bottomLeft"
            content={
              <Space direction="vertical" style={{ minWidth: 220 }}>
                {!!branchOpts.length && (
                  <Select
                    allowClear
                    placeholder="Semua cabang"
                    style={{ width: '100%' }}
                    value={branchFilter}
                    onChange={setBranchFilter}
                    options={[...branchOpts.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` })), { value: 'NONE', label: 'Pusat / tanpa cabang' }]}
                  />
                )}
                <Checkbox checked={noProofOnly} onChange={(e) => setNoProofOnly(e.target.checked)}>
                  Hanya yang belum ada bukti
                </Checkbox>
              </Space>
            }
          >
            <Badge dot={!!branchFilter || noProofOnly}>
              <Button icon={<FilterOutlined />}>Filter lain</Button>
            </Badge>
          </Popover>
          <ExportButtons filename={`kas-bank-${from}-${to}`} title={`Transaksi kas & bank ${from} s/d ${to}`} sheets={() => (txs.data ? cashListSheet(shown, { from, to }, me?.tenantName) : null)} print={false} />
        </Space>

        <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
          <Col xs={24} md={8}>
            <Card size="small" style={{ background: '#F1FAF6', borderColor: '#CBEBDD' }}>
              <Typography.Text type="secondary">Uang masuk</Typography.Text>
              <div style={{ fontSize: 20, fontWeight: 600, color: '#0E7A5C' }}>{fmtMoney(flow.inn)}</div>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small" style={{ background: '#FEF3F2', borderColor: '#FAD4D0' }}>
              <Typography.Text type="secondary">Uang keluar</Typography.Text>
              <div style={{ fontSize: 20, fontWeight: 600, color: '#B42318' }}>{fmtMoney(flow.out)}</div>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small">
              <Typography.Text type="secondary">{flow.net > 0 ? 'Kas bertambah' : flow.net < 0 ? 'Kas berkurang' : 'Perubahan kas'}</Typography.Text>
              <div style={{ fontSize: 20, fontWeight: 600, color: flow.net > 0 ? '#0E7A5C' : flow.net < 0 ? '#B42318' : undefined }}>
                {flow.net === 0 ? 'Tidak ada perubahan' : fmtMoney(Math.abs(flow.net))}
              </div>
              {flow.missing > 0 && <Tag color="orange" style={{ marginTop: 4 }}>{flow.missing} belum ada bukti</Tag>}
            </Card>
          </Col>
        </Row>

        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          Penerimaan dari pelanggan dan pembayaran ke supplier dicatat di menu Faktur. Di sini untuk biaya operasional, setoran modal, pinjaman, dan pindah antar rekening.
        </Typography.Paragraph>

        <ResponsiveTable
          rowKey="id"
          loading={txs.isLoading}
          dataSource={shown}
          scroll={{ x: 760 }}
          locale={{
            emptyText: (
              <Empty description="Belum ada transaksi pada periode dan filter ini">
                {canEvidence && (
                  <Space>
                    <Button type="primary" onClick={() => openForm('OUT')}>Catat uang keluar</Button>
                    <Button onClick={() => openForm('IN')}>Catat uang masuk</Button>
                  </Space>
                )}
              </Empty>
            ),
          }}
          columns={[
            {
              title: 'Tanggal',
              dataIndex: 'date',
              width: 150,
              render: (d: string, t: CashTransaction) => (
                <div>
                  <div>{fmtDate(d)}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{t.number}</Typography.Text>
                </div>
              ),
            },
            {
              title: 'Keterangan',
              dataIndex: 'description',
              render: (d: string, t: CashTransaction) => (
                <div>
                  <Space size={6} wrap>
                    <Tag color={TYPE_COLOR[t.type]} style={{ marginInlineEnd: 0 }}>{CASH_TX_TYPE_LABELS[t.type]}</Tag>
                    <span>{d}</span>
                    {t.status === 'VOID' && <Tag title={t.voidReason ?? undefined}>Dibatalkan</Tag>}
                    {t.assets?.length ? (
                      <Tag color="geekblue" style={{ cursor: 'pointer' }} onClick={() => navigate('/fixed-assets')}>
                        → Aset tetap {t.assets.map((a) => a.code).join(', ')}
                      </Tag>
                    ) : null}
                  </Space>
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t.toCashAccount ? `${t.cashAccount.name} → ${t.toCashAccount.name}` : t.cashAccount.name}
                      {t.branchName ? ` · Cabang ${t.branchName}` : ''}
                    </Typography.Text>
                  </div>
                </div>
              ),
            },
            {
              title: 'Bukti',
              dataIndex: 'reference',
              width: 130,
              render: (r: string | undefined, t: CashTransaction) =>
                r ? (
                  <Typography.Text type="secondary">{r}</Typography.Text>
                ) : t.status === 'VOID' || t.type === 'IN' || !canEvidence ? (
                  '-'
                ) : (
                  <Button size="small" type="link" style={{ padding: 0 }} onClick={() => { proofForm.resetFields(); setProofing(t); }}>
                    Lengkapi bukti
                  </Button>
                ),
            },
            {
              title: 'Jumlah',
              dataIndex: 'amount',
              align: 'right',
              width: 150,
              render: (v: string, t: CashTransaction) => (
                <Typography.Text strong delete={t.status === 'VOID'} type={t.status === 'VOID' ? 'secondary' : t.type === 'OUT' ? 'danger' : t.type === 'IN' ? 'success' : undefined}>
                  {fmtMoney(v)}
                </Typography.Text>
              ),
            },
            {
              title: '',
              width: 150,
              render: (_: unknown, t: CashTransaction) => (
                <Space size={0} wrap>
                  {(t.lines.length > 0 || !!t.journalNumber) && (
                    <Button size="small" type="link" onClick={() => setDetail(t)}>
                      Rincian
                    </Button>
                  )}
                  {canVoid && t.status !== 'VOID' && (
                    <Button size="small" danger type="text" onClick={() => { voidForm.resetFields(); setVoiding(t); }}>
                      Batalkan
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal title={`Rincian ${detail?.number ?? ''}`} open={!!detail} onCancel={() => setDetail(null)} footer={<Button onClick={() => setDetail(null)}>Tutup</Button>} width={640}>
        {detail && (
          <>
            <Space wrap style={{ marginBottom: 8 }}>
              {detail.journalNumber && <Tag>Jurnal {detail.journalNumber}</Tag>}
              {detail.branchName && <Tag color="purple">Cabang {detail.branchName}</Tag>}
            </Space>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail.lines}
              columns={[
                { title: 'Untuk', render: (_, l) => `${l.account.name}` },
                { title: 'Keterangan', dataIndex: 'memo' },
                { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: fmtMoney },
              ]}
            />
          </>
        )}
      </Modal>

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
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Ini hanya mengoreksi pembukuan, bukan mengembalikan uang"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>Salah catat dan uang belum keluar: batalkan, lalu catat ulang dengan benar.</li>
              <li>Uang sudah benar-benar keluar atau salah tujuan: jangan dibatalkan. Minta uang dikembalikan, lalu catat sebagai Uang masuk.</li>
              <li>Membatalkan transaksi yang uangnya sudah keluar membuat saldo di SANSU lebih besar dari saldo bank asli.</li>
            </ul>
          }
        />
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
