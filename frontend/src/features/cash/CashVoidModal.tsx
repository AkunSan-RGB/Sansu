import { Alert, Form, Input, Modal, Typography } from 'antd';
import { useEffect } from 'react';
import { post } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import type { CashTransaction } from '@/api/types';

/** Membatalkan transaksi kas lewat jurnal pembalik (bukan menghapus), dengan alasan wajib untuk jejak audit */
export default function CashVoidModal({ target, onClose }: { target: CashTransaction | null; onClose: () => void }) {
  const [form] = Form.useForm<{ reason: string }>();
  useEffect(() => {
    if (target) form.resetFields();
  }, [target, form]);
  const doVoid = useAction((v: { id: string; reason: string }) => post(`/cash/transactions/${v.id}/void`, { reason: v.reason }), {
    success: 'Transaksi dibatalkan (jurnal pembalik dibuat)',
    invalidate: [...LEDGER_KEYS, 'cash'],
    onSuccess: onClose,
  });
  return (
    <Modal title={`Batalkan ${target?.number ?? ''}`} open={!!target} onCancel={onClose} onOk={() => form.submit()} confirmLoading={doVoid.isPending} okText="Batalkan transaksi" okButtonProps={{ danger: true }}>
      <Typography.Paragraph type="secondary">
        Transaksi tidak dihapus: SANSU membuat jurnal pembalik dan mencatat alasan serta pelakunya di jejak audit. Tidak bisa dibatalkan bila sudah dicocokkan dengan mutasi bank atau sudah menjadi aset tetap.
      </Typography.Paragraph>
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="Ini hanya mengoreksi pembukuan, bukan mengembalikan uang"
        description={
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Salah catat dan uang belum keluar: batalkan, lalu catat ulang dengan benar.</li>
            <li>Uang sudah benar-benar keluar atau salah tujuan: jangan dibatalkan. Minta uang dikembalikan, lalu catat sebagai Uang masuk.</li>
            <li>Membatalkan transaksi yang uangnya sudah keluar membuat saldo di SANSU lebih besar dari saldo bank asli.</li>
          </ul>
        }
      />
      <Form form={form} layout="vertical" onFinish={(v) => target && doVoid.mutate({ id: target.id, reason: v.reason })}>
        <Form.Item name="reason" label="Alasan pembatalan" rules={[{ required: true, min: 5, message: 'Isi alasan (min. 5 karakter)' }]}>
          <Input.TextArea rows={3} maxLength={300} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
