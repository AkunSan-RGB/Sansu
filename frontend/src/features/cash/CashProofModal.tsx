import { Form, Input, Modal, Typography } from 'antd';
import { useEffect } from 'react';
import { post } from '@/api/client';
import { useAction } from '@/api/queries';
import type { CashTransaction } from '@/api/types';

/** Melengkapi nomor bukti transaksi yang dicatat tanpa bukti (sekali isi, tidak mengubah jurnal) */
export default function CashProofModal({ target, onClose }: { target: CashTransaction | null; onClose: () => void }) {
  const [form] = Form.useForm<{ reference: string }>();
  useEffect(() => {
    if (target) form.resetFields();
  }, [target, form]);
  const save = useAction((v: { id: string; reference: string }) => post(`/cash/transactions/${v.id}/evidence`, { reference: v.reference }), {
    success: 'Nomor bukti disimpan',
    invalidate: ['cash'],
    onSuccess: onClose,
  });
  return (
    <Modal title={`Nomor bukti ${target?.number ?? ''}`} open={!!target} onCancel={onClose} onOk={() => form.submit()} confirmLoading={save.isPending} okText="Simpan">
      <Typography.Paragraph type="secondary">Isi nomor kuitansi / nota / bukti transfer. Hanya bisa diisi sekali dan tidak mengubah jurnal.</Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={(v) => target && save.mutate({ id: target.id, reference: v.reference })}>
        <Form.Item name="reference" label="No. bukti" rules={[{ required: true, min: 2, message: 'Isi nomor bukti' }]}>
          <Input maxLength={100} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
