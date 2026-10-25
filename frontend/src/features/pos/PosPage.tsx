import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Form, InputNumber, Select, Spin, Typography } from 'antd';
import { useEffect } from 'react';
import { get, post } from '@/api/client';
import { useAction, useWarehouses } from '@/api/queries';
import type { PosSession } from '@/api/types';
import CashAccountSelect from '@/components/CashAccountSelect';
import { t } from '@/lib/terms';
import { Register } from './pos/Register';

// ---------- Buka sesi ----------
function OpenSession() {
  const { data: warehouses } = useWarehouses();
  const [form] = Form.useForm();
  const qc = useQueryClient();
  useEffect(() => {
    if (warehouses?.length && !form.getFieldValue('warehouseId')) form.setFieldValue('warehouseId', warehouses[0].id);
  }, [warehouses, form]);
  const open = useAction(
    (v: { warehouseId: string; cashAccountId?: string; bankAccountId?: string; openingCash: number }) =>
      post<PosSession>('/pos/sessions', { ...v, openingCash: String(v.openingCash ?? 0) }),
    { success: (s) => `Sesi ${s.number} dibuka`, onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-session'] }) },
  );
  return (
    <div style={{ maxWidth: 460, margin: '48px auto', padding: 16 }}>
      <Card title="Buka kasir">
        <Typography.Paragraph type="secondary">Hitung uang modal di laci sebelum mulai berjualan.</Typography.Paragraph>
        <Form form={form} layout="vertical" initialValues={{ openingCash: 0 }} onFinish={(v) => open.mutate(v)}>
          <Form.Item name="warehouseId" label={t('Gudang (stok diambil dari sini)')} rules={[{ required: true }]}>
            <Select options={warehouses?.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
          </Form.Item>
          <Form.Item name="openingCash" label="Modal awal di laci">
            <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" size="large" />
          </Form.Item>
          <Form.Item name="cashAccountId" label="Akun kas laci" extra="Kosongkan = Kas">
            <CashAccountSelect allowClear />
          </Form.Item>
          <Form.Item name="bankAccountId" label="Rekening QRIS / debit / transfer" extra="Kosongkan = Bank">
            <CashAccountSelect allowClear />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={open.isPending}>
            Mulai jualan
          </Button>
        </Form>
      </Card>
    </div>
  );
}

/** Kasir layar penuh: buka sesi → jual → tutup kasir */
export default function PosPage() {
  const { data, isLoading } = useQuery({ queryKey: ['pos-session'], queryFn: () => get<PosSession | null>('/pos/sessions/current') });
  if (isLoading) return <Spin fullscreen />;
  return data ? <Register session={data} /> : <OpenSession />;
}
