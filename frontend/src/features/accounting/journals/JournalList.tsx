import { Link, useSearchParams } from 'react-router-dom';
import { PlusOutlined } from '@ant-design/icons';
import { canBookkeep, JOURNAL_SOURCE_LABELS, type JournalSource, toOptions } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, Checkbox, Empty, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { useAuth } from '@/auth/AuthContext';
import { useState } from 'react';
import { ApiError, get, post, qs, del } from '@/api/client';
import { LEDGER_KEYS, useAction, useBranches } from '@/api/queries';
import { withBudgetOverride } from '@/lib/budgetOverride';
import type { JournalEntry } from '@/api/types';
import SummaryCards from '@/components/SummaryCards';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import { t } from '@/lib/terms';
import { LineValue, toLines } from './shared';
import { LinesEditor } from './LinesEditor';

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

export function JournalList() {
  const [initial] = useSearchParams();
  const [filter, setFilter] = useState<{ from?: string; to?: string; source?: string; q?: string }>({ q: initial.get('q') || undefined, from: initial.get('from') || undefined, to: initial.get('to') || undefined });
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

  const rowsAll = journals.data ?? [];
  const totalValue = rowsAll.reduce((a, j) => a + j.lines.reduce((b, l) => b + Number(l.debit), 0), 0);
  const adjCount = rowsAll.filter((j) => j.sourceType === 'ADJUSTMENT').length;

  return (
    <>
      {!journals.isLoading && rowsAll.length > 0 && (
        <SummaryCards
          items={[
            { label: 'Jumlah jurnal', value: rowsAll.length, hint: 'sesuai pencarian di bawah' },
            { label: 'Total nilai jurnal', value: fmtMoney(totalValue) },
            { label: 'Jurnal penyesuaian', value: adjCount, tone: adjCount ? 'warn' : 'neutral' },
          ]}
        />
      )}
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
          {canBookkeep(me?.role) && (
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
          )}
        </Space>
        <Table
          rowKey="id"
          loading={journals.isLoading}
          dataSource={journals.data}
          scroll={{ x: 900 }}
          locale={{ emptyText: <Empty description="Belum ada jurnal untuk pilihan ini" /> }}
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
            { title: 'Tanggal', dataIndex: 'date', render: fmtDate, width: 130 },
            { title: 'Keterangan', dataIndex: 'description' },
            { title: 'No. bukti', dataIndex: 'reference', render: (r) => r ?? <Typography.Text type="secondary">—</Typography.Text> },
            { title: 'Jenis', dataIndex: 'sourceType', render: (s: JournalSource) => <Tag color={SOURCE_COLOR[s]}>{JOURNAL_SOURCE_LABELS[s] ?? s}</Tag> },
            { title: 'Nilai', align: 'right', render: (_, j) => fmtMoney(j.lines.reduce((a, l) => a + Number(l.debit), 0)) },
            {
              title: 'Dokumen asal',
              width: 130,
              render: (_, j) => (j.docRoute ? <Link to={j.docRoute} style={{ whiteSpace: 'nowrap' }}>Buka dokumen</Link> : <Typography.Text type="secondary">—</Typography.Text>),
            },
            {
              render: (_, j) =>
                canBookkeep(me?.role) &&
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
        forceRender
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
