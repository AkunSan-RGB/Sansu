import { PAYMENT_METHOD_LABELS, toOptions } from '@sansu/shared';
import { Form, Input, InputNumber, Modal, Select, Typography } from 'antd';
import { post } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import type { Invoice } from '@/api/types';
import CashAccountSelect from '@/components/CashAccountSelect';
import { fmtMoney, today } from '@/lib/format';

export const outstanding = (i: Pick<Invoice, 'total' | 'paidAmount' | 'returnedAmount'>) => Number(i.total) - Number(i.paidAmount) - Number(i.returnedAmount);

/** Terima pembayaran piutang — dipakai di daftar faktur & detail faktur */
export default function PaymentModal({ invoice, onClose }: { invoice: Pick<Invoice, 'id' | 'number' | 'total' | 'paidAmount' | 'returnedAmount' | 'customer'> | null; onClose: () => void }) {
  const [form] = Form.useForm();
  const pay = useAction(
    (v: { amount: number; method: string; cashAccountId?: string; date: string; notes?: string }) =>
      post<{ number: string; journalNumber: string }>('/payments', { ...v, amount: String(v.amount), invoiceId: invoice!.id }),
    {
      success: (r) => `Pembayaran ${r.number} dicatat · jurnal ${r.journalNumber}`,
      invalidate: ['invoices', 'invoice', 'customers', ...LEDGER_KEYS],
      onSuccess: onClose,
    },
  );
  return (
    <Modal
      title={invoice && `Terima pembayaran ${invoice.number}`}
      open={!!invoice}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={pay.isPending}
      okText="Posting"
      destroyOnHidden
      afterOpenChange={(o) => o && invoice && form.setFieldsValue({ amount: outstanding(invoice), method: 'CASH', cashAccountId: undefined, date: today(), notes: undefined })}
    >
      {invoice && (
        <Typography.Paragraph>
          {invoice.customer.name} · sisa tagihan <strong>{fmtMoney(outstanding(invoice))}</strong>
        </Typography.Paragraph>
      )}
      <Form form={form} layout="vertical" onFinish={(v) => pay.mutate(v)}>
        <Form.Item name="amount" label="Jumlah" rules={[{ required: true }]}>
          <InputNumber min={1} max={invoice ? outstanding(invoice) : undefined} style={{ width: '100%' }} prefix="Rp" />
        </Form.Item>
        <Form.Item name="method" label="Metode">
          <Select options={toOptions(PAYMENT_METHOD_LABELS)} />
        </Form.Item>
        <Form.Item name="cashAccountId" label="Masuk ke" extra="Kosongkan: tunai → Kas, transfer/giro → Bank utama">
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
  );
}
