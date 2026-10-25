import { type CustomerDeposit, type Invoice } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Form, Input, InputNumber, Modal, Select, Typography } from 'antd';
import { useEffect } from 'react';
import { get, post, qs } from '@/api/client';
import { useAction } from '@/api/queries';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import { t } from '@/lib/terms';
import { INVALIDATE } from './shared';

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
