import { PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Empty, Form, Input, InputNumber, Modal, Row, Segmented, Select, Space, Table, Tabs, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, post } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import type { Invoice, InvoiceDetail, PurchaseInvoice, PurchaseInvoiceDetail, ReturnDoc } from '@/api/types';
import ResponsiveTable from '@/components/ResponsiveTable';
import SummaryCards from '@/components/SummaryCards';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, fmtQty, today } from '@/lib/format';
import { t } from '@/lib/terms';

type Kind = 'sales' | 'purchase';

const CFG = {
  sales: {
    label: t('Retur Penjualan'),
    party: 'Pelanggan',
    list: '/sales-returns',
    invoices: '/invoices',
    detail: (id: string) => `/invoices/${id}`,
    help: 'Barang kembali dari pelanggan: stok bertambah (nilai HPP asal), piutang berkurang. Jurnal: Retur Penjualan + PPN Keluaran (debit) / Piutang (kredit); Persediaan (debit) / HPP (kredit).',
  },
  purchase: {
    label: t('Retur Pembelian'),
    party: 'Supplier',
    list: '/purchase-returns',
    invoices: '/purchase-invoices',
    detail: (id: string) => `/purchase-invoices/${id}`,
    help: 'Barang dikembalikan ke supplier: stok berkurang, hutang berkurang. Jurnal: Hutang Usaha (debit) / Persediaan + PPN Masukan (kredit).',
  },
} as const;

type AnyInvoice = (Invoice | PurchaseInvoice) & { customer?: { name: string }; supplier?: { name: string } };
const outstanding = (i: AnyInvoice) => Number(i.total) - Number(i.paidAmount) - Number(i.returnedAmount);

function NewReturnModal({ kind, open, initialInvoice, onClose }: { kind: Kind; open: boolean; initialInvoice?: string; onClose: () => void }) {
  const cfg = CFG[kind];
  const [invoiceId, setInvoiceId] = useState<string | undefined>(initialInvoice);
  const [qty, setQty] = useState<Record<string, number | null>>({});
  const [form] = Form.useForm<{ date: string; reason?: string }>();

  useEffect(() => {
    if (open) {
      setInvoiceId(initialInvoice);
      setQty({});
      form.setFieldsValue({ date: today(), reason: undefined });
    }
  }, [open, initialInvoice, form]);

  const invoices = useQuery({
    queryKey: [kind === 'sales' ? 'invoices' : 'purchase-invoices', 'for-return'],
    queryFn: () => get<AnyInvoice[]>(cfg.invoices).then((rows) => rows.filter((r) => (r as { kind?: string }).kind !== 'BILL')),
    enabled: open,
  });
  const detail = useQuery({
    queryKey: [kind === 'sales' ? 'invoices' : 'purchase-invoices', 'detail', invoiceId],
    queryFn: () => get<InvoiceDetail | PurchaseInvoiceDetail>(cfg.detail(invoiceId!)),
    enabled: open && !!invoiceId,
  });

  const lines = detail.data?.lines ?? [];
  const unitNet = (l: (typeof lines)[number]) => Number(l.lineTotal) / Number(l.qty);
  const subtotal = lines.reduce((a, l) => a + Math.round((qty[l.id] ?? 0) * unitNet(l) * 100) / 100, 0);
  // PPN retur mengikuti rasio PPN faktur asal (sama seperti server)
  const inv = detail.data;
  const tax = inv && Number(inv.subtotal) > 0 ? Math.round((subtotal * Number(inv.taxAmount) * 100) / Number(inv.subtotal)) / 100 : 0;

  const create = useAction(
    (v: { date: string; reason?: string }) =>
      post<ReturnDoc & { journalNumber?: string }>(cfg.list, {
        ...v,
        invoiceId,
        lines: Object.entries(qty)
          .filter(([, q]) => q && q > 0)
          .map(([invoiceLineId, q]) => ({ invoiceLineId, qty: String(q) })),
      }),
    {
      success: (r) => `${cfg.label} ${r.number} diposting`,
      invalidate: [kind === 'sales' ? 'sales-returns' : 'purchase-returns', 'invoices', 'purchase-invoices', 'stock', 'stock-moves', ...LEDGER_KEYS],
      onSuccess: onClose,
    },
  );

  const options = useMemo(
    () =>
      (invoices.data ?? [])
        .filter((i) => outstanding(i) > 0 || i.id === invoiceId)
        .map((i) => ({
          value: i.id,
          label: `${i.number}${'supplierInvoiceNo' in i ? ` (${i.supplierInvoiceNo})` : ''} · ${i.customer?.name ?? i.supplier?.name} · sisa ${fmtMoney(outstanding(i))}`,
        })),
    [invoices.data, invoiceId],
  );

  return (
    <Modal
      title={`${cfg.label} baru`}
      open={open}
      width={860}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Posting retur"
      okButtonProps={{ disabled: subtotal <= 0 }}
      confirmLoading={create.isPending}
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={cfg.help} />
      <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
        <Form.Item label={t('Faktur asal')} required>
          <Select
            showSearch
            optionFilterProp="label"
            value={invoiceId}
            loading={invoices.isLoading}
            onChange={(v) => (setInvoiceId(v), setQty({}))}
            options={options}
            placeholder={t('Pilih faktur yang masih punya sisa tagihan')}
          />
        </Form.Item>
        {invoiceId && (
          <Table
            rowKey="id"
            size="small"
            loading={detail.isLoading}
            pagination={false}
            dataSource={lines}
            scroll={{ x: 650 }}
            style={{ marginBottom: 16 }}
            columns={[
              { title: t('Produk'), render: (_, l) => `${l.product.sku} · ${l.product.name}` },
              { title: t('Qty faktur'), align: 'right', render: (_, l) => `${fmtQty(l.qty)} ${l.uom}` },
              { title: 'Sudah diretur', align: 'right', render: (_, l) => fmtQty(l.returnedQty) },
              {
                title: 'Qty retur',
                width: 130,
                render: (_, l) => {
                  const max = Number(l.qty) - Number(l.returnedQty);
                  return (
                    <InputNumber
                      min={0}
                      max={max}
                      disabled={max <= 0}
                      value={qty[l.id]}
                      onChange={(v) => setQty((q) => ({ ...q, [l.id]: v }))}
                      suffix={l.uom}
                      style={{ width: '100%' }}
                    />
                  );
                },
              },
              { title: 'Nilai (DPP)', align: 'right', render: (_, l) => fmtMoney((qty[l.id] ?? 0) * unitNet(l)) },
            ]}
          />
        )}
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item name="date" label="Tanggal retur" rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
          </Col>
          <Col xs={24} md={16}>
            <Form.Item name="reason" label="Alasan">
              <Input placeholder="Kemasan rusak, salah kirim, kedaluwarsa…" />
            </Form.Item>
          </Col>
        </Row>
        <Typography.Text>
          Perkiraan nilai retur: DPP {fmtMoney(subtotal)} + PPN {fmtMoney(tax)} = <strong>{fmtMoney(subtotal + tax)}</strong>
        </Typography.Text>
        <br />
        <Typography.Text type="secondary">{t('Nilai final dihitung server berdasarkan harga & PPN faktur asal.')}</Typography.Text>
      </Form>
    </Modal>
  );
}

function ReturnList({ kind }: { kind: Kind }) {
  const cfg = CFG[kind];
  const [view, setView] = useState<'ALL' | 'MONTH'>('ALL');
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: [kind === 'sales' ? 'sales-returns' : 'purchase-returns'],
    queryFn: () => get<ReturnDoc[]>(cfg.list),
  });
  const all = data ?? [];
  const month = today().slice(0, 7);
  const thisMonth = all.filter((r) => r.date.slice(0, 7) === month);
  const sum = (xs: ReturnDoc[]) => xs.reduce((a, r) => a + Number(r.total), 0);
  const q = search.trim().toLowerCase();
  const shown = all.filter(
    (r) => (view === 'ALL' || r.date.slice(0, 7) === month) && (!q || `${r.number} ${(r.customer ?? r.supplier)?.name ?? ''} ${r.invoice.number} ${r.reason ?? ''}`.toLowerCase().includes(q)),
  );
  return (
    <>
      {!isLoading && all.length > 0 && (
        <SummaryCards
          items={[
            { label: `Total ${cfg.label.toLowerCase()}`, value: fmtMoney(sum(all)), hint: `${all.length} retur` },
            { label: 'Retur bulan ini', value: fmtMoney(sum(thisMonth)), hint: `${thisMonth.length} retur`, tone: thisMonth.length ? 'warn' : 'neutral' },
            { label: 'Jumlah retur', value: String(all.length), hint: kind === 'sales' ? 'barang kembali dari pelanggan' : 'barang kembali ke supplier' },
          ]}
        />
      )}
      <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
        <Segmented
          value={view}
          onChange={(v) => setView(v as typeof view)}
          options={[
            { value: 'ALL', label: `Semua (${all.length})` },
            { value: 'MONTH', label: `Bulan ini (${thisMonth.length})` },
          ]}
        />
        <Input.Search allowClear placeholder={`Cari ${cfg.party.toLowerCase()} atau nomor`} style={{ width: 260 }} onChange={(e) => setSearch(e.target.value)} />
      </Space>
      <ResponsiveTable<ReturnDoc>
        rowKey="id"
        loading={isLoading}
        dataSource={shown}
        scroll={{ x: 900 }}
        locale={{ emptyText: <Empty description={search || view !== 'ALL' ? 'Tidak ada data yang cocok dengan pilihan ini' : 'Belum ada retur'} /> }}
        expandable={{
          expandedRowRender: (r) => (
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={r.lines}
              columns={[
                { title: t('Produk'), render: (_, l) => `${l.product.sku} · ${l.product.name}` },
                { title: 'Qty', align: 'right', render: (_, l) => `${fmtQty(l.qty)} ${l.uom}` },
                { title: 'Nilai', dataIndex: 'lineTotal', align: 'right', render: fmtMoney },
              ]}
            />
          ),
        }}
        columns={[
          { title: 'Nomor', dataIndex: 'number' },
          { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
          { title: cfg.party, render: (_, r) => (r.customer ?? r.supplier)?.name },
          { title: t('Faktur asal'), render: (_, r) => r.invoice.number + (r.invoice.supplierInvoiceNo ? ` (${r.invoice.supplierInvoiceNo})` : '') },
          { title: 'Alasan', dataIndex: 'reason', render: (v) => v ?? '-' },
          { title: 'DPP', dataIndex: 'subtotal', align: 'right', render: fmtMoney },
          { title: 'PPN', dataIndex: 'taxAmount', align: 'right', render: fmtMoney },
          { title: 'Total', dataIndex: 'total', align: 'right', render: (v) => <strong>{fmtMoney(v)}</strong> },
        ]}
      />
    </>
  );
}

export default function ReturnsPage() {
  const [params, setParams] = useSearchParams();
  const can = useCan();
  const tab: Kind = params.get('tab') === 'purchase' ? 'purchase' : 'sales';
  const invoiceParam = params.get('invoice') ?? undefined;
  const [open, setOpen] = useState(!!invoiceParam);

  const close = () => {
    setOpen(false);
    if (invoiceParam) setParams({ tab });
  };

  return (
    <>
      <PageHeader
        title="Retur"
        extra={
          (tab === 'sales' ? can('POST', '/sales-returns') : can('POST', '/purchase-returns')) && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
              {CFG[tab].label} baru
            </Button>
          )
        }
      />
      <Card>
        <Tabs
          activeKey={tab}
          onChange={(k) => setParams({ tab: k })}
          items={(['sales', 'purchase'] as const).map((k) => ({ key: k, label: CFG[k].label, children: <ReturnList kind={k} /> }))}
        />
      </Card>
      <NewReturnModal kind={tab} open={open} initialInvoice={invoiceParam} onClose={close} />
    </>
  );
}
