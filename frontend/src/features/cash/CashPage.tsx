import { ArrowDownOutlined, ArrowUpOutlined, FilterOutlined, SwapOutlined } from '@ant-design/icons';
import { BRAND, CASH_TX_TYPE_LABELS, canHandleMoney, type CashTxType } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Checkbox, Col, Collapse, Empty, Form, Input, Popover, Row, Segmented, Select, Space, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, put, qs } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { useBranches, useAction, useCashAccounts } from '@/api/queries';
import type { CashTransaction, Project } from '@/api/types';
import { useApps } from '@/lib/apps';
import PageHeader from '@/layout/PageHeader';
import CashTabs from './CashTabs';
import ExportButtons from '@/components/ExportButtons';
import ResponsiveTable from '@/components/ResponsiveTable';
import { fmtCurrency, fmtDate, fmtMoney, today } from '@/lib/format';
import { cashListSheet } from '@/lib/xlsx/reports';
import CashDetailModal from './CashDetailModal';
import CashEntryModal from './CashEntryModal';
import CashProofModal from './CashProofModal';
import CashVoidModal from './CashVoidModal';
import { cashFlow, filterCashTx, type AssetCatsByAccount, type CashFormValues } from './cashLogic';
import IncomeSources from './IncomeSources';

const TYPE_COLOR: Record<CashTxType, string> = { IN: 'green', OUT: 'red', TRANSFER: 'blue' };


export default function CashPage() {
  const navigate = useNavigate();
  const accounts = useCashAccounts();
  const [filter, setFilter] = useState<string>();
  const [from, setFrom] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [to, setTo] = useState(today());
  const [mode, setMode] = useState<CashTxType | null>(null);
  const [form] = Form.useForm<CashFormValues>();
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
  const assetCats = useQuery({ queryKey: ['assets', 'categories'], queryFn: () => get<{ id: string; name: string; assetAccountId: string; method: string }[]>('/assets/categories') });
  const assetCatsByAccount = useMemo(() => {
    const m: AssetCatsByAccount = new Map();
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
  const shown = useMemo(() => filterCashTx(txs.data ?? [], { typeFilter, branchFilter, noProofOnly, search }), [txs.data, typeFilter, branchFilter, noProofOnly, search]);
  const flow = useMemo(() => cashFlow(shown), [shown]);
  const canVoid = me?.role === 'OWNER' || me?.role === 'ADMIN';
  const [voiding, setVoiding] = useState<CashTransaction | null>(null);
  const canEvidence = canHandleMoney(me?.role);
  const [proofing, setProofing] = useState<CashTransaction | null>(null);


  const openForm = (m: CashTxType) => {
    form.resetFields();
    const cash = accounts.data?.find((a) => a.code.startsWith('1-11')) ?? accounts.data?.[0];
    form.setFieldsValue({ date: today(), cashAccountId: filter ?? cash?.id, lines: [{}] });
    setMode(m);
  };

  const total = (accounts.data ?? []).reduce((a, x) => a + Number(x.balance), 0);

  const cfg = useQuery({ queryKey: ['cash', 'settings'], queryFn: () => get<{ evidenceFrom: number; blockNegative: boolean; maxCashBalance: number }>('/cash/settings'), retry: false, enabled: !!me && ['OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT'].includes(me.role) });
  const [hideTip, setHideTip] = useState(() => {
    try {
      return localStorage.getItem('sansu.cashControlTip') === '1';
    } catch {
      return false;
    }
  });
  const applyControls = useAction(() => put('/cash/settings', { evidenceFrom: 1_000_000, blockNegative: true }), { success: 'Kontrol kas diaktifkan', invalidate: ['cash'] });
  const controlsOff = !!cfg.data && cfg.data.evidenceFrom === 0;
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
              Saat ini uang keluar berapa pun boleh tanpa nomor bukti. Rekomendasi: wajib nomor bukti mulai Rp1.000.000 (saldo kas tidak boleh minus sudah aktif).{' '}
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
      <CashTabs />

      <IncomeSources />

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
                          void navigate(`/ledger?accountId=${a.id}`);
                        }}
                      >
                        Buku besar
                      </Typography.Link>
                      {isBank && (
                        <Typography.Link
                          onClick={(e) => {
                            e.stopPropagation();
                            void navigate(`/bank?account=${a.id}`);
                          }}
                        >
                          Cocokkan dengan bank
                        </Typography.Link>
                      )}
                      {isPetty && (
                        <Typography.Link
                          onClick={(e) => {
                            e.stopPropagation();
                            void navigate('/petty-cash');
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
                  <Button size="small" type="link" style={{ padding: 0 }} onClick={() => setProofing(t)}>
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
                  {t.currency && t.amountForeign && <div style={{ fontSize: 12, fontWeight: 400 }}>{fmtCurrency(t.amountForeign, t.currency)}</div>}
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
                    <Button size="small" danger type="text" onClick={() => setVoiding(t)}>
                      Batalkan
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <CashDetailModal detail={detail} onClose={() => setDetail(null)} />
      <CashProofModal target={proofing} onClose={() => setProofing(null)} />
      <CashVoidModal target={voiding} onClose={() => setVoiding(null)} />
      <CashEntryModal mode={mode} form={form} onClose={() => setMode(null)} assetCatsByAccount={assetCatsByAccount} activeProjects={activeProjects} />
    </>
  );
}
