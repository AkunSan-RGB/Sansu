import { CheckCircleFilled, ClockCircleFilled, InfoCircleFilled, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { JOURNAL_SOURCE_LABELS, type JournalSource } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Col, Form, Input, InputNumber, List, Modal, Popconfirm, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, qs } from '@/api/client';
import { LEDGER_KEYS, useAccounts, useAction } from '@/api/queries';
import type { Account, JournalEntry } from '@/api/types';
import QueryState from '@/components/QueryState';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';
import { usePeriod } from './ledger/usePeriod';
import { SOURCE_COLOR } from './JournalsPage';

const ADJ_SOURCES = ['ADJUSTMENT', 'DEPRECIATION', 'INCOME_TAX'] as const;

type ChecklistItem = {
  key: string;
  title: string;
  status: 'DONE' | 'TODO' | 'INFO' | 'NA';
  message: string;
  amount?: string;
  link?: string;
  template?: { kind: TemplateKind; amount: string; description: string };
};

type TemplateKind = 'PREPAID_EXPENSE' | 'ACCRUED_EXPENSE' | 'UNEARNED_REVENUE' | 'ACCRUED_REVENUE' | 'BAD_DEBT' | 'CUSTOM';
type AccFilter = (a: Account) => boolean;
const isGroup = (...g: string[]): AccFilter => (a) => !!a.reportGroup && g.includes(a.reportGroup);
const isType = (...t: string[]): AccFilter => (a) => t.includes(a.type);

/** Templat jurnal penyesuaian yang umum di akhir periode */
const TEMPLATES: Record<TemplateKind, { label: string; hint: string; debit: { label: string; filter: AccFilter; code?: string }; credit: { label: string; filter: AccFilter; code?: string } }> = {
  PREPAID_EXPENSE: {
    label: 'Beban dibayar dimuka yang sudah terpakai',
    hint: 'Sewa/asuransi dibayar dimuka yang manfaatnya sudah dipakai bulan ini dipindah ke beban.',
    debit: { label: 'Akun beban', filter: isType('EXPENSE'), code: '6-3000' },
    credit: { label: 'Akun dibayar dimuka', filter: isGroup('PREPAID'), code: '1-1700' },
  },
  ACCRUED_EXPENSE: {
    label: 'Beban masih harus dibayar (akrual)',
    hint: 'Beban bulan ini yang tagihannya belum datang/dibayar: listrik, bunga, komisi, lembur.',
    debit: { label: 'Akun beban', filter: isType('EXPENSE'), code: '6-4000' },
    credit: { label: 'Akun utang akrual', filter: isGroup('ACCRUED_EXPENSE', 'OTHER_PAYABLE'), code: '2-1600' },
  },
  UNEARNED_REVENUE: {
    label: 'Pendapatan diterima dimuka yang sudah dihasilkan',
    hint: 'Uang muka pelanggan yang barang/jasanya sudah diserahkan diakui menjadi pendapatan.',
    debit: { label: 'Akun pendapatan diterima dimuka', filter: isGroup('UNEARNED_REVENUE'), code: '2-1700' },
    credit: { label: 'Akun pendapatan', filter: isType('REVENUE'), code: '4-1000' },
  },
  ACCRUED_REVENUE: {
    label: 'Pendapatan masih harus diterima',
    hint: 'Pendapatan yang sudah menjadi hak perusahaan tetapi belum ditagih (mis. bunga, sewa, rabat supplier).',
    debit: { label: 'Akun piutang', filter: isGroup('OTHER_RECEIVABLE', 'TRADE_RECEIVABLE'), code: '1-1350' },
    credit: { label: 'Akun pendapatan', filter: isType('REVENUE'), code: '4-9000' },
  },
  BAD_DEBT: {
    label: 'Cadangan kerugian piutang',
    hint: 'Piutang yang kemungkinan tidak tertagih dicadangkan (SAK EP: penurunan nilai).',
    debit: { label: 'Akun beban kerugian piutang', filter: isType('EXPENSE'), code: '6-7300' },
    credit: { label: 'Akun cadangan', filter: isGroup('ALLOWANCE_RECEIVABLE'), code: '1-1310' },
  },
  CUSTOM: {
    label: 'Penyesuaian lainnya (bebas)',
    hint: 'Pilih sendiri akun debit & kredit. Untuk lebih dari dua akun, tambah baris.',
    debit: { label: 'Akun debit', filter: () => true },
    credit: { label: 'Akun kredit', filter: () => true },
  },
};

const STATUS = {
  DONE: { color: 'green', label: 'Selesai', icon: <CheckCircleFilled style={{ color: '#52c41a' }} /> },
  TODO: { color: 'orange', label: 'Perlu dikerjakan', icon: <ClockCircleFilled style={{ color: '#faad14' }} /> },
  INFO: { color: 'blue', label: 'Periksa', icon: <InfoCircleFilled style={{ color: '#1677ff' }} /> },
  NA: { color: 'default', label: 'Tidak ada', icon: <MinusCircleOutlined style={{ color: '#bfbfbf' }} /> },
};

function AdjustmentModal({ open, onClose, initial, defaultDate }: { open: boolean; onClose: () => void; initial?: ChecklistItem['template']; defaultDate: string }) {
  const [form] = Form.useForm();
  const accounts = useAccounts();
  const kind: TemplateKind = Form.useWatch('kind', form) ?? 'PREPAID_EXPENSE';
  const recurring: boolean = Form.useWatch('recurring', form) ?? false;
  const t = TEMPLATES[kind];
  const postable = useMemo(() => (accounts.data ?? []).filter((a) => a.isPostable && a.isActive !== false), [accounts.data]);
  const opts = (f: AccFilter) => postable.filter(f).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }));
  const byCode = (code?: string) => postable.find((a) => a.code === code)?.id;
  const applyKind = (k: TemplateKind) => form.setFieldsValue({ debitAccountId: byCode(TEMPLATES[k].debit.code), creditAccountId: byCode(TEMPLATES[k].credit.code) });

  const save = useAction(
    async (v: { kind: TemplateKind; date: string; description: string; reference?: string; amount: number; debitAccountId: string; creditAccountId: string; extra?: { accountId: string; debit?: number; credit?: number }[]; recurring?: boolean; times?: number }) => {
      const lines = [
        { accountId: v.debitAccountId, debit: String(v.amount), credit: '0' },
        { accountId: v.creditAccountId, debit: '0', credit: String(v.amount) },
        ...(v.extra ?? []).filter((l) => l?.accountId).map((l) => ({ accountId: l.accountId, debit: String(l.debit ?? 0), credit: String(l.credit ?? 0) })),
      ];
      if (v.recurring) {
        await post('/accounting/recurring', { name: v.description, description: v.description, frequency: 'MONTHLY', nextDate: v.date, remaining: v.times ?? 12, isAdjustment: true, lines });
        return post<{ posted: { number: string }[] }>('/accounting/recurring/run').then((r) => `Jurnal berulang dibuat · ${r.posted.length} diposting sampai hari ini`);
      }
      const j = await post<JournalEntry>('/accounting/journals', { date: v.date, description: v.description, reference: v.reference || undefined, adjustment: true, lines });
      return `Jurnal penyesuaian ${j.number} diposting`;
    },
    { success: (m) => m, invalidate: ['recurring', 'adjustments', ...LEDGER_KEYS], onSuccess: onClose },
  );

  return (
    <Modal
      title="Jurnal penyesuaian"
      open={open}
      width={760}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Posting"
      confirmLoading={save.isPending}
      destroyOnHidden
      afterOpenChange={(o) => {
        if (!o) return;
        const k = initial?.kind ?? 'PREPAID_EXPENSE';
        form.setFieldsValue({ kind: k, date: defaultDate, description: initial?.description ?? '', amount: Number(initial?.amount) || undefined, recurring: false, times: 12 });
        applyKind(k);
      }}
    >
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
        <Form.Item name="kind" label="Jenis penyesuaian">
          <Select
            options={(Object.keys(TEMPLATES) as TemplateKind[]).map((k) => ({ value: k, label: TEMPLATES[k].label }))}
            onChange={(k: TemplateKind) => applyKind(k)}
          />
        </Form.Item>
        <Alert type="info" showIcon message={t.hint} style={{ marginBottom: 12 }} />
        <Row gutter={12}>
          <Col xs={24} md={8}>
            <Form.Item name="date" label="Tanggal (akhir periode)" rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
          </Col>
          <Col xs={24} md={10}>
            <Form.Item name="amount" label="Jumlah" rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: '100%' }} prefix="Rp" />
            </Form.Item>
          </Col>
          <Col xs={24} md={6}>
            <Form.Item name="reference" label="No. bukti / memo">
              <Input placeholder="MEMO-09" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="description" label="Keterangan" rules={[{ required: true }]}>
          <Input placeholder="Pembebanan sewa gudang September" />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="debitAccountId" label={`Debit — ${t.debit.label}`} rules={[{ required: true }]}>
              <Select showSearch optionFilterProp="label" options={opts(t.debit.filter)} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="creditAccountId" label={`Kredit — ${t.credit.label}`} rules={[{ required: true }]}>
              <Select showSearch optionFilterProp="label" options={opts(t.credit.filter)} />
            </Form.Item>
          </Col>
        </Row>
        {kind === 'CUSTOM' && (
          <Form.List name="extra">
            {(fields, { add, remove }) => (
              <>
                {fields.map((f) => (
                  <Space key={f.key} align="baseline" wrap>
                    <Form.Item name={[f.name, 'accountId']}>
                      <Select showSearch optionFilterProp="label" placeholder="Akun tambahan" style={{ width: 280 }} options={opts(() => true)} />
                    </Form.Item>
                    <Form.Item name={[f.name, 'debit']}>
                      <InputNumber min={0} placeholder="Debit" />
                    </Form.Item>
                    <Form.Item name={[f.name, 'credit']}>
                      <InputNumber min={0} placeholder="Kredit" />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(f.name)} />
                  </Space>
                ))}
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add()} style={{ marginBottom: 12 }}>
                  Tambah baris (debit = kredit tetap harus seimbang)
                </Button>
              </>
            )}
          </Form.List>
        )}
        {kind !== 'CUSTOM' && (
          <Space align="baseline" wrap>
            <Form.Item name="recurring" valuePropName="checked">
              <Checkbox>Ulangi otomatis setiap akhir bulan</Checkbox>
            </Form.Item>
            {recurring && (
              <Form.Item name="times" label="sebanyak">
                <InputNumber min={1} max={120} suffix="kali" />
              </Form.Item>
            )}
          </Space>
        )}
      </Form>
    </Modal>
  );
}

export default function AdjustmentsPage() {
  const navigate = useNavigate();
  const { from, to, setFrom, setTo, query } = usePeriod();
  const [month, setMonth] = useState(() => (dayjs(to).date() < 25 ? dayjs(to).subtract(1, 'month') : dayjs(to)).format('YYYY-MM'));
  const [modal, setModal] = useState<{ open: boolean; template?: ChecklistItem['template'] }>({ open: false });
  const journals = useQuery({
    queryKey: ['journals', 'adjustments', from, to],
    queryFn: () => get<JournalEntry[]>(`/accounting/journals${qs({ from, to, source: ADJ_SOURCES.join(',') })}`),
  });
  const summary = useQuery({
    queryKey: ['adjustments', 'summary', from, to],
    queryFn: () => get<{ sourceType: string; count: number; total: string }[]>(`/accounting/adjustments/summary${qs({ from, to })}`),
  });
  const checklist = useQuery({
    queryKey: ['adjustments', 'checklist', month],
    queryFn: () => get<{ period: string; date: string; items: ChecklistItem[] }>(`/accounting/adjustments/checklist?period=${month}`),
  });
  const reverse = useAction((id: string) => post<JournalEntry>(`/accounting/journals/${id}/reverse`), {
    success: (j) => `Jurnal balik ${j.number} dibuat`,
    invalidate: ['adjustments', ...LEDGER_KEYS],
  });
  const reversed = new Set(journals.data?.map((j) => j.reversalOfId).filter(Boolean));
  const todo = checklist.data?.items.filter((i) => i.status === 'TODO').length ?? 0;
  const s = (k: string) => summary.data?.find((x) => x.sourceType === k);

  return (
    <>
      <PageHeader
        title="Jurnal Penyesuaian"
        extra={
          <Space wrap>
            <Input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            <span>s/d</span>
            <Input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModal({ open: true })}>
              Jurnal penyesuaian
            </Button>
          </Space>
        }
      />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {[
          ['ADJUSTMENT', 'Penyesuaian & amortisasi'],
          ['DEPRECIATION', 'Penyusutan aset'],
          ['INCOME_TAX', 'Pajak penghasilan'],
        ].map(([k, label]) => (
          <Col xs={24} md={8} key={k}>
            <Card size="small">
              <Statistic title={`${label} · ${s(k)?.count ?? 0} jurnal`} value={Number(s(k)?.total ?? 0)} formatter={(v) => fmtMoney(Number(v))} />
            </Card>
          </Col>
        ))}
      </Row>
      <Card>
        <Tabs
          items={[
            {
              key: 'checklist',
              label: (
                <span>
                  Daftar periksa akhir bulan {todo > 0 && <Tag color="orange">{todo}</Tag>}
                </span>
              ),
              children: (
                <>
                  <Space wrap style={{ marginBottom: 12 }}>
                    <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ width: 180 }} />
                    <Button onClick={() => navigate(`/worksheet?${query}`)}>Lihat dampaknya di Neraca Lajur</Button>
                  </Space>
                  <QueryState q={checklist}>
                    {(d) => (
                      <List
                        dataSource={d.items}
                        renderItem={(i) => (
                          <List.Item
                            actions={[
                              i.template && i.status !== 'DONE' && (
                                <Button key="t" size="small" type="primary" onClick={() => setModal({ open: true, template: i.template })}>
                                  Buat jurnal
                                </Button>
                              ),
                              i.link && (
                                <Button key="l" size="small" onClick={() => navigate(i.link!)}>
                                  Buka
                                </Button>
                              ),
                            ].filter(Boolean)}
                          >
                            <List.Item.Meta
                              avatar={STATUS[i.status].icon}
                              title={
                                <Space>
                                  {i.title}
                                  <Tag color={STATUS[i.status].color}>{STATUS[i.status].label}</Tag>
                                  {i.amount && Number(i.amount) > 0 && <Typography.Text type="secondary">{fmtMoney(i.amount)}</Typography.Text>}
                                </Space>
                              }
                              description={i.message}
                            />
                          </List.Item>
                        )}
                      />
                    )}
                  </QueryState>
                </>
              ),
            },
            {
              key: 'list',
              label: 'Jurnal penyesuaian',
              children: (
                <Table
                  rowKey="id"
                  loading={journals.isLoading}
                  dataSource={journals.data}
                  scroll={{ x: 900 }}
                  expandable={{
                    expandedRowRender: (j) => (
                      <Table
                        rowKey="id"
                        size="small"
                        pagination={false}
                        dataSource={j.lines}
                        columns={[
                          { title: 'Akun', render: (_, l) => `${l.account.code} · ${l.account.name}` },
                          { title: 'Debit', dataIndex: 'debit', align: 'right', render: (v) => (Number(v) ? fmtMoney(v) : '') },
                          { title: 'Kredit', dataIndex: 'credit', align: 'right', render: (v) => (Number(v) ? fmtMoney(v) : '') },
                        ]}
                      />
                    ),
                  }}
                  columns={[
                    { title: 'Nomor', dataIndex: 'number', width: 150 },
                    { title: 'Tanggal', dataIndex: 'date', render: fmtDate, width: 110 },
                    { title: 'Keterangan', dataIndex: 'description' },
                    { title: 'Jenis', dataIndex: 'sourceType', render: (t: JournalSource) => <Tag color={SOURCE_COLOR[t]}>{JOURNAL_SOURCE_LABELS[t]}</Tag> },
                    { title: 'Nilai', align: 'right', render: (_, j) => fmtMoney(j.lines.reduce((a, l) => a + Number(l.debit), 0)) },
                    {
                      render: (_, j) =>
                        (j.sourceType === 'ADJUSTMENT' || j.sourceType === 'INCOME_TAX') &&
                        !reversed.has(j.id) && (
                          <Popconfirm title="Batalkan dengan jurnal balik?" onConfirm={() => reverse.mutate(j.id)}>
                            <Button size="small">Balik</Button>
                          </Popconfirm>
                        ),
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>
      <AdjustmentModal
        open={modal.open}
        initial={modal.template}
        defaultDate={checklist.data?.date ?? dayjs().endOf('month').format('YYYY-MM-DD')}
        onClose={() => setModal({ open: false })}
      />
    </>
  );
}
