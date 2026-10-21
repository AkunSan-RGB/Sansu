import { canHandleMoney, isForeignCurrency } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Empty, Form, Input, InputNumber, Modal, Segmented, Space, Tabs, Tag, Tooltip, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useCan } from '@/auth/useCan';
import { useNavigate } from 'react-router-dom';
import { get, post, qs } from '@/api/client';
import { useHasRole } from '@/lib/roles';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import type { AgingRow, PurchaseInvoice } from '@/api/types';
import AgingTable from '@/components/AgingTable';
import CashAccountSelect from '@/components/CashAccountSelect';
import FxPaymentFields from '@/components/FxPaymentFields';
import PageHeader from '@/layout/PageHeader';
import { fmtCurrency, fmtDate, fmtMoney, today } from '@/lib/format';
import { InvoiceStatusTag } from '../sales/status';
import BillModal from './BillModal';
import PriceVarianceReport from './PriceVarianceReport';
import ResponsiveTable from '@/components/ResponsiveTable';
import SummaryCards from '@/components/SummaryCards';
import { DueLabel } from '@/lib/due';
import { t } from '@/lib/terms';

interface SupplierPayment {
  id: string;
  number: string;
  date: string;
  amount: string;
  notes: string | null;
  supplier: { code: string; name: string };
  invoice: { number: string; supplierInvoiceNo: string };
  cashAccount: { code: string; name: string } | null;
  status?: 'POSTED' | 'VOID';
  voidReason?: string | null;
}

export const apOutstanding = (i: PurchaseInvoice) => Number(i.total) - Number(i.paidAmount) - Number(i.returnedAmount);
/** Sisa hutang dalam mata uang faktur */
const apOutstandingForeign = (i: PurchaseInvoice) => Number(i.totalForeign ?? 0) - Number(i.paidForeign ?? 0) - Number(i.returnedForeign ?? 0);

export default function PurchaseInvoicesPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<'OPEN' | 'OVERDUE' | 'PAID' | 'ALL'>('OPEN');
  const [search, setSearch] = useState('');
  const [paying, setPaying] = useState<PurchaseInvoice | null>(null);
  const [billOpen, setBillOpen] = useState(false);
  const [form] = Form.useForm();
  const { me } = useAuth();
  const can = useCan();
  const canVoid = (me?.role === 'OWNER' || me?.role === 'ADMIN') && can('POST', '/purchase-invoices/payments/:id/void');
  const [voiding, setVoiding] = useState<SupplierPayment | null>(null);
  const [voidForm] = Form.useForm<{ reason: string }>();

  const invoices = useQuery({
    queryKey: ['purchase-invoices', 'all'],
    queryFn: () => get<PurchaseInvoice[]>(`/purchase-invoices${qs({})}`),
  });
  const aging = useQuery({ queryKey: ['purchase-invoices', 'aging'], enabled: useHasRole(['ADMIN', 'FINANCE', 'ACCOUNTANT']), queryFn: () => get<AgingRow[]>('/purchase-invoices/reports/ap-aging') });
  const payments = useQuery({ queryKey: ['purchase-invoices', 'payments'], enabled: useHasRole(['ADMIN', 'FINANCE', 'ACCOUNTANT']), queryFn: () => get<SupplierPayment[]>('/purchase-invoices/payments') });

  const pay = useAction(
    (v: { amount: number; cashAccountId?: string; date: string; notes?: string; fxRate?: number }) =>
      post<{ number: string; journalNumber: string }>('/purchase-invoices/payments', {
        ...v,
        amount: String(v.amount),
        fxRate: v.fxRate ? String(v.fxRate) : undefined,
        purchaseInvoiceId: paying!.id,
      }),
    {
      success: (r) => `Pembayaran ${r.number} dicatat · jurnal ${r.journalNumber}`,
      invalidate: ['purchase-invoices', 'suppliers', ...LEDGER_KEYS],
      onSuccess: () => setPaying(null),
    },
  );

  const doVoid = useAction((v: { id: string; reason: string }) => post(`/purchase-invoices/payments/${v.id}/void`, { reason: v.reason }), {
    success: 'Pembayaran dibatalkan (jurnal pembalik dibuat, hutang terbuka lagi)',
    invalidate: ['purchase-invoices', 'suppliers', ...LEDGER_KEYS],
    onSuccess: () => setVoiding(null),
  });

  const isOverdue = (i: PurchaseInvoice) => i.status !== 'PAID' && i.dueDate < today();
  const all = invoices.data ?? [];
  const open = all.filter((i) => i.status !== 'PAID');
  const sum = (xs: PurchaseInvoice[]) => xs.reduce((a, i) => a + apOutstanding(i), 0);
  const overdue = open.filter(isOverdue);
  const soon = open.filter((i) => !isOverdue(i) && i.dueDate <= dayjs(today()).add(7, 'day').format('YYYY-MM-DD'));
  const shown = all.filter((i) => {
    const q = search.trim().toLowerCase();
    const okView = view === 'ALL' || (view === 'OPEN' && i.status !== 'PAID') || (view === 'OVERDUE' && isOverdue(i)) || (view === 'PAID' && i.status === 'PAID');
    return okView && (!q || `${i.number} ${i.supplierInvoiceNo} ${i.supplier.name}`.toLowerCase().includes(q));
  });

  return (
    <>
      <PageHeader
        title={t('Faktur Pembelian & Hutang')}
        extra={
          canHandleMoney(me?.role) && can('POST', '/purchase-invoices/bills') && (
            <Button icon={<PlusOutlined />} onClick={() => setBillOpen(true)}>
              Catat tagihan biaya / aset
            </Button>
          )
        }
      />
      <BillModal open={billOpen} onClose={() => setBillOpen(false)} />
      <Card>
        <Tabs
          items={[
            {
              key: 'list',
              label: 'Faktur supplier',
              children: (
                <>
                  <SummaryCards
                    items={[
                      { label: 'Total hutang ke supplier', value: fmtMoney(sum(open)), hint: `${open.length} faktur belum lunas`, tone: 'neutral', onClick: () => setView('OPEN'), active: view === 'OPEN' },
                      { label: 'Sudah lewat jatuh tempo', value: fmtMoney(sum(overdue)), hint: `${overdue.length} faktur`, tone: overdue.length ? 'bad' : 'neutral', onClick: () => setView('OVERDUE'), active: view === 'OVERDUE' },
                      { label: 'Jatuh tempo 7 hari ke depan', value: fmtMoney(sum(soon)), hint: `${soon.length} faktur — siapkan dana`, tone: soon.length ? 'warn' : 'neutral' },
                    ]}
                  />
                  <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
                    <Segmented
                      value={view}
                      onChange={(v) => setView(v as typeof view)}
                      options={[{ value: 'OPEN', label: 'Belum lunas' }, { value: 'OVERDUE', label: 'Telat' }, { value: 'PAID', label: 'Lunas' }, { value: 'ALL', label: 'Semua' }]}
                    />
                    <Input.Search allowClear placeholder="Cari supplier atau nomor faktur" style={{ width: 260 }} onChange={(e) => setSearch(e.target.value)} />
                  </Space>
                  <ResponsiveTable
                    rowKey="id"
                    loading={invoices.isLoading}
                    dataSource={shown}
                    scroll={{ x: 820 }}
                    locale={{ emptyText: <Empty description={view === 'OPEN' ? 'Tidak ada hutang yang belum lunas' : 'Tidak ada faktur pada pilihan ini'} /> }}
                    columns={[
                      {
                        title: 'Faktur',
                        dataIndex: 'number',
                        render: (n: string, i: PurchaseInvoice) => (
                          <div>
                            <div>{n}</div>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {i.supplierInvoiceNo} · {fmtDate(i.date)}
                            </Typography.Text>
                          </div>
                        ),
                      },
                      {
                        title: t('Supplier'),
                        render: (_: unknown, i: PurchaseInvoice) => (
                          <div>
                            <div>{i.supplier.name}</div>
                            {i.kind === 'BILL' ? (
                              <Tooltip title={i.description}><Tag color="purple">Biaya / aset</Tag></Tooltip>
                            ) : i.kind === 'OPENING' ? (
                              <Tooltip title="Utang dari sistem lama (saldo awal)"><Tag color="gold">Saldo awal</Tag></Tooltip>
                            ) : Number(i.priceVariance ?? 0) !== 0 ? (
                              <Tooltip title={`Harga faktur ${Number(i.priceVariance) > 0 ? 'lebih mahal' : 'lebih murah'} ${fmtMoney(Math.abs(Number(i.priceVariance)))} dari PO (sebelum PPN); biaya perolehan stok mengikuti faktur`}>
                                <Tag color={Number(i.priceVariance) > 0 ? 'orange' : 'green'}>Harga {Number(i.priceVariance) > 0 ? 'naik' : 'turun'}</Tag>
                              </Tooltip>
                            ) : null}
                          </div>
                        ),
                      },
                      { title: 'Jatuh tempo', dataIndex: 'dueDate', render: (d: string, i: PurchaseInvoice) => <DueLabel dueDate={d} paid={i.status === 'PAID'} /> },
                      {
                        title: 'Total',
                        dataIndex: 'total',
                        align: 'right',
                        render: (v: string, i: PurchaseInvoice) =>
                          isForeignCurrency(i.currency) ? (
                            <>
                              {fmtMoney(v)}
                              <div style={{ fontSize: 11, color: '#64748b' }}>{fmtCurrency(i.totalForeign, i.currency)}</div>
                            </>
                          ) : Number(i.withholdingAmount ?? 0) > 0 ? (
                            <Tooltip title={`Setelah dipotong ${i.withholdingType === 'PPH4_2' ? 'PPh 4(2)' : 'PPh 23'} ${fmtMoney(i.withholdingAmount)}`}>{fmtMoney(v)}*</Tooltip>
                          ) : (
                            fmtMoney(v)
                          ),
                      },
                      {
                        title: 'Sisa hutang',
                        align: 'right',
                        render: (_: unknown, i: PurchaseInvoice) => (i.status === 'PAID' ? <InvoiceStatusTag status={i.status} /> : <Typography.Text strong type={isOverdue(i) ? 'danger' : undefined}>{fmtMoney(apOutstanding(i))}</Typography.Text>),
                      },
                      {
                        title: '',
                        render: (_: unknown, i: PurchaseInvoice) =>
                          i.status !== 'PAID' && (
                            <Space>
                              {canHandleMoney(me?.role) && can('POST', '/purchase-invoices/payments') && (
                              <Button
                                size="small"
                                type="primary"
                                onClick={() => {
                                  form.setFieldsValue({ amount: isForeignCurrency(i.currency) ? apOutstandingForeign(i) : apOutstanding(i), cashAccountId: undefined, date: today(), notes: undefined });
                                  setPaying(i);
                                }}
                              >
                                Bayar
                              </Button>
                              )}
                              {i.kind === 'GOODS' && can('POST', '/purchase-returns') && (
                                <Button size="small" onClick={() => navigate(`/returns?tab=purchase&invoice=${i.id}`)}>
                                  Retur
                                </Button>
                              )}
                            </Space>
                          ),
                      },
                    ]}
                  />
                </>
              ),
            },
            {
              key: 'variance',
              label: 'Selisih harga',
              children: <PriceVarianceReport />,
            },
            {
              key: 'aging',
              label: 'Umur hutang',
              children: <AgingTable rows={aging.data} loading={aging.isLoading} partyLabel="Supplier" />,
            },
            {
              key: 'payments',
              label: 'Riwayat bayar',
              children: (
                <ResponsiveTable
                  rowKey="id"
                  loading={payments.isLoading}
                  dataSource={payments.data}
                  scroll={{ x: 800 }}
                  columns={[
                    { title: 'Nomor', dataIndex: 'number' },
                    { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
                    { title: t('Supplier'), render: (_, p) => p.supplier.name },
                    { title: t('Faktur'), render: (_, p) => `${p.invoice.number} (${p.invoice.supplierInvoiceNo})` },
                    { title: 'Dari', render: (_, p) => p.cashAccount?.name ?? '-' },
                    { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: fmtMoney },
                    {
                      title: '',
                      render: (_: unknown, p: SupplierPayment) =>
                        p.status === 'VOID' ? (
                          <Tag title={p.voidReason ?? undefined}>Dibatalkan</Tag>
                        ) : canVoid ? (
                          <Button
                            size="small"
                            danger
                            type="text"
                            onClick={() => {
                              voidForm.resetFields();
                              setVoiding(p);
                            }}
                          >
                            Batalkan
                          </Button>
                        ) : null,
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>

      <Modal title={`Batalkan ${voiding?.number ?? ''}`} open={!!voiding} onCancel={() => setVoiding(null)} onOk={() => voidForm.submit()} confirmLoading={doVoid.isPending} okText="Batalkan pembayaran" okButtonProps={{ danger: true }}>
        <Typography.Paragraph type="secondary">
          Pembayaran tidak dihapus: SANSU membuat jurnal pembalik, hutang faktur terbuka lagi, dan alasan serta pelakunya tercatat di jejak audit. Tidak bisa dibatalkan bila sudah dicocokkan dengan mutasi bank.
        </Typography.Paragraph>
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Ini hanya mengoreksi pembukuan, bukan menarik uang kembali"
          description="Salah catat dan uang belum keluar: batalkan, lalu bayar ulang dengan benar. Kalau uang sudah benar-benar terkirim ke supplier, jangan dibatalkan: minta pengembalian dari supplier, lalu catat sebagai Uang masuk di Kas & Bank. Membatalkan pembayaran yang uangnya sudah keluar membuat saldo di SANSU lebih besar dari saldo bank asli."
        />
        <Form form={voidForm} layout="vertical" onFinish={(v) => voiding && doVoid.mutate({ id: voiding.id, reason: v.reason })}>
          <Form.Item name="reason" label="Alasan pembatalan" rules={[{ required: true, min: 5, message: 'Isi alasan (min. 5 karakter)' }]}>
            <Input.TextArea rows={3} maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={paying && `Bayar hutang ${paying.number}`}
        open={!!paying}
        onCancel={() => setPaying(null)}
        onOk={() => form.submit()}
        confirmLoading={pay.isPending}
        okText="Posting"
      >
        {paying && (
          <Typography.Paragraph>
            {paying.supplier.name} · faktur {paying.supplierInvoiceNo} · sisa hutang{' '}
            <strong>{isForeignCurrency(paying.currency) ? `${fmtCurrency(apOutstandingForeign(paying), paying.currency)} (nilai tercatat ${fmtMoney(apOutstanding(paying))})` : fmtMoney(apOutstanding(paying))}</strong>
          </Typography.Paragraph>
        )}
        <Form form={form} layout="vertical" onFinish={(v) => pay.mutate(v)}>
          <Form.Item name="amount" label="Jumlah" rules={[{ required: true }]}>
            {paying && isForeignCurrency(paying.currency) ? (
              <InputNumber min={0.01} precision={2} max={apOutstandingForeign(paying)} style={{ width: '100%' }} prefix={paying.currency} />
            ) : (
              <InputNumber min={1} max={paying ? apOutstanding(paying) : undefined} style={{ width: '100%' }} prefix="Rp" />
            )}
          </Form.Item>
          {paying && isForeignCurrency(paying.currency) && (
            <FxPaymentFields form={form} currency={paying.currency!} invoiceRate={Number(paying.fxRate)} outstandingForeign={apOutstandingForeign(paying)} outstandingIdr={apOutstanding(paying)} receivable={false} />
          )}
          <Form.Item name="cashAccountId" label="Dibayar dari" extra="Kosongkan untuk memakai rekening bank utama">
            <CashAccountSelect allowClear />
          </Form.Item>
          <Form.Item name="date" label="Tanggal">
            <Input type="date" />
          </Form.Item>
          <Form.Item name="notes" label="Catatan">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
