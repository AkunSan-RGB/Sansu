import { waLink } from '@/lib/wa';
import { CheckOutlined, CloseOutlined, FileAddOutlined, PhoneOutlined, PlusOutlined, TrophyOutlined, WhatsAppOutlined } from '@ant-design/icons';
import { ACTIVITY_TYPE_LABELS, type ActivityType, LEAD_STATUS_LABELS, QUOTATION_STATUS_LABELS, toOptions } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Checkbox,
  type FormInstance,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, patch, post } from '@/api/client';
import { useAction, useCustomers } from '@/api/queries';
import type { CrmStage, Lead } from '@/api/types';
import { fmtDate, fmtMoney, today } from '@/lib/format';

export const LEAD_STATUS_COLOR = { OPEN: 'blue', WON: 'green', LOST: 'red' } as const;

/** Nomor telepon Indonesia → tautan WhatsApp */
export { waLink };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function LeadForm({ form, stages, onFinish }: { form: FormInstance<any>; stages: CrmStage[]; onFinish: (v: Record<string, unknown>) => void }) {
  const { data: customers } = useCustomers();
  return (
    <Form form={form} layout="vertical" onFinish={onFinish}>
      <Form.Item name="title" label="Judul peluang" rules={[{ required: true }]}>
        <Input placeholder="Toko Makmur — pasok mi & minuman" />
      </Form.Item>
      <Form.Item name="customerId" label="Pelanggan terdaftar (jika sudah ada)">
        <Select allowClear showSearch optionFilterProp="label" options={customers?.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} />
      </Form.Item>
      <Form.Item name="companyName" label="Nama toko / perusahaan">
        <Input />
      </Form.Item>
      <Space wrap style={{ display: 'flex' }}>
        <Form.Item name="contactName" label="Kontak">
          <Input />
        </Form.Item>
        <Form.Item name="phone" label="Telepon / WA">
          <Input />
        </Form.Item>
        <Form.Item name="email" label="Email" rules={[{ type: 'email' }]}>
          <Input />
        </Form.Item>
      </Space>
      <Space wrap style={{ display: 'flex' }}>
        <Form.Item name="expectedRevenue" label="Perkiraan nilai">
          <InputNumber min={0} style={{ width: 200 }} prefix="Rp" />
        </Form.Item>
        <Form.Item name="stageId" label="Tahap">
          <Select style={{ width: 200 }} options={stages.map((s) => ({ value: s.id, label: s.name }))} />
        </Form.Item>
        <Form.Item name="expectedCloseDate" label="Target closing">
          <Input type="date" />
        </Form.Item>
      </Space>
      <Form.Item name="source" label="Sumber">
        <Select
          allowClear
          options={['Kunjungan sales', 'Referensi pelanggan', 'Telepon masuk', 'WhatsApp', 'Media sosial', 'Pameran', 'Website'].map((s) => ({ value: s, label: s }))}
        />
      </Form.Item>
      <Form.Item name="notes" label="Catatan">
        <Input.TextArea rows={3} />
      </Form.Item>
    </Form>
  );
}

export default function LeadDrawer({ leadId, stages, onClose }: { leadId: string | null; stages: CrmStage[]; onClose: () => void }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState('');
  const [form] = Form.useForm();
  const [actForm] = Form.useForm();
  const refresh = ['crm-lead', 'crm-pipeline', 'crm-summary', 'crm-agenda', 'crm-leads'];
  const { data: lead, isLoading } = useQuery({ queryKey: ['crm-lead', leadId], queryFn: () => get<Lead>(`/crm/leads/${leadId}`), enabled: !!leadId });

  const save = useAction(
    (v: Record<string, unknown>) =>
      patch(`/crm/leads/${leadId}`, { ...v, expectedRevenue: v.expectedRevenue != null ? String(v.expectedRevenue) : undefined, expectedCloseDate: v.expectedCloseDate || undefined }),
    { success: 'Prospek disimpan', invalidate: refresh, onSuccess: () => setEditing(false) },
  );
  const mark = useAction((v: { status: 'WON' | 'LOST' | 'OPEN'; lostReason?: string; createCustomer?: boolean }) => post(`/crm/leads/${leadId}/mark`, v), {
    success: (r: unknown) => ((r as { status: string }).status === 'WON' ? 'Peluang dimenangkan — pelanggan siap diberi order' : 'Status prospek diperbarui'),
    invalidate: [...refresh, 'customers'],
    onSuccess: () => setLostOpen(false),
  });
  const addAct = useAction((v: { type: ActivityType; summary: string; dueDate: string }) => post('/crm/activities', { ...v, leadId }), {
    success: 'Aktivitas dijadwalkan',
    invalidate: refresh,
    onSuccess: () => actForm.resetFields(),
  });
  const done = useAction((id: string) => post(`/crm/activities/${id}/done`, {}), { invalidate: refresh });

  return (
    <Drawer
      open={!!leadId}
      onClose={() => {
        setEditing(false);
        onClose();
      }}
      width={Math.min(620, window.innerWidth)}
      loading={isLoading}
      title={lead?.title}
      extra={
        lead && (
          <Space wrap>
            {lead.status === 'OPEN' ? (
              <>
                <Popconfirm
                  title="Tandai menang?"
                  description={!lead.customerId ? 'Pelanggan baru akan dibuat dari data prospek.' : undefined}
                  onConfirm={() => mark.mutate({ status: 'WON', createCustomer: true })}
                >
                  <Button type="primary" icon={<TrophyOutlined />}>
                    Menang
                  </Button>
                </Popconfirm>
                <Button danger icon={<CloseOutlined />} onClick={() => setLostOpen(true)}>
                  Kalah
                </Button>
              </>
            ) : (
              <Button onClick={() => mark.mutate({ status: 'OPEN' })}>Buka kembali</Button>
            )}
          </Space>
        )
      }
    >
      {lead && !editing && (
        <>
          <Space wrap style={{ marginBottom: 12 }}>
            <Tag color={LEAD_STATUS_COLOR[lead.status]}>{LEAD_STATUS_LABELS[lead.status]}</Tag>
            <Tag>{lead.stage?.name}</Tag>
            <Tag color="gold">Peluang {lead.probability}%</Tag>
          </Space>
          {lead.status === 'LOST' && lead.lostReason && <Typography.Paragraph type="danger">Alasan kalah: {lead.lostReason}</Typography.Paragraph>}
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Perkiraan nilai">{fmtMoney(lead.expectedRevenue)}</Descriptions.Item>
            <Descriptions.Item label="Pelanggan">{lead.customer ? `${lead.customer.code} · ${lead.customer.name}` : lead.companyName ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="Kontak">{lead.contactName ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="Telepon">
              {lead.phone ? (
                <Space>
                  <a href={`tel:${lead.phone}`}>
                    <PhoneOutlined /> {lead.phone}
                  </a>
                  <a href={waLink(lead.phone)} target="_blank" rel="noreferrer">
                    <WhatsAppOutlined /> WhatsApp
                  </a>
                </Space>
              ) : (
                '-'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Sumber">{lead.source ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="Target closing">{fmtDate(lead.expectedCloseDate)}</Descriptions.Item>
            <Descriptions.Item label="Sales">{lead.owner?.name ?? '-'}</Descriptions.Item>
            {lead.notes && <Descriptions.Item label="Catatan">{lead.notes}</Descriptions.Item>}
          </Descriptions>
          <Space style={{ marginTop: 12 }} wrap>
            <Button
              onClick={() => {
                form.setFieldsValue({ ...lead, expectedRevenue: Number(lead.expectedRevenue) });
                setEditing(true);
              }}
            >
              Ubah
            </Button>
            <Button
              icon={<FileAddOutlined />}
              onClick={() => navigate(`/quotations/new?leadId=${lead.id}${lead.customerId ? `&customerId=${lead.customerId}` : ''}`)}
            >
              Buat penawaran
            </Button>
          </Space>

          <Divider orientation="left">Aktivitas</Divider>
          <Form form={actForm} layout="inline" initialValues={{ type: 'CALL', dueDate: today() }} onFinish={(v) => addAct.mutate(v)} style={{ rowGap: 8 }}>
            <Form.Item name="type">
              <Select style={{ width: 150 }} options={toOptions(ACTIVITY_TYPE_LABELS)} />
            </Form.Item>
            <Form.Item name="summary" rules={[{ required: true, message: 'Isi rencana' }]} style={{ flex: 1, minWidth: 180 }}>
              <Input placeholder="Rencana tindak lanjut" />
            </Form.Item>
            <Form.Item name="dueDate">
              <Input type="date" />
            </Form.Item>
            <Button htmlType="submit" icon={<PlusOutlined />} loading={addAct.isPending}>
              Jadwalkan
            </Button>
          </Form>
          <List
            style={{ marginTop: 8 }}
            dataSource={lead.activities}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Belum ada aktivitas" /> }}
            renderItem={(a) => (
              <List.Item
                actions={[
                  !a.done && (
                    <Button key="d" size="small" icon={<CheckOutlined />} onClick={() => done.mutate(a.id)}>
                      Selesai
                    </Button>
                  ),
                ]}
              >
                <List.Item.Meta
                  avatar={<Checkbox checked={a.done} disabled />}
                  title={
                    <Space wrap>
                      <Tag>{ACTIVITY_TYPE_LABELS[a.type]}</Tag>
                      <Typography.Text delete={a.done}>{a.summary}</Typography.Text>
                    </Space>
                  }
                  description={
                    <>
                      <Typography.Text type={!a.done && a.dueDate < today() ? 'danger' : 'secondary'}>{fmtDate(a.dueDate)}</Typography.Text>
                      {a.user && ` · ${a.user.name}`}
                      {a.result && <div>Hasil: {a.result}</div>}
                    </>
                  }
                />
              </List.Item>
            )}
          />

          <Divider orientation="left">Penawaran</Divider>
          <List
            dataSource={lead.quotations}
            locale={{ emptyText: 'Belum ada penawaran' }}
            renderItem={(q) => (
              <List.Item onClick={() => navigate(`/quotations/${q.id}`)} style={{ cursor: 'pointer' }} extra={fmtMoney(q.total)}>
                <Space>
                  {q.number}
                  <Tag>{QUOTATION_STATUS_LABELS[q.status]}</Tag>
                  {fmtDate(q.date)}
                </Space>
              </List.Item>
            )}
          />
        </>
      )}
      {lead && editing && (
        <>
          <LeadForm form={form} stages={stages} onFinish={(v) => save.mutate(v)} />
          <Space>
            <Button onClick={() => setEditing(false)}>Batal</Button>
            <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>
              Simpan
            </Button>
          </Space>
        </>
      )}
      <Modal
        title="Tandai kalah"
        open={lostOpen}
        onCancel={() => setLostOpen(false)}
        okText="Simpan"
        okButtonProps={{ danger: true, disabled: !lostReason }}
        confirmLoading={mark.isPending}
        onOk={() => mark.mutate({ status: 'LOST', lostReason })}
      >
        <Select
          style={{ width: '100%', marginBottom: 8 }}
          placeholder="Pilih alasan"
          onChange={setLostReason}
          options={['Harga kompetitor lebih murah', 'Belum butuh sekarang', 'Tidak bisa dihubungi', 'Produk tidak tersedia', 'Termin pembayaran tidak cocok'].map((r) => ({ value: r, label: r }))}
        />
        <Input placeholder="atau tulis alasan lain" value={lostReason} onChange={(e) => setLostReason(e.target.value)} />
      </Modal>
    </Drawer>
  );
}
