import { useQuery } from '@tanstack/react-query';
import { PlusOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, InputNumber, Modal, Select, Space, Tabs, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, qs } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import type { AgingRow, PurchaseInvoice } from '@/api/types';
import AgingTable from '@/components/AgingTable';
import CashAccountSelect from '@/components/CashAccountSelect';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import { INV_STATUS_OPTIONS, InvoiceStatusTag } from '../sales/status';
import BillModal from './BillModal';
import ResponsiveTable from '@/components/ResponsiveTable';
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
}

export const apOutstanding = (i: PurchaseInvoice) => Number(i.total) - Number(i.paidAmount) - Number(i.returnedAmount);

export default function PurchaseInvoicesPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<string>();
  const [paying, setPaying] = useState<PurchaseInvoice | null>(null);
  const [billOpen, setBillOpen] = useState(false);
  const [form] = Form.useForm();

  const invoices = useQuery({
    queryKey: ['purchase-invoices', status],
    queryFn: () => get<PurchaseInvoice[]>(`/purchase-invoices${qs({ status })}`),
  });
  const aging = useQuery({ queryKey: ['purchase-invoices', 'aging'], queryFn: () => get<AgingRow[]>('/purchase-invoices/reports/ap-aging') });
  const payments = useQuery({ queryKey: ['purchase-invoices', 'payments'], queryFn: () => get<SupplierPayment[]>('/purchase-invoices/payments') });

  const pay = useAction(
    (v: { amount: number; cashAccountId?: string; date: string; notes?: string }) =>
      post<{ number: string; journalNumber: string }>('/purchase-invoices/payments', {
        ...v,
        amount: String(v.amount),
        purchaseInvoiceId: paying!.id,
      }),
    {
      success: (r) => `Pembayaran ${r.number} dicatat · jurnal ${r.journalNumber}`,
      invalidate: ['purchase-invoices', 'suppliers', ...LEDGER_KEYS],
      onSuccess: () => setPaying(null),
    },
  );

  const isOverdue = (i: PurchaseInvoice) => i.status !== 'PAID' && i.dueDate < today();

  return (
    <>
      <PageHeader
        title="Faktur Pembelian & Hutang"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setBillOpen(true)}>
            Tagihan biaya / aset
          </Button>
        }
      />
      <BillModal open={billOpen} onClose={() => setBillOpen(false)} />
      <Card>
        <Tabs
          items={[
            {
              key: 'list',
              label: 'Daftar faktur',
              children: (
                <>
                  <Select allowClear placeholder="Semua status" style={{ width: 200, marginBottom: 12 }} options={INV_STATUS_OPTIONS} onChange={setStatus} />
                  <ResponsiveTable
                    rowKey="id"
                    loading={invoices.isLoading}
                    dataSource={invoices.data}
                    scroll={{ x: 1250 }}
                    columns={[
                      { title: 'Nomor', dataIndex: 'number' },
                      { title: 'No. faktur supplier', dataIndex: 'supplierInvoiceNo' },
                      {
                        title: 'Jenis',
                        dataIndex: 'kind',
                        render: (k, i) =>
                          k === 'BILL' ? (
                            <Tooltip title={i.description}>
                              <Tag color="purple">Biaya / aset</Tag>
                            </Tooltip>
                          ) : k === 'OPENING' ? (
                            <Tooltip title="Utang dari sistem lama (saldo awal)">
                              <Tag color="gold">Saldo awal</Tag>
                            </Tooltip>
                          ) : (
                            <Tag>Barang</Tag>
                          ),
                      },
                      { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
                      {
                        title: 'Jatuh tempo',
                        dataIndex: 'dueDate',
                        render: (d, i) => (isOverdue(i) ? <Tag color="red">{fmtDate(d)}</Tag> : fmtDate(d)),
                      },
                      { title: t('Supplier'), render: (_, i) => i.supplier.name },
                      {
                        title: 'Total',
                        dataIndex: 'total',
                        align: 'right',
                        render: (v, i) =>
                          Number(i.withholdingAmount ?? 0) > 0 ? (
                            <Tooltip title={`Setelah dipotong ${i.withholdingType === 'PPH4_2' ? 'PPh 4(2)' : 'PPh 23'} ${fmtMoney(i.withholdingAmount)}`}>
                              {fmtMoney(v)}*
                            </Tooltip>
                          ) : (
                            fmtMoney(v)
                          ),
                      },
                      { title: 'Sisa hutang', align: 'right', render: (_, i) => fmtMoney(apOutstanding(i)) },
                      { title: 'Status', dataIndex: 'status', render: (s) => <InvoiceStatusTag status={s} /> },
                      {
                        render: (_, i) =>
                          i.status !== 'PAID' && (
                            <Space>
                              <Button
                                size="small"
                                type="primary"
                                onClick={() => {
                                  form.setFieldsValue({ amount: apOutstanding(i), cashAccountId: undefined, date: today(), notes: undefined });
                                  setPaying(i);
                                }}
                              >
                                Bayar
                              </Button>
                              {i.kind === 'GOODS' && (
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
              key: 'aging',
              label: 'Umur hutang',
              children: <AgingTable rows={aging.data} loading={aging.isLoading} partyLabel="Supplier" />,
            },
            {
              key: 'payments',
              label: 'Riwayat pembayaran',
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
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>

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
            {paying.supplier.name} · faktur {paying.supplierInvoiceNo} · sisa hutang <strong>{fmtMoney(apOutstanding(paying))}</strong>
          </Typography.Paragraph>
        )}
        <Form form={form} layout="vertical" onFinish={(v) => pay.mutate(v)}>
          <Form.Item name="amount" label="Jumlah" rules={[{ required: true }]}>
            <InputNumber min={1} max={paying ? apOutstanding(paying) : undefined} style={{ width: '100%' }} prefix="Rp" />
          </Form.Item>
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
