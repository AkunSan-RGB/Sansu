/** Uang muka (DP) pelanggan: diterima → liabilitas; dipakai → melunasi faktur */
import { PlusOutlined } from '@ant-design/icons';
import { PAYMENT_METHOD_LABELS, toOptions, type CustomerDeposit, type Invoice, type Project } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, post, qs } from '@/api/client';
import { LEDGER_KEYS, useAction, useCustomers } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import { useAuth } from '@/auth/AuthContext';
import CashAccountSelect from '@/components/CashAccountSelect';
import ResponsiveTable from '@/components/ResponsiveTable';
import SummaryCards from '@/components/SummaryCards';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import { outputVatRate } from '@/lib/vat';
import { t } from '@/lib/terms';

const INVALIDATE = ['deposits', 'invoices', 'invoice', 'projects', 'customers', ...LEDGER_KEYS];

export default function DepositsPage() {
  const can = useCan();
  const [params] = useSearchParams();
  const [creating, setCreating] = useState(!!params.get('customerId'));
  const [applying, setApplying] = useState<CustomerDeposit | null>(null);
  const [openOnly, setOpenOnly] = useState(false);
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['deposits', 'all'],
    queryFn: () => get<CustomerDeposit[]>(`/services/deposits${qs({})}`),
  });
  const all = q.data ?? [];
  const term = search.trim().toLowerCase();
  const shown = all.filter(
    (r) => (!openOnly || Number(r.remaining) > 0) && (!term || `${r.number} ${r.customer.name} ${r.project?.name ?? ''}`.toLowerCase().includes(term)),
  );
  const left = all.filter((r) => Number(r.remaining) > 0);
  const sum = (xs: CustomerDeposit[], k: 'amount' | 'remaining') => xs.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  return (
    <>
      <PageHeader
        title={t('Uang muka pelanggan')}
        extra={
          can('POST', '/services/deposits') ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              Terima uang muka
            </Button>
          ) : undefined
        }
      />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Uang muka belum menjadi pendapatan"
        description={t('DP dicatat sebagai utang kepada pelanggan (Uang Muka Pelanggan) sampai pekerjaan ditagih. Bila PKP, PPN atas uang muka terutang saat uang diterima — terbitkan faktur pajak uang muka. Saat faktur termin terbit, pakai uang muka untuk mengurangi tagihan.')}
      />
      {!q.isLoading && all.length > 0 && (
        <SummaryCards
          items={[
            { label: 'Total uang muka diterima', value: fmtMoney(sum(all, 'amount')), hint: `${all.length} uang muka` },
            { label: 'Masih tersisa (belum dipakai)', value: fmtMoney(sum(left, 'remaining')), hint: `${left.length} uang muka`, tone: left.length ? 'warn' : 'neutral' },
            { label: 'Sudah terpakai', value: fmtMoney(sum(all, 'amount') - sum(all, 'remaining')), tone: 'good' },
          ]}
        />
      )}
      <Card>
        <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
          <Segmented
            value={openOnly ? 'OPEN' : 'ALL'}
            onChange={(v) => setOpenOnly(v === 'OPEN')}
            options={[
              { value: 'ALL', label: `Semua (${all.length})` },
              { value: 'OPEN', label: `Masih tersisa (${left.length})` },
            ]}
          />
          <Input.Search allowClear placeholder="Cari pelanggan, proyek, atau nomor" style={{ width: 260 }} onChange={(e) => setSearch(e.target.value)} />
        </Space>
        <ResponsiveTable<CustomerDeposit>
          rowKey="id"
          size="small"
          loading={q.isLoading}
          dataSource={shown}
          scroll={{ x: 800 }}
          locale={{ emptyText: <Empty description={search || openOnly ? 'Tidak ada data yang cocok dengan pilihan ini' : 'Belum ada uang muka'} /> }}
          expandable={{
            rowExpandable: (r) => !!r.applications?.length,
            expandedRowRender: (r) => (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={r.applications}
                columns={[
                  { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
                  { title: t('Dipakai untuk faktur'), render: (_, a) => a.invoice.number },
                  { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: fmtMoney },
                ]}
              />
            ),
          }}
          columns={[
            { title: 'No.', dataIndex: 'number' },
            { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
            { title: t('Pelanggan'), render: (_, r) => r.customer.name },
            { title: 'Proyek', render: (_, r) => r.project?.name ?? '-' },
            { title: 'Diterima', dataIndex: 'amount', align: 'right', render: fmtMoney },
            { title: 'PPN', dataIndex: 'taxAmount', align: 'right', render: fmtMoney },
            {
              title: 'Sisa',
              dataIndex: 'remaining',
              align: 'right',
              render: (v: string) => (Number(v) > 0 ? <b>{fmtMoney(v)}</b> : <Tag>Habis</Tag>),
            },
            {
              render: (_, r) =>
                Number(r.remaining) > 0 &&
                can('POST', '/services/deposits/:id/apply') && (
                  <Button size="small" onClick={() => setApplying(r)}>
                    Pakai untuk faktur
                  </Button>
                ),
            },
          ]}
        />
      </Card>
      <DepositModal
        open={creating}
        onClose={() => setCreating(false)}
        customerId={params.get('customerId') ?? undefined}
        projectId={params.get('projectId') ?? undefined}
      />
      <ApplyDepositModal deposit={applying} onClose={() => setApplying(null)} />
    </>
  );
}

function DepositModal({
  open,
  onClose,
  customerId,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  customerId?: string;
  projectId?: string;
}) {
  const { me } = useAuth();
  const [form] = Form.useForm();
  const { data: customers } = useCustomers();
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => get<Project[]>('/services/projects'),
    enabled: open,
  });
  const cust = Form.useWatch('customerId', form);
  const amount = Form.useWatch('amount', form) ?? 0;
  const withVat = Form.useWatch('withVat', form) ?? true;
  const rate = withVat ? outputVatRate(me) : 0;
  const dpp = rate ? Math.round((amount * 10000) / (100 + rate)) / 100 : amount;
  useEffect(() => {
    if (open) form.setFieldsValue({ customerId, projectId, date: today(), method: 'TRANSFER', withVat: true });
  }, [open, customerId, projectId, form]);
  const save = useAction(
    (v: {
      customerId: string;
      projectId?: string;
      amount: number;
      date: string;
      method: string;
      cashAccountId?: string;
      withVat: boolean;
      description?: string;
    }) => post<{ number: string; journalNumber: string }>('/services/deposits', { ...v, amount: String(v.amount) }),
    {
      success: (r) => `Uang muka ${r.number} dicatat · jurnal ${r.journalNumber}`,
      invalidate: INVALIDATE,
      onSuccess: onClose,
    },
  );
  return (
    <Modal
      title={t('Terima uang muka pelanggan')}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={save.isPending}
      okText="Posting"
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
        <Form.Item name="customerId" label={t('Pelanggan')} rules={[{ required: true }]}>
          <Select
            showSearch
            optionFilterProp="label"
            options={customers?.filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
          />
        </Form.Item>
        <Form.Item name="projectId" label="Proyek (opsional)">
          <Select
            allowClear
            options={(projects.data ?? [])
              .filter((p) => p.customerId === cust)
              .map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
          />
        </Form.Item>
        <Form.Item name="amount" label="Jumlah diterima" rules={[{ required: true }]}>
          <InputNumber min={1} style={{ width: '100%' }} prefix="Rp" />
        </Form.Item>
        {outputVatRate(me) > 0 && (
          <Form.Item
            name="withVat"
            valuePropName="checked"
            extra={withVat && amount ? `DPP ${fmtMoney(dpp)} + PPN ${fmtMoney(amount - dpp)}` : undefined}
          >
            <Checkbox>Sudah termasuk PPN {outputVatRate(me)}% (faktur pajak uang muka)</Checkbox>
          </Form.Item>
        )}
        <Space wrap>
          <Form.Item name="method" label="Metode">
            <Select style={{ width: 160 }} options={toOptions(PAYMENT_METHOD_LABELS)} />
          </Form.Item>
          <Form.Item name="cashAccountId" label="Masuk ke">
            <CashAccountSelect allowClear style={{ width: 220 }} />
          </Form.Item>
          <Form.Item name="date" label="Tanggal">
            <Input type="date" />
          </Form.Item>
        </Space>
        <Form.Item name="description" label="Keterangan">
          <Input placeholder="Mis. DP 30% sesuai SPK No. 12" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** Pakai uang muka untuk melunasi faktur. Dari halaman uang muka (deposit dipilih) atau dari faktur (invoice dipilih). */
export function ApplyDepositModal({
  deposit,
  invoice,
  onClose,
}: {
  deposit?: CustomerDeposit | null;
  invoice?:
    (Pick<Invoice, 'id' | 'number' | 'total' | 'paidAmount' | 'returnedAmount'> & { customerId?: string }) | null;
  onClose: () => void;
}) {
  const open = !!deposit || !!invoice;
  const [form] = Form.useForm();
  const customerId = deposit?.customerId ?? invoice?.customerId;
  const invoices = useQuery({
    queryKey: ['invoices', 'open', customerId],
    queryFn: () => get<(Invoice & { customerId: string })[]>(`/invoices${qs({ customerId })}`),
    enabled: !!deposit,
  });
  const deposits = useQuery({
    queryKey: ['deposits', 'open', customerId],
    queryFn: () => get<CustomerDeposit[]>(`/services/deposits${qs({ customerId, open: '1' })}`),
    enabled: !!invoice,
  });
  const openInvoices = (invoices.data ?? []).filter((i) => i.status !== 'PAID');
  const depId = Form.useWatch('depositId', form);
  const invId = Form.useWatch('invoiceId', form);
  const dep = deposit ?? deposits.data?.find((d) => d.id === depId);
  const inv = invoice ?? openInvoices.find((i) => i.id === invId);
  const rest = inv ? Number(inv.total) - Number(inv.paidAmount) - Number(inv.returnedAmount) : 0;
  const max = dep && inv ? Math.min(Number(dep.remaining), rest) : undefined;
  useEffect(() => {
    if (max !== undefined) form.setFieldValue('amount', max);
  }, [max, form]);
  const save = useAction(
    (v: { depositId?: string; invoiceId?: string; amount: number; date: string }) =>
      post<{ number: string; journalNumber: string }>(`/services/deposits/${deposit?.id ?? v.depositId}/apply`, {
        invoiceId: invoice?.id ?? v.invoiceId,
        amount: String(v.amount),
        date: v.date,
      }),
    {
      success: (r) => `Uang muka dipakai (${r.number}) · jurnal ${r.journalNumber}`,
      invalidate: INVALIDATE,
      onSuccess: onClose,
    },
  );
  return (
    <Modal
      title={deposit ? `Pakai uang muka ${deposit.number}` : `Pakai uang muka untuk ${invoice?.number}`}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={save.isPending}
      okText="Posting"
      destroyOnHidden
      afterOpenChange={(o) => o && form.setFieldsValue({ date: today(), depositId: undefined, invoiceId: undefined })}
    >
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
        {deposit ? (
          <Form.Item
            name="invoiceId"
            label={t('Faktur yang dilunasi')}
            rules={[{ required: true }]}
            extra={`Sisa uang muka ${fmtMoney(deposit.remaining)}`}
          >
            <Select
              loading={invoices.isLoading}
              options={openInvoices.map((i) => ({
                value: i.id,
                label: `${i.number} · ${fmtDate(i.date)} · sisa ${fmtMoney(Number(i.total) - Number(i.paidAmount) - Number(i.returnedAmount))}`,
              }))}
              notFoundContent="Tidak ada faktur terbuka untuk pelanggan ini"
            />
          </Form.Item>
        ) : (
          <Form.Item
            name="depositId"
            label="Uang muka"
            rules={[{ required: true }]}
            extra={`Sisa tagihan ${fmtMoney(rest)}`}
          >
            <Select
              loading={deposits.isLoading}
              options={(deposits.data ?? []).map((d) => ({
                value: d.id,
                label: `${d.number} · ${fmtDate(d.date)} · sisa ${fmtMoney(d.remaining)}`,
              }))}
              notFoundContent="Pelanggan ini tidak punya uang muka tersisa"
            />
          </Form.Item>
        )}
        <Form.Item name="amount" label="Jumlah dipakai" rules={[{ required: true }]}>
          <InputNumber min={1} max={max} style={{ width: '100%' }} prefix="Rp" />
        </Form.Item>
        <Form.Item name="date" label="Tanggal">
          <Input type="date" />
        </Form.Item>
        <Typography.Text type="secondary">
          Jurnal: Dr Uang Muka Pelanggan (DPP) & PPN Keluaran (PPN uang muka) · Cr Piutang Usaha.
        </Typography.Text>
      </Form>
    </Modal>
  );
}
