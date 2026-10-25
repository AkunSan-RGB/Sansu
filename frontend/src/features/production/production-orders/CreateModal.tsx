import { type Bom, type ProductionOrder } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Form, Input, InputNumber, Modal, Select, Space } from 'antd';
import { useEffect } from 'react';
import { get, post } from '@/api/client';
import { useAction, useWarehouses } from '@/api/queries';
import { fmtMoney, fmtQty, today } from '@/lib/format';
import { t } from '@/lib/terms';

export function CreateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (o: ProductionOrder) => void;
}) {
  const [form] = Form.useForm();
  const boms = useQuery({ queryKey: ['boms'], queryFn: () => get<Bom[]>('/production/boms'), enabled: open });
  const { data: warehouses } = useWarehouses();
  const bomId = Form.useWatch('bomId', form);
  const batches = Form.useWatch('batches', form) ?? 0;
  const bom = boms.data?.find((b) => b.id === bomId);
  useEffect(() => {
    if (open) form.setFieldsValue({ date: today(), batches: 1, warehouseId: warehouses?.[0]?.id });
  }, [open, warehouses, form]);
  const save = useAction(
    (v: { bomId: string; warehouseId: string; date: string; batches: number; notes?: string }) =>
      post<ProductionOrder>('/production/orders', { ...v, batches: String(v.batches) }),
    {
      success: (o) => `${o.number} dibuat`,
      invalidate: ['production'],
      onSuccess: (o) => {
        onClose();
        onCreated(o);
      },
    },
  );
  return (
    <Modal
      title="Perintah produksi baru"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={save.isPending}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
        <Form.Item name="bomId" label={t("Resep")} rules={[{ required: true }]}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={boms.isLoading}
            options={(boms.data ?? [])
              .filter((b) => b.isActive)
              .map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))}
            notFoundContent={t("Belum ada resep — buat di Produksi › Resep (BOM)")}
          />
        </Form.Item>
        <Space wrap>
          <Form.Item name="batches" label="Jumlah batch" rules={[{ required: true }]}>
            <InputNumber min={0.0001} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="warehouseId" label={t('Gudang (bahan & hasil)')} rules={[{ required: true }]}>
            <Select style={{ width: 220 }} options={warehouses?.map((w) => ({ value: w.id, label: w.name }))} />
          </Form.Item>
          <Form.Item name="date" label="Tanggal">
            <Input type="date" />
          </Form.Item>
        </Space>
        {bom && (
          <Alert
            type="info"
            showIcon
            message={`Rencana hasil ${fmtQty(Number(bom.outputQty) * batches)} ${bom.product.unit} ${bom.product.name} · taksiran harga pokok ${fmtMoney(Number(bom.estimate.batchCost) * batches)}`}
            description={bom.lines.map((l) => `${l.name} ${fmtQty(Number(l.qty) * batches)} ${l.unit}`).join(' · ')}
          />
        )}
        <Form.Item name="notes" label="Catatan" style={{ marginTop: 12 }}>
          <Input placeholder="Mis. pesanan PT ABC / stok musim lebaran" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
