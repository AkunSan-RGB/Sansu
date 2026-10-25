import { PAYMENT_METHOD_LABELS, toOptions, type Project } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Checkbox, Form, Input, InputNumber, Modal, Select, Space } from 'antd';
import { useEffect } from 'react';
import { get, post } from '@/api/client';
import { useAction, useCustomers } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import CashAccountSelect from '@/components/CashAccountSelect';
import { fmtMoney, today } from '@/lib/format';
import { outputVatRate } from '@/lib/vat';
import { t } from '@/lib/terms';
import { INVALIDATE } from './shared';

export function DepositModal({
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
