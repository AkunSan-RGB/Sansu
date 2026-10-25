import type { Project } from '@sansu/shared';
import { Col, Form, Input, InputNumber, Modal, Row, Select } from 'antd';
import { post } from '@/api/client';
import { useAction, useCustomers } from '@/api/queries';
import { t } from '@/lib/terms';

export function ProjectModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (p: Project) => void }) {
  const [form] = Form.useForm();
  const { data: customers } = useCustomers();
  const save = useAction(
    (v: {
      name: string;
      customerId: string;
      contractValue: number;
      code?: string;
      startDate?: string;
      endDate?: string;
      notes?: string;
    }) =>
      post<Project>('/services/projects', {
        ...v,
        contractValue: String(v.contractValue),
        startDate: v.startDate || undefined,
        endDate: v.endDate || undefined,
      }),
    {
      success: (p) => `Proyek ${p.code} dibuat`,
      invalidate: ['projects'],
      onSuccess: (p) => {
        onClose();
        onDone(p);
      },
    },
  );
  return (
    <Modal
      title="Proyek / kontrak baru"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={save.isPending}
      okText="Simpan"
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)} preserve={false}>
        <Form.Item name="name" label="Nama proyek / pekerjaan" rules={[{ required: true, min: 3 }]}>
          <Input placeholder={t('Mis. Renovasi gudang PT Maju Jaya')} />
        </Form.Item>
        <Form.Item name="customerId" label={t('Pelanggan (pemberi kerja)')} rules={[{ required: true }]}>
          <Select
            showSearch
            optionFilterProp="label"
            options={customers?.filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
          />
        </Form.Item>
        <Form.Item name="contractValue" label="Nilai kontrak (DPP, belum PPN)" rules={[{ required: true }]}>
          <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
        </Form.Item>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="startDate" label="Mulai">
              <Input type="date" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="endDate" label="Target selesai">
              <Input type="date" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="code" label="Kode" extra="Kosong = nomor otomatis">
          <Input placeholder="Mis. SPK-012" />
        </Form.Item>
        <Form.Item name="notes" label="Catatan">
          <Input.TextArea rows={2} placeholder="No. SPK / kontrak, termin pembayaran yang disepakati" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
