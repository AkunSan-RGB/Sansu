import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space } from 'antd';
import { post } from '@/api/client';
import { useAction } from '@/api/queries';
import { KEY, KIND } from './shared';

const pad = (n: number, w: number) => String(n).padStart(w, '0');

export function AddBinsModal({ open, wid, onClose }: { open: boolean; wid: string; onClose: () => void }) {
  const [form] = Form.useForm();
  const create = useAction((v: { codes: string[]; kind: string; zone?: string }) => post('/inventory/bins', { warehouseId: wid, ...v }), {
    success: 'Rak ditambahkan',
    invalidate: [KEY],
    onSuccess: () => { form.resetFields(); onClose(); },
  });
  const generate = () => {
    const v = form.getFieldsValue();
    const aisles = String(v.aisles ?? '').split(/[,\s]+/).filter(Boolean);
    const from = Number(v.from ?? 1);
    const to = Number(v.to ?? 1);
    const l1 = Number(v.levelFrom ?? 0);
    const l2 = Number(v.levelTo ?? 0);
    if (!aisles.length || to < from || (l2 && l2 < l1)) return;
    const lines: string[] = [];
    for (const a of aisles) for (let i = from; i <= to; i++) {
      if (l2) for (let l = l1 || 1; l <= l2; l++) lines.push(`${a}-${pad(i, 2)}-${pad(l, 2)}`);
      else lines.push(`${a}-${pad(i, 2)}`);
    }
    form.setFieldsValue({ codesText: [...(String(v.codesText ?? '').trim() ? [String(v.codesText).trim()] : []), ...lines].join('\n') });
  };
  return (
    <Modal title="Tambah rak" open={open} onCancel={onClose} okText="Simpan" confirmLoading={create.isPending} width={560}
      onOk={() => form.validateFields().then((v) => create.mutate({ codes: String(v.codesText).split(/[\n,;]+/).map((c) => c.trim()).filter(Boolean), kind: v.kind, zone: v.zone || undefined }))}>
      <Form form={form} layout="vertical" initialValues={{ kind: 'STORAGE', from: 1, to: 10, levelFrom: 1, levelTo: 3 }}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Isi daftar kode sendiri, atau buat deret otomatis lalu periksa hasilnya." />
        <Space wrap align="end" style={{ marginBottom: 8 }}>
          <Form.Item label="Lorong (pisah koma)" name="aisles" style={{ margin: 0 }}><Input placeholder="A, B" style={{ width: 130 }} /></Form.Item>
          <Form.Item label="Nomor dari" name="from" style={{ margin: 0 }}><InputNumber min={1} style={{ width: 80 }} /></Form.Item>
          <Form.Item label="sampai" name="to" style={{ margin: 0 }}><InputNumber min={1} style={{ width: 80 }} /></Form.Item>
          <Form.Item label="Level dari" name="levelFrom" style={{ margin: 0 }}><InputNumber min={0} style={{ width: 80 }} /></Form.Item>
          <Form.Item label="sampai" name="levelTo" style={{ margin: 0 }}><InputNumber min={0} style={{ width: 80 }} /></Form.Item>
          <Button onClick={generate}>Buat deret</Button>
        </Space>
        <Form.Item label="Kode rak (satu per baris, maks 200)" name="codesText" rules={[{ required: true, message: 'Isi minimal satu kode rak' }]}>
          <Input.TextArea rows={6} placeholder={'A-01-01\nA-01-02'} />
        </Form.Item>
        <Space wrap>
          <Form.Item label="Jenis" name="kind" style={{ margin: 0 }}>
            <Select style={{ width: 200 }} options={['STORAGE', 'STAGING', 'DAMAGED', 'QUARANTINE'].map((k) => ({ value: k, label: KIND[k].label }))} />
          </Form.Item>
          <Form.Item label="Zona (opsional)" name="zone" style={{ margin: 0 }}><Input style={{ width: 160 }} maxLength={30} /></Form.Item>
        </Space>
      </Form>
    </Modal>
  );
}
