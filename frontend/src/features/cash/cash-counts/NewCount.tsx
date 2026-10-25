import { type CashCount } from '@sansu/shared';
import { Form, Input, Modal, Select } from 'antd';
import { post } from '@/api/client';
import { useAction } from '@/api/queries';
import { fmtMoney, today } from '@/lib/format';
import { KasAccount } from './shared';

export function NewCount({
  open,
  accounts,
  onClose,
  onDone,
}: {
  open: boolean;
  accounts: KasAccount[];
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [form] = Form.useForm();
  const create = useAction(
    (v: { accountId: string; date: string; custodianName?: string }) => post<CashCount>('/cash/counts', v),
    {
      invalidate: ['cash-counts'],
      onSuccess: (c) => {
        form.resetFields();
        onClose();
        onDone(c.id);
      },
    },
  );
  return (
    <Modal
      title="Opname kas baru"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Mulai hitung"
      confirmLoading={create.isPending}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ date: today(), accountId: accounts[0]?.id }}
        onFinish={(v) => create.mutate(v)}
      >
        <Form.Item
          name="accountId"
          label="Kas yang dihitung"
          rules={[{ required: true }]}
          extra="Rekening bank tidak diopname — gunakan Rekonsiliasi bank."
        >
          <Select
            options={accounts.map((a) => ({
              value: a.id,
              label: `${a.code} · ${a.name} (saldo ${fmtMoney(a.balance)})`,
            }))}
          />
        </Form.Item>
        <Form.Item name="date" label="Tanggal opname (saldo buku per akhir hari ini)" rules={[{ required: true }]}>
          <Input type="date" />
        </Form.Item>
        <Form.Item name="custodianName" label="Nama pemegang kas">
          <Input maxLength={120} placeholder="mis. Rina (kasir kantor)" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
