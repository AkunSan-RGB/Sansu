import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  PlusOutlined,
  PrinterOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import {
  BRAND,
  CASH_COUNT_STATUS_LABELS,
  CASH_DENOMINATIONS,
  type CashCount,
  type CashCountItem,
  type CashCountSettings,
  type CashCountStatus,
  canHandleMoney,
} from '@sansu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, post, put, qs } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import DenominationCounter, { denomTotal, type Denoms } from '@/components/DenominationCounter';
import ExportButtons from '@/components/ExportButtons';
import QueryState from '@/components/QueryState';
import { cell, DocHeader, head, PrintSheet, Signatures } from '@/components/print/Letterhead';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import { printDoc } from '@/lib/print';
import { cashCountSheet } from '@/lib/xlsx/reports';

interface KasAccount {
  id: string;
  code: string;
  name: string;
  balance: string;
  lastCount: string | null;
}
const STATUS_COLOR: Record<CashCountStatus, string> = {
  DRAFT: 'blue',
  WAITING_APPROVAL: 'gold',
  POSTED: 'green',
  CANCELLED: 'default',
};
const KEYS = ['cash-counts', 'cash-accounts', 'cash-tx', ...LEDGER_KEYS];
const diffText = (v: number) => (v === 0 ? 'Cocok' : v < 0 ? `Kurang ${fmtMoney(-v)}` : `Lebih ${fmtMoney(v)}`);
const diffColor = (v: number) => (v === 0 ? BRAND.colors.accent : '#dc2626');

/** Opname kas: hitung fisik uang per pecahan dan cocokkan dengan saldo buku */
export default function CashCountsPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [accountId, setAccountId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const detailId = params.get('id');
  const kas = useQuery({
    queryKey: ['cash-counts', 'accounts'],
    queryFn: () => get<KasAccount[]>('/cash/counts/accounts'),
  });
  const list = useQuery({
    queryKey: ['cash-counts', 'list', accountId],
    queryFn: () => get<CashCount[]>(`/cash/counts${qs({ accountId })}`),
  });
  const waiting = (list.data ?? []).filter((c) => c.status === 'WAITING_APPROVAL');

  return (
    <>
      <PageHeader
        title="Opname kas"
        extra={
          <Space wrap>
            {me?.role === 'OWNER' && (
              <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)} aria-label="Pengaturan opname" />
            )}
            {canHandleMoney(me?.role) && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
                Opname baru
              </Button>
            )}
          </Space>
        }
      />
      {me?.role === 'OWNER' && waiting.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`${waiting.length} opname menunggu persetujuan Anda`}
          action={
            <Button size="small" type="primary" onClick={() => setParams({ id: waiting[0].id })}>
              Periksa
            </Button>
          }
        />
      )}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {(kas.data ?? []).map((a) => {
          const stale = !a.lastCount || Date.now() - Date.parse(a.lastCount) > 35 * 86_400_000;
          return (
            <Col key={a.id} xs={24} sm={12} lg={8}>
              <Card
                size="small"
                hoverable
                onClick={() => setAccountId(accountId === a.id ? undefined : a.id)}
                style={{ borderColor: accountId === a.id ? BRAND.colors.primary : undefined }}
              >
                <Statistic title={`${a.code} · ${a.name}`} value={fmtMoney(a.balance)} valueStyle={{ fontSize: 20 }} />
                <Typography.Text type={stale ? 'warning' : 'secondary'} style={{ fontSize: 12 }}>
                  {a.lastCount ? `Opname terakhir ${fmtDate(a.lastCount)}` : 'Belum pernah diopname'}
                  {stale && ' · sudah waktunya opname'}
                </Typography.Text>
              </Card>
            </Col>
          );
        })}
      </Row>
      <Card>
        <Table
          rowKey="id"
          loading={list.isLoading}
          dataSource={list.data}
          scroll={{ x: 820 }}
          onRow={(r) => ({ onClick: () => setParams({ id: r.id }), style: { cursor: 'pointer' } })}
          locale={{ emptyText: 'Belum ada opname kas. Klik "Opname baru" untuk mulai menghitung uang.' }}
          columns={[
            { title: 'Nomor', dataIndex: 'number' },
            { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
            { title: 'Kas', render: (_, c) => `${c.account.code} · ${c.account.name}` },
            { title: 'Saldo buku', dataIndex: 'bookBalance', align: 'right', render: fmtMoney },
            { title: 'Uang fisik', dataIndex: 'countedTotal', align: 'right', render: fmtMoney },
            {
              title: 'Selisih',
              dataIndex: 'difference',
              align: 'right',
              render: (v: string, c) =>
                c.status === 'DRAFT' ? (
                  <Typography.Text type="secondary">—</Typography.Text>
                ) : (
                  <span style={{ color: diffColor(Number(v)), fontWeight: 600 }}>{diffText(Number(v))}</span>
                ),
            },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (s: CashCountStatus) => <Tag color={STATUS_COLOR[s]}>{CASH_COUNT_STATUS_LABELS[s]}</Tag>,
            },
          ]}
        />
      </Card>
      <NewCount
        open={creating}
        accounts={kas.data ?? []}
        onClose={() => setCreating(false)}
        onDone={(id) => setParams({ id })}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Drawer open={!!detailId} onClose={() => setParams({})} width={980} title="Opname kas" destroyOnHidden>
        {detailId && <CountDetail id={detailId} onClosed={() => setParams({})} />}
      </Drawer>
    </>
  );
}

function NewCount({
  open,
  accounts,
  onClose,
  onDone,
}: {
  open: boolean;
  accounts: KasAccount[];
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [form] = Form.useForm();
  const create = useAction(
    (v: { accountId: string; date: string; custodianName?: string }) => post<CashCount>('/cash/counts', v),
    {
      invalidate: ['cash-counts'],
      onSuccess: (c) => {
        form.resetFields();
        onClose();
        onDone(c.id);
      },
    },
  );
  return (
    <Modal
      title="Opname kas baru"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Mulai hitung"
      confirmLoading={create.isPending}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ date: today(), accountId: accounts[0]?.id }}
        onFinish={(v) => create.mutate(v)}
      >
        <Form.Item
          name="accountId"
          label="Kas yang dihitung"
          rules={[{ required: true }]}
          extra="Rekening bank tidak diopname — gunakan Rekonsiliasi bank."
        >
          <Select
            options={accounts.map((a) => ({
              value: a.id,
              label: `${a.code} · ${a.name} (saldo ${fmtMoney(a.balance)})`,
            }))}
          />
        </Form.Item>
        <Form.Item name="date" label="Tanggal opname (saldo buku per akhir hari ini)" rules={[{ required: true }]}>
          <Input type="date" />
        </Form.Item>
        <Form.Item name="custodianName" label="Nama pemegang kas">
          <Input maxLength={120} placeholder="mis. Rina (kasir kantor)" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['cash-counts', 'settings'],
    queryFn: () => get<CashCountSettings>('/cash/counts/settings'),
    enabled: open,
  });
  const [v, setV] = useState<number | null>(null);
  useEffect(() => setV(q.data?.approvalThreshold ?? null), [q.data]);
  const save = useAction(() => put('/cash/counts/settings', { approvalThreshold: v ?? 0 }), {
    success: 'Pengaturan disimpan',
    invalidate: ['cash-counts'],
    onSuccess: onClose,
  });
  return (
    <Modal
      title="Pengaturan opname kas"
      open={open}
      onCancel={onClose}
      onOk={() => save.mutate(undefined)}
      okText="Simpan"
      confirmLoading={save.isPending}
    >
      <Typography.Paragraph>
        Selisih di atas batas ini harus disetujui Pemilik sebelum dibukukan. Selisih di bawahnya langsung dibukukan ke
        akun Selisih Kas.
      </Typography.Paragraph>
      <InputNumber
        value={v}
        onChange={setV}
        min={0}
        step={10000}
        prefix="Rp"
        style={{ width: '100%' }}
        formatter={(x) => `${x}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
        parser={(x) => Number((x ?? '').replace(/\./g, ''))}
      />
    </Modal>
  );
}

function CountDetail({ id, onClosed }: { id: string; onClosed: () => void }) {
  const { me } = useAuth();
  const { modal } = App.useApp();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cash-counts', id], queryFn: () => get<CashCount>(`/cash/counts/${id}`) });
  const settings = useQuery({
    queryKey: ['cash-counts', 'settings'],
    queryFn: () => get<CashCountSettings>('/cash/counts/settings'),
  });
  const [denoms, setDenoms] = useState<Denoms>({});
  const [items, setItems] = useState<CashCountItem[]>([]);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [custodian, setCustodian] = useState('');
  const [dirty, setDirty] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    if (!q.data) return;
    setDenoms(q.data.denominations);
    setItems(q.data.items);
    setReason(q.data.reason ?? '');
    setNotes(q.data.notes ?? '');
    setCustodian(q.data.custodianName ?? '');
    setDirty(false);
  }, [q.data]);

  const refresh = (c: CashCount) => qc.setQueryData(['cash-counts', id], c);
  const body = () => ({
    denominations: denoms,
    items: items.filter((i) => i.description.trim() && Number(i.amount) > 0),
    reason,
    notes,
    custodianName: custodian,
  });
  const save = useAction(() => put<CashCount>(`/cash/counts/${id}`, body()), {
    success: 'Hasil hitung disimpan',
    invalidate: ['cash-counts'],
    onSuccess: refresh,
  });
  const finish = useAction(
    async () => {
      if (dirty) await put(`/cash/counts/${id}`, body());
      return post<CashCount>(`/cash/counts/${id}/finish`);
    },
    {
      success: (c) =>
        c.status === 'WAITING_APPROVAL'
          ? 'Selisih melebihi batas — diajukan ke Pemilik untuk disetujui'
          : 'Opname selesai',
      invalidate: KEYS,
      onSuccess: refresh,
    },
  );
  const approve = useAction(() => post<CashCount>(`/cash/counts/${id}/approve`), {
    success: 'Opname disetujui & selisih dibukukan',
    invalidate: KEYS,
    onSuccess: refresh,
  });
  const reject = useAction(() => post<CashCount>(`/cash/counts/${id}/reject`, { reason: rejectReason }), {
    success: 'Dikembalikan untuk dihitung ulang',
    invalidate: ['cash-counts'],
    onSuccess: (c) => {
      setRejecting(false);
      setRejectReason('');
      refresh(c);
    },
  });
  const cancel = useAction(() => post(`/cash/counts/${id}/cancel`), {
    success: 'Opname dibatalkan',
    invalidate: KEYS,
    onSuccess: onClosed,
  });

  return (
    <QueryState q={q}>
      {(c) => {
        const money = canHandleMoney(me?.role);
        const editable = c.status === 'DRAFT' && money;
        const counted = editable ? denomTotal(denoms) : Number(c.countedTotal);
        const itemsTotal = editable
          ? items.reduce((s, i) => s + (i.type === 'ADD' ? 1 : -1) * Number(i.amount || 0), 0)
          : Number(c.itemsTotal);
        const book = Number(c.bookBalance);
        const diff = Math.round((counted + itemsTotal - book) * 100) / 100;
        const threshold = settings.data?.approvalThreshold ?? 50_000;
        const shown: CashCount = {
          ...c,
          denominations: denoms,
          items,
          reason,
          notes,
          custodianName: custodian,
          countedTotal: String(counted),
          itemsTotal: String(itemsTotal),
          difference: String(diff),
        };
        const set =
          <T,>(fn: (v: T) => void) =>
          (v: T) => {
            fn(v);
            setDirty(true);
          };
        return (
          <>
            <Space style={{ marginBottom: 16 }} wrap className="no-print">
              <Tag color={STATUS_COLOR[c.status]} style={{ fontSize: 14, padding: '2px 10px' }}>
                {CASH_COUNT_STATUS_LABELS[c.status]}
              </Tag>
              {editable && (
                <>
                  <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate(undefined)}>
                    Simpan
                  </Button>
                  <Button
                    type="primary"
                    icon={<CheckOutlined />}
                    loading={finish.isPending}
                    disabled={counted === 0}
                    onClick={() =>
                      modal.confirm({
                        title: 'Selesaikan opname?',
                        content:
                          diff === 0
                            ? 'Uang fisik cocok dengan saldo buku.'
                            : Math.abs(diff) > threshold && me?.role !== 'OWNER'
                              ? `${diffText(diff)} — melebihi batas ${fmtMoney(threshold)}, akan diajukan ke Pemilik.`
                              : `${diffText(diff)} akan dibukukan ke akun Selisih Kas.`,
                        okText: 'Selesaikan',
                        onOk: () => finish.mutateAsync(undefined),
                      })
                    }
                  >
                    Selesaikan
                  </Button>
                </>
              )}
              {c.status === 'WAITING_APPROVAL' && me?.role === 'OWNER' && (
                <>
                  <Button
                    type="primary"
                    icon={<CheckOutlined />}
                    loading={approve.isPending}
                    onClick={() => approve.mutate(undefined)}
                  >
                    Setujui & bukukan
                  </Button>
                  <Button danger icon={<CloseOutlined />} onClick={() => setRejecting(true)}>
                    Tolak / hitung ulang
                  </Button>
                </>
              )}
              {c.status !== 'DRAFT' && c.status !== 'CANCELLED' && (
                <>
                  <Button icon={<PrinterOutlined />} onClick={() => printDoc(`Berita acara opname kas ${c.number}`)}>
                    Cetak berita acara
                  </Button>
                  <ExportButtons
                    filename={`opname-kas-${c.number.replace(/\//g, '-')}`}
                    title={`Opname kas ${c.number}`}
                    sheets={() => cashCountSheet(c, me?.tenantName)}
                    print={false}
                  />
                </>
              )}
              {money && (c.status === 'DRAFT' ||
                c.status === 'WAITING_APPROVAL' ||
                (c.status === 'POSTED' && me?.role === 'OWNER')) && (
                <Button
                  danger
                  type="text"
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    modal.confirm({
                      title: `Batalkan opname ${c.number}?`,
                      content:
                        c.status === 'POSTED'
                          ? 'Jurnal selisihnya dibalik dan kunci transaksi kas sampai tanggal ini dibuka kembali.'
                          : 'Hasil hitung tidak disimpan sebagai opname.',
                      okText: 'Batalkan opname',
                      okButtonProps: { danger: true },
                      onOk: () => cancel.mutateAsync(undefined),
                    })
                  }
                >
                  Batalkan
                </Button>
              )}
            </Space>

            {c.rejectReason && editable && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="Dikembalikan oleh Pemilik"
                description={c.rejectReason}
                className="no-print"
              />
            )}
            {c.status === 'WAITING_APPROVAL' && me?.role !== 'OWNER' && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="Menunggu persetujuan Pemilik karena selisih melebihi batas."
                className="no-print"
              />
            )}

            <Row gutter={[12, 12]} style={{ marginBottom: 16 }} className="no-print">
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic title="Saldo buku" value={fmtMoney(book)} valueStyle={{ fontSize: 18 }} />
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    per {fmtDate(c.date)}
                    {editable && ' · terkini'}
                  </Typography.Text>
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic title="Uang fisik" value={fmtMoney(counted)} valueStyle={{ fontSize: 18 }} />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic title="Pos rekonsiliasi" value={fmtMoney(itemsTotal)} valueStyle={{ fontSize: 18 }} />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small" style={{ borderColor: diffColor(diff) }}>
                  <Statistic
                    title="Selisih"
                    value={counted ? diffText(diff) : '—'}
                    valueStyle={{ fontSize: 18, color: counted ? diffColor(diff) : undefined }}
                  />
                </Card>
              </Col>
            </Row>

            {editable ? (
              <div className="no-print">
                <Card
                  size="small"
                  title={`Hitung uang — ${c.account.code} ${c.account.name}`}
                  style={{ marginBottom: 16 }}
                >
                  <DenominationCounter value={denoms} onChange={set(setDenoms)} />
                </Card>
                <Card size="small" title="Pos rekonsiliasi (opsional)" style={{ marginBottom: 16 }}>
                  <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
                    Jelaskan selisih yang wajar: <strong>(+)</strong> bon sementara / kasbon yang belum dicatat;{' '}
                    <strong>(−)</strong> uang titipan atau penerimaan yang belum dibukukan. Sisa selisih yang tidak
                    terjelaskan dibukukan ke Selisih Kas. Jangan lupa mencatat transaksi aslinya setelah opname
                    (bertanggal sesudahnya).
                  </Typography.Paragraph>
                  {items.map((it, i) => (
                    <Space key={i} style={{ display: 'flex', marginBottom: 8 }} align="start" wrap>
                      <Select
                        value={it.type}
                        style={{ width: 90 }}
                        options={[
                          { value: 'ADD', label: '(+)' },
                          { value: 'LESS', label: '(−)' },
                        ]}
                        onChange={(v) => set(setItems)(items.map((x, j) => (j === i ? { ...x, type: v } : x)))}
                      />
                      <Input
                        style={{ width: 380 }}
                        maxLength={200}
                        placeholder="Keterangan"
                        value={it.description}
                        onChange={(e) =>
                          set(setItems)(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))
                        }
                      />
                      <InputNumber
                        min={0}
                        prefix="Rp"
                        style={{ width: 170 }}
                        value={Number(it.amount) || null}
                        onChange={(v) =>
                          set(setItems)(items.map((x, j) => (j === i ? { ...x, amount: String(v ?? 0) } : x)))
                        }
                      />
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => set(setItems)(items.filter((_, j) => j !== i))}
                        aria-label="Hapus pos"
                      />
                    </Space>
                  ))}
                  <Button
                    type="dashed"
                    icon={<PlusOutlined />}
                    onClick={() => set(setItems)([...items, { type: 'ADD', description: '', amount: '0' }])}
                  >
                    Tambah pos
                  </Button>
                </Card>
                <Card size="small" title="Keterangan">
                  <Form layout="vertical">
                    <Form.Item label="Pemegang kas">
                      <Input value={custodian} onChange={(e) => set(setCustodian)(e.target.value)} maxLength={120} />
                    </Form.Item>
                    <Form.Item
                      label="Penjelasan selisih"
                      required={diff !== 0 && counted > 0}
                      validateStatus={diff !== 0 && counted > 0 && !reason.trim() ? 'warning' : undefined}
                    >
                      <Input.TextArea
                        rows={2}
                        value={reason}
                        onChange={(e) => set(setReason)(e.target.value)}
                        maxLength={500}
                        placeholder="Wajib bila ada selisih, mis. uang receh kembalian tidak tercatat"
                      />
                    </Form.Item>
                    <Form.Item label="Catatan lain" style={{ marginBottom: 0 }}>
                      <Input.TextArea
                        rows={2}
                        value={notes}
                        onChange={(e) => set(setNotes)(e.target.value)}
                        maxLength={500}
                      />
                    </Form.Item>
                  </Form>
                </Card>
              </div>
            ) : (
              <BeritaAcara c={shown} />
            )}

            <Modal
              open={rejecting}
              title="Kembalikan untuk dihitung ulang"
              okText="Kembalikan"
              okButtonProps={{ danger: true, disabled: !rejectReason.trim(), loading: reject.isPending }}
              onOk={() => reject.mutate(undefined)}
              onCancel={() => setRejecting(false)}
            >
              <Input.TextArea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                maxLength={300}
                placeholder="mis. Hitung ulang, cek juga laci kedua"
              />
            </Modal>
          </>
        );
      }}
    </QueryState>
  );
}

/** Berita acara opname kas (dokumen cetak) */
function BeritaAcara({ c }: { c: CashCount }) {
  const diff = Number(c.difference);
  const right = { ...cell, textAlign: 'right' as const };
  return (
    <PrintSheet>
      <DocHeader
        title="BERITA ACARA OPNAME KAS"
        meta={[
          ['Nomor', c.number],
          ['Tanggal', fmtDate(c.date)],
        ]}
      />
      <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="Kas">
          {c.account.code} · {c.account.name}
        </Descriptions.Item>
        <Descriptions.Item label="Pemegang kas">{c.custodianName || '-'}</Descriptions.Item>
      </Descriptions>
      <div style={{ fontSize: 13, marginBottom: 10 }}>
        Pada tanggal tersebut telah dilakukan penghitungan fisik uang kas dengan hasil sebagai berikut:
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={head}>Pecahan</th>
            <th style={{ ...head, textAlign: 'right' }}>Jumlah</th>
            <th style={{ ...head, textAlign: 'right' }}>Nilai</th>
          </tr>
        </thead>
        <tbody>
          {CASH_DENOMINATIONS.filter((d) => (c.denominations[d.key] ?? 0) > 0).map((d) => (
            <tr key={d.key}>
              <td style={cell}>
                Uang {d.kind.toLowerCase()} {d.value.toLocaleString('id-ID')}
              </td>
              <td style={right}>
                {c.denominations[d.key]} {d.kind === 'Kertas' ? 'lembar' : 'keping'}
              </td>
              <td style={right}>{fmtMoney(d.value * (c.denominations[d.key] ?? 0))}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...cell, fontWeight: 700 }} colSpan={2}>
              Jumlah uang fisik
            </td>
            <td style={{ ...right, fontWeight: 700 }}>{fmtMoney(c.countedTotal)}</td>
          </tr>
          {c.items.map((i, k) => (
            <tr key={k}>
              <td style={cell} colSpan={2}>
                {i.type === 'ADD' ? '(+)' : '(−)'} {i.description}
              </td>
              <td style={right}>{fmtMoney(i.amount)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...cell, fontWeight: 700 }} colSpan={2}>
              Kas menurut hasil opname
            </td>
            <td style={{ ...right, fontWeight: 700 }}>{fmtMoney(Number(c.countedTotal) + Number(c.itemsTotal))}</td>
          </tr>
          <tr>
            <td style={cell} colSpan={2}>
              Saldo kas menurut pembukuan
            </td>
            <td style={right}>{fmtMoney(c.bookBalance)}</td>
          </tr>
          <tr>
            <td style={{ ...cell, fontWeight: 800, borderTop: `2px solid ${BRAND.colors.primary}` }} colSpan={2}>
              Selisih
            </td>
            <td
              style={{
                ...right,
                fontWeight: 800,
                borderTop: `2px solid ${BRAND.colors.primary}`,
                color: diff ? '#dc2626' : undefined,
              }}
            >
              {diffText(diff)}
            </td>
          </tr>
        </tbody>
      </table>
      {c.reason && <div style={{ marginTop: 12, fontSize: 13 }}>Penjelasan selisih: {c.reason}</div>}
      {c.notes && <div style={{ marginTop: 4, fontSize: 13 }}>Catatan: {c.notes}</div>}
      {c.journalNumber && (
        <div style={{ marginTop: 4, fontSize: 12, color: '#64748b' }}>
          Selisih dibukukan dengan jurnal {c.journalNumber}
          {c.approvedBy ? ` · disetujui ${c.approvedBy}` : ''}
        </div>
      )}
      <Signatures
        labels={[
          ['Pemegang kas', c.custodianName || undefined],
          ['Pemeriksa', c.createdBy || undefined],
          ['Mengetahui', c.approvedBy || undefined],
        ]}
      />
    </PrintSheet>
  );
}
