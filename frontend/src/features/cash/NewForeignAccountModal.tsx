import { FOREIGN_CURRENCIES } from '@sansu/shared';
import { Form, Input, Modal, Select } from 'antd';
import { post } from '@/api/client';
import { useAction } from '@/api/queries';

interface Values {
  code: string;
  name: string;
  currency: string;
}

/** Rekening bank/kas bermata uang asing: dibuat di Bagan Akun sebagai akun kas/bank bertipe Aset, mata uangnya tidak bisa diubah kemudian */
export default function NewForeignAccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<Values>();
  const create = useAction((v: Values) => post('/accounting/accounts', { ...v, type: 'ASSET', isCashAccount: true }), {
    success: 'Rekening valas dibuat',
    invalidate: ['cash-accounts', 'accounts'],
  });
  return (
    <Modal
      open={open}
      title="Rekening bank / kas valas baru"
      okText="Buat rekening"
      cancelText="Batal"
      confirmLoading={create.isPending}
      onCancel={onClose}
      onOk={() => form.validateFields().then((v) => create.mutate(v, { onSuccess: () => { form.resetFields(); onClose(); } }))}
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ currency: 'USD' }} preserve={false}>
        <Form.Item name="currency" label="Mata uang" extra="Tidak bisa diubah setelah rekening dibuat." rules={[{ required: true }]}>
          <Select options={FOREIGN_CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} />
        </Form.Item>
        <Form.Item name="code" label="Kode akun" rules={[{ required: true, message: 'Isi kode akun' }]} extra="Ikuti bagan akun Anda, mis. 1-1210 (di antara kas dan bank).">
          <Input maxLength={20} placeholder="1-1210" />
        </Form.Item>
        <Form.Item name="name" label="Nama rekening" rules={[{ required: true, message: 'Isi nama rekening' }]}>
          <Input maxLength={120} placeholder="Bank BCA USD" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
