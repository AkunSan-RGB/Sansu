import { Link, useSearchParams } from 'react-router-dom';
import { MinusCircleOutlined, PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { JOURNAL_SOURCE_LABELS, type JournalSource, RECURRING_FREQUENCY_LABELS, toOptions } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Form,
  type FormInstance,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { useAuth } from '@/auth/AuthContext';
import { useState } from 'react';
import { api, ApiError, get, patch, post, qs, del } from '@/api/client';
import { LEDGER_KEYS, useAccounts, useAction, useBranches } from '@/api/queries';
import { withBudgetOverride } from '@/lib/budgetOverride';
import type { JournalEntry, Project, RecurringJournal } from '@/api/types';
import { useApps } from '@/lib/apps';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import { t } from '@/lib/terms';

export const SOURCE_COLOR: Partial<Record<JournalSource, string>> = {
  INVOICE: 'green',
  DELIVERY: 'lime',
  PAYMENT: 'blue',
  STOCK_ADJUSTMENT: 'purple',
  STOCK_TRANSFER: 'purple',
  CASH_COUNT: 'volcano',
  REVERSAL: 'red',
  OPENING: 'gold',
  SALES_RETURN: 'orange',
  PURCHASE_INVOICE: 'cyan',
  SUPPLIER_PAYMENT: 'geekblue',
  PURCHASE_RETURN: 'orange',
  CASH_IN: 'lime',
  CASH_OUT: 'volcano',
  TRANSFER: 'blue',
  CLOSING: 'magenta',
  POS: 'gold',
  POS_CLOSE: 'gold',
  PAYROLL: 'purple',
  PAYROLL_PAYMENT: 'purple',
  ADJUSTMENT: 'orange',
  RECURRING: 'cyan',
  ASSET_ACQUISITION: 'geekblue',
  DEPRECIATION: 'geekblue',
  ASSET_DISPOSAL: 'geekblue',
  INCOME_TAX: 'red',
};
const REVERSIBLE: JournalSource[] = ['MANUAL', 'OPENING', 'ADJUSTMENT', 'RECURRING', 'INCOME_TAX'];

type LineValue = { accountId: string; debit?: number; credit?: number; memo?: string; projectId?: string };

/** Baris jurnal (akun, debit, kredit) yang dipakai jurnal manual & jurnal berulang */
function LinesEditor({ form }: { form: FormInstance }) {
  const accounts = useAccounts();
  const postable = accounts.data?.filter((a) => a.isPostable && a.isActive !== false).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }));
  const lines: LineValue[] = Form.useWatch('lines', form) ?? [];
  const { can } = useApps();
  const projectList = useQuery({ queryKey: ['projects'], queryFn: () => get<Project[]>('/services/projects'), enabled: can('sales') });
  const activeProjects = (projectList.data ?? []).filter((p) => p.status === 'ACTIVE');
  const isExpense = (id?: string) => accounts.data?.find((a) => a.id === id)?.type === 'EXPENSE';
  const totalD = lines.reduce((a, l) => a + (l?.debit ?? 0), 0);
  const totalC = lines.reduce((a, l) => a + (l?.credit ?? 0), 0);
  return (
    <>
      <Form.List name="lines">
        {(fields, { add, remove }) => (
          <>
            {fields.map((f) => (
              <Space key={f.key} align="baseline" wrap>
                <Form.Item name={[f.name, 'accountId']} rules={[{ required: true, message: 'Pilih akun' }]}>
                  <Select showSearch optionFilterProp="label" placeholder="Akun" style={{ width: 300 }} options={postable} />
                </Form.Item>
                <Form.Item name={[f.name, 'debit']}>
                  <InputNumber min={0} placeholder="Debit" style={{ width: 140 }} />
                </Form.Item>
                <Form.Item name={[f.name, 'credit']}>
                  <InputNumber min={0} placeholder="Kredit" style={{ width: 140 }} />
                </Form.Item>
                <Form.Item name={[f.name, 'memo']}>
                  <Input placeholder="Catatan baris" style={{ width: 160 }} />
                </Form.Item>
                {activeProjects.length > 0 && isExpense(lines[f.name]?.accountId) && (
                  <Form.Item name={[f.name, 'projectId']} tooltip="Biaya langsung proyek">
                    <Select
                      allowClear
                      placeholder="Proyek (opsional)"
                      style={{ width: 200 }}
                      options={activeProjects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
                    />
                  </Form.Item>
                )}
                {fields.length > 2 && <MinusCircleOutlined onClick={() => remove(f.name)} />}
              </Space>
            ))}
            <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add()}>
              Tambah baris
            </Button>
          </>
        )}
      </Form.List>
      <Typography.Paragraph style={{ marginTop: 12 }} type={totalD === totalC && totalD > 0 ? 'success' : 'danger'}>
        Debit {fmtMoney(totalD)} · Kredit {fmtMoney(totalC)} {totalD === totalC && totalD > 0 ? '· seimbang' : '· belum seimbang'}
      </Typography.Paragraph>
    </>
  );
}

const toLines = (lines: LineValue[]) =>
  lines.map((l) => ({
    accountId: l.accountId,
    debit: String(l.debit ?? 0),
    credit: String(l.credit ?? 0),
    memo: l.memo || undefined,
    projectId: l.projectId || undefined,
  }));

function JournalList() {
  const [initial] = useSearchParams();
  const [filter, setFilter] = useState<{ from?: string; to?: string; source?: string; q?: string }>({ q: initial.get('q') || undefined });
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const journals = useQuery({ queryKey: ['journals', filter], queryFn: () => get<JournalEntry[]>(`/accounting/journals${qs(filter)}`) });

  const { me } = useAuth();
  const { modal } = App.useApp();
  const branches = useBranches();
  const create = useAction(
    async (v: { date: string; description: string; reference?: string; branchId?: string; adjustment?: boolean; autoReverse?: boolean; controlOverrideReason?: string; lines: LineValue[] }) => {
      const body = { ...v, branchId: v.branchId || undefined, reference: v.reference || undefined, autoReverse: v.adjustment ? v.autoReverse : undefined, controlOverrideReason: v.controlOverrideReason?.trim() || undefined, lines: toLines(v.lines) };
      try {
        return await withBudgetOverride(modal, me?.role, (budgetOverrideReason) => post<JournalEntry>('/accounting/journals', { ...body, budgetOverrideReason }));
      } catch (e) {
        const data = e instanceof ApiError ? (e.data as { code?: string; duplicates?: { number: string; date: string; description: string }[] } | undefined) : undefined;
        if (data?.code !== 'POSSIBLE_DUPLICATE') throw e;
        // pencegahan pencatatan ganda: tampilkan jurnal serupa, simpan hanya bila pengguna yakin
        const ok = await new Promise<boolean>((resolve) =>
          modal.confirm({
            title: 'Mungkin sudah tercatat',
            width: 520,
            content: (
              <div>
                <p>Jurnal dengan akun dan nilai yang sama sudah ada:</p>
                <ul>
                  {data.duplicates?.map((d) => (
                    <li key={d.number}>
                      <strong>{d.number}</strong> ({fmtDate(d.date)}) {d.description}
                    </li>
                  ))}
                </ul>
                <p>Simpan lagi hanya bila ini memang transaksi yang berbeda.</p>
              </div>
            ),
            okText: 'Tetap simpan',
            cancelText: 'Batal',
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          }),
        );
        if (!ok) throw new Error('Tidak disimpan: jurnal serupa sudah ada');
        return post<JournalEntry>('/accounting/journals', { ...body, confirmDuplicate: true });
      }
    },
    {
      success: (j) => `Jurnal ${j.number} diposting${j.scheduledReversal ? ` · dibalik otomatis ${fmtDate(j.scheduledReversal)}` : ''}`,
      invalidate: LEDGER_KEYS,
      onSuccess: () => setOpen(false),
    },
  );
  const cancelSchedule = useAction((id: string) => del(`/accounting/journals/${id}/scheduled-reversal`), { success: 'Jadwal balik otomatis dibatalkan', invalidate: LEDGER_KEYS });
  const reverse = useAction((id: string) => post<JournalEntry>(`/accounting/journals/${id}/reverse`), {
    success: (j) => `Jurnal balik ${j.number} dibuat`,
    invalidate: LEDGER_KEYS,
  });
  const reversedIds = new Set(journals.data?.map((j) => j.reversalOfId).filter(Boolean));

  return (
    <>
      <Card>
        <Space wrap style={{ marginBottom: 12 }}>
          <Input.Search placeholder="Cari nomor / keterangan / bukti" allowClear defaultValue={filter.q} onSearch={(q) => setFilter((f) => ({ ...f, q: q || undefined }))} style={{ width: 280 }} />
          <Select
            allowClear
            placeholder="Semua jenis"
            style={{ width: 200 }}
            onChange={(v) => setFilter((f) => ({ ...f, source: v }))}
            options={toOptions(JOURNAL_SOURCE_LABELS)}
          />
          <Input type="date" onChange={(e) => setFilter((r) => ({ ...r, from: e.target.value || undefined }))} />
          <span>s/d</span>
          <Input type="date" onChange={(e) => setFilter((r) => ({ ...r, to: e.target.value || undefined }))} />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields();
              form.setFieldsValue({ date: today(), adjustment: false, lines: [{}, {}] });
              setOpen(true);
            }}
          >
            Jurnal manual
          </Button>
        </Space>
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
            { title: 'No. bukti', dataIndex: 'reference', render: (r) => r ?? <Typography.Text type="secondary">—</Typography.Text> },
            { title: 'Jenis', dataIndex: 'sourceType', render: (s: JournalSource) => <Tag color={SOURCE_COLOR[s]}>{JOURNAL_SOURCE_LABELS[s] ?? s}</Tag> },
            { title: 'Nilai', align: 'right', render: (_, j) => fmtMoney(j.lines.reduce((a, l) => a + Number(l.debit), 0)) },
            {
              title: 'Dokumen asal',
              render: (_, j) => (j.docRoute ? <Link to={j.docRoute}>Buka dokumen</Link> : <Typography.Text type="secondary">—</Typography.Text>),
            },
            {
              render: (_, j) =>
                REVERSIBLE.includes(j.sourceType) &&
                !j.reversalOfId &&
                !reversedIds.has(j.id) && (
                  <Space size={4} wrap>
                    {j.scheduledReversal && (
                      <Popconfirm title={`Batalkan jadwal balik otomatis ${fmtDate(j.scheduledReversal)}?`} okText="Batalkan jadwal" onConfirm={() => cancelSchedule.mutate(j.id)}>
                        <Tag color="purple" style={{ cursor: 'pointer' }}>Balik otomatis {fmtDate(j.scheduledReversal)}</Tag>
                      </Popconfirm>
                    )}
                    <Popconfirm title="Buat jurnal balik untuk membatalkan jurnal ini? Dibalik pada tanggal jurnal asal bila periodenya masih terbuka." onConfirm={() => reverse.mutate(j.id)}>
                      <Button size="small">Balik</Button>
                    </Popconfirm>
                  </Space>
                ),
            },
          ]}
        />
      </Card>
      <Modal
        title="Jurnal manual"
        width={900}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={create.isPending}
        okText="Posting"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Space wrap>
            <Form.Item name="date" label="Tanggal" rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="reference" label="No. bukti" extra="Kuitansi / nota / memo internal">
              <Input style={{ width: 160 }} placeholder="KW-0012" />
            </Form.Item>
            <Form.Item name="description" label="Keterangan" rules={[{ required: true }]}>
              <Input style={{ width: 360, maxWidth: '100%' }} placeholder={t('Bayar sewa gudang Oktober')} />
            </Form.Item>
          </Space>
          {!!branches.data?.branches.filter((b) => b.isActive).length && (
            <Form.Item name="branchId" label="Cabang" extra="Kosong = pusat. Seluruh baris jurnal ini dimasukkan ke cabang yang dipilih.">
              <Select allowClear placeholder="Pusat" style={{ width: 280 }} options={branches.data.branches.filter((b) => b.isActive).map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} />
            </Form.Item>
          )}
          <Form.Item name="adjustment" valuePropName="checked" extra="Jurnal penyesuaian akhir periode tampil di kolom penyesuaian neraca lajur.">
            <Checkbox>Jurnal penyesuaian</Checkbox>
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.adjustment !== b.adjustment}>
            {({ getFieldValue }) =>
              getFieldValue('adjustment') ? (
                <Form.Item name="autoReverse" valuePropName="checked" extra="Untuk akrual (mis. beban masih harus dibayar): sistem membalik jurnal ini otomatis pada tanggal 1 bulan berikutnya, jadi tidak perlu membalik manual.">
                  <Checkbox>Balik otomatis di awal bulan berikutnya</Checkbox>
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Akun kontrol tidak bisa dipakai di jurnal manual"
            description="Piutang usaha, hutang usaha, persediaan, kas/bank, dan aset tetap punya rincian per dokumen; koreksinya lewat faktur, retur, penyesuaian stok, transaksi kas, atau menu Aset Tetap."
          />
          {me?.role === 'OWNER' && (
            <Form.Item name="controlOverrideReason" label="Pengecualian akun kontrol (khusus Pemilik, opsional)" extra="Isi alasan (min. 10 karakter) hanya bila benar-benar perlu memakai akun kontrol; tercatat di jejak audit.">
              <Input maxLength={300} />
            </Form.Item>
          )}
          <LinesEditor form={form} />
        </Form>
      </Modal>
    </>
  );
}

function RecurringList() {
  const [editing, setEditing] = useState<RecurringJournal | 'new' | null>(null);
  const [form] = Form.useForm();
  const accounts = useAccounts();
  const name = (id: string) => accounts.data?.find((a) => a.id === id);
  const list = useQuery({ queryKey: ['recurring'], queryFn: () => get<RecurringJournal[]>('/accounting/recurring') });
  const save = useAction(
    (v: Record<string, unknown> & { lines: LineValue[] }) => {
      const body = { ...v, endDate: v.endDate || undefined, remaining: v.remaining || undefined, lines: toLines(v.lines) };
      return editing === 'new' ? post('/accounting/recurring', body) : patch(`/accounting/recurring/${(editing as RecurringJournal).id}`, body);
    },
    { success: 'Jurnal berulang disimpan', invalidate: ['recurring'], onSuccess: () => setEditing(null) },
  );
  const toggle = useAction((r: RecurringJournal) => patch(`/accounting/recurring/${r.id}`, { isActive: !r.isActive }), { invalidate: ['recurring'] });
  const remove = useAction((id: string) => api(`/accounting/recurring/${id}`, { method: 'DELETE' }), { success: 'Dihapus', invalidate: ['recurring'] });
  const run = useAction(() => post<{ posted: { name: string; number: string; date: string }[]; errors: { name: string; error: string }[] }>('/accounting/recurring/run'), {
    success: (r) => (r.posted.length ? `${r.posted.length} jurnal diposting` : 'Tidak ada yang jatuh tempo') + (r.errors.length ? ` · ${r.errors.length} gagal: ${r.errors[0].error}` : ''),
    invalidate: ['recurring', ...LEDGER_KEYS],
  });

  return (
    <Card>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Jurnal berulang diposting otomatis setiap jatuh tempo — cocok untuk amortisasi sewa/asuransi dibayar dimuka, akrual gaji, atau angsuran pinjaman."
      />
      <Space style={{ marginBottom: 12 }} wrap>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            form.resetFields();
            form.setFieldsValue({ frequency: 'MONTHLY', nextDate: today(), isAdjustment: true, lines: [{}, {}] });
            setEditing('new');
          }}
        >
          Jurnal berulang baru
        </Button>
        <Button icon={<PlayCircleOutlined />} loading={run.isPending} onClick={() => run.mutate(undefined)}>
          Posting yang jatuh tempo sekarang
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={list.isLoading}
        dataSource={list.data}
        scroll={{ x: 900 }}
        expandable={{
          expandedRowRender: (r) => (
            <Table
              rowKey="_k"
              size="small"
              pagination={false}
              dataSource={r.lines.map((l, i) => ({ ...l, _k: i }))}
              columns={[
                { title: 'Akun', render: (_, l) => `${name(l.accountId)?.code ?? ''} · ${name(l.accountId)?.name ?? ''}` },
                { title: 'Debit', dataIndex: 'debit', align: 'right', render: (v) => (Number(v) ? fmtMoney(v) : '') },
                { title: 'Kredit', dataIndex: 'credit', align: 'right', render: (v) => (Number(v) ? fmtMoney(v) : '') },
              ]}
            />
          ),
        }}
        columns={[
          { title: 'Nama', dataIndex: 'name' },
          { title: 'Frekuensi', dataIndex: 'frequency', render: (f: keyof typeof RECURRING_FREQUENCY_LABELS) => RECURRING_FREQUENCY_LABELS[f] },
          { title: 'Berikutnya', dataIndex: 'nextDate', render: fmtDate },
          { title: 'Sisa', dataIndex: 'remaining', render: (r) => (r == null ? 'Tanpa batas' : `${r}×`) },
          { title: 'Nilai', render: (_, r) => fmtMoney(r.lines.reduce((a, l) => a + Number(l.debit ?? 0), 0)) },
          { title: 'Jenis', dataIndex: 'isAdjustment', render: (a) => (a ? <Tag color="orange">Penyesuaian</Tag> : <Tag>Biasa</Tag>) },
          { title: 'Aktif', render: (_, r) => <Switch size="small" checked={r.isActive} onChange={() => toggle.mutate(r)} /> },
          {
            render: (_, r) => (
              <Space>
                <Button
                  size="small"
                  onClick={() => {
                    form.setFieldsValue({ ...r, lines: r.lines.map((l) => ({ ...l, debit: Number(l.debit ?? 0) || undefined, credit: Number(l.credit ?? 0) || undefined })) });
                    setEditing(r);
                  }}
                >
                  Ubah
                </Button>
                <Popconfirm title="Hapus jurnal berulang? Jurnal yang sudah diposting tetap ada." onConfirm={() => remove.mutate(r.id)}>
                  <Button size="small" danger>
                    Hapus
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={editing === 'new' ? 'Jurnal berulang baru' : 'Ubah jurnal berulang'}
        width={900}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
        okText="Simpan"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Space wrap>
            <Form.Item name="name" label="Nama" rules={[{ required: true }]}>
              <Input style={{ width: 240 }} placeholder={t('Amortisasi sewa gudang')} />
            </Form.Item>
            <Form.Item name="description" label="Keterangan jurnal" rules={[{ required: true }]}>
              <Input style={{ width: 320 }} />
            </Form.Item>
          </Space>
          <Space wrap>
            <Form.Item name="frequency" label="Frekuensi">
              <Select style={{ width: 150 }} options={toOptions(RECURRING_FREQUENCY_LABELS)} />
            </Form.Item>
            <Form.Item name="nextDate" label="Tanggal posting berikutnya" rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="remaining" label="Jumlah kali (opsional)">
              <InputNumber min={1} max={600} />
            </Form.Item>
            <Form.Item name="endDate" label="Berakhir (opsional)">
              <Input type="date" />
            </Form.Item>
          </Space>
          <Form.Item name="isAdjustment" valuePropName="checked">
            <Checkbox>Jurnal penyesuaian</Checkbox>
          </Form.Item>
          <LinesEditor form={form} />
        </Form>
      </Modal>
    </Card>
  );
}

export default function JournalsPage() {
  const [params, setParams] = useSearchParams();
  return (
    <>
      <PageHeader title="Jurnal Umum" />
      <Tabs
        activeKey={params.get('tab') === 'recurring' ? 'recurring' : 'list'}
        onChange={(k) => setParams(k === 'list' ? {} : { tab: k }, { replace: true })}
        items={[
          { key: 'list', label: 'Jurnal', children: <JournalList /> },
          { key: 'recurring', label: 'Jurnal berulang', children: <RecurringList /> },
        ]}
      />
    </>
  );
}
