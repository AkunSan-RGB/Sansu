import { PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Tag } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction, useProducts, useSuppliers } from '@/api/queries';
import { useAuth } from '@/auth/AuthContext';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';

interface Agreement {
  id: string; supplierName: string; sku: string; productName: string; baseUom: string; price: string; validFrom: string; validTo: string;
  status: 'PENDING' | 'ACTIVE' | 'REJECTED' | 'ENDED'; note: string | null; decisionNote: string | null; createdByName: string | null; decidedByName: string | null;
  lastPrice: string | null; overLastPct: number | null; suspicious: boolean;
}
const STATUS = { PENDING: { color: 'gold', text: 'Menunggu persetujuan' }, ACTIVE: { color: 'green', text: 'Berlaku' }, REJECTED: { color: 'red', text: 'Ditolak' }, ENDED: { color: 'default', text: 'Berakhir' } };
const TITLE = { FMCG: 'Kontrak harga prinsipal', FNB: 'Harga pemasok bahan', MANUFAKTUR: 'Kontrak harga bahan baku', DAGANG: 'Kontrak harga pemasok', RITEL: 'Kontrak harga pemasok', JASA: 'Kontrak harga pemasok', UTILITAS: 'Kontrak harga pemasok' } as const;

/** Harga yang disepakati per barang dari pemasok/prinsipal untuk periode tertentu; PO di atas harga ini ditahan */
export default function PriceAgreementsPage() {
  const { me } = useAuth();
  const can = useCan();
  const { data, isLoading } = useQuery({ queryKey: ['price-agreements'], queryFn: () => get<Agreement[]>('/price-agreements') });
  const { data: suppliers } = useSuppliers();
  const { data: products } = useProducts();
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<{ a: Agreement; mode: 'reject' | 'end' } | null>(null);
  const [form] = Form.useForm<{ supplierId: string; productId: string; price: number; period: [dayjs.Dayjs, dayjs.Dayjs]; note?: string }>();
  const [df] = Form.useForm<{ reason: string }>();
  const create = useAction(
    (v: { supplierId: string; productId: string; price: number; period: [dayjs.Dayjs, dayjs.Dayjs]; note?: string }) =>
      post('/price-agreements', { supplierId: v.supplierId, productId: v.productId, price: String(v.price), validFrom: v.period[0].format('YYYY-MM-DD'), validTo: v.period[1].format('YYYY-MM-DD'), note: v.note }),
    { success: 'Kontrak dikirim untuk disetujui', invalidate: ['price-agreements'], onSuccess: () => setCreating(false) },
  );
  const approve = useAction((id: string) => post(`/price-agreements/${id}/approve`, {}), { success: 'Kontrak berlaku', invalidate: ['price-agreements'] });
  const decide = useAction((v: { id: string; mode: 'reject' | 'end'; reason: string }) => post(`/price-agreements/${v.id}/${v.mode}`, { reason: v.reason }), { success: 'Tersimpan', invalidate: ['price-agreements'], onSuccess: () => setDeciding(null) });
  return (
    <>
      <PageHeader title={TITLE[me?.businessModel ?? 'DAGANG']} extra={can('POST', '/price-agreements') && <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setCreating(true); }}>Kontrak baru</Button>} />
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Harga per satuan dasar, sebelum PPN. Kontrak baru berlaku setelah disetujui orang lain (Keuangan/Admin). Purchase Order di atas harga kontrak aktif ditolak; hanya Admin/Pemilik yang boleh melewatinya dan tercatat di jejak audit." />
      <ResponsiveTable<Agreement> rowKey="id" size="small" loading={isLoading} dataSource={data} pagination={{ pageSize: 15 }} scroll={{ x: 900 }} locale={{ emptyText: 'Belum ada kontrak harga' }}
        columns={[
          { title: 'Pemasok', dataIndex: 'supplierName' },
          { title: 'Barang', render: (_: unknown, a: Agreement) => `${a.sku} · ${a.productName}` },
          { title: 'Harga kontrak', align: 'right' as const, render: (_: unknown, a: Agreement) => <span>{fmtMoney(a.price)} / {a.baseUom}{a.suspicious && <Tag color="orange" style={{ marginLeft: 6 }}>{a.overLastPct}% di atas harga beli terakhir</Tag>}</span> },
          { title: 'Periode', render: (_: unknown, a: Agreement) => `${fmtDate(a.validFrom)} – ${fmtDate(a.validTo)}` },
          { title: 'Status', render: (_: unknown, a: Agreement) => <Tag color={STATUS[a.status].color}>{STATUS[a.status].text}</Tag> },
          { title: 'Dibuat / diputuskan', render: (_: unknown, a: Agreement) => `${a.createdByName ?? '-'}${a.decidedByName ? ` → ${a.decidedByName}` : ''}` },
          {
            render: (_: unknown, a: Agreement) => (
              <Space wrap>
                {a.status === 'PENDING' && can('POST', '/price-agreements/:id/approve') && <Popconfirm title="Setujui kontrak ini?" onConfirm={() => approve.mutate(a.id)}><Button size="small" type="primary">Setujui</Button></Popconfirm>}
                {a.status === 'PENDING' && can('POST', '/price-agreements/:id/reject') && <Button size="small" danger onClick={() => { df.resetFields(); setDeciding({ a, mode: 'reject' }); }}>Tolak</Button>}
                {(a.status === 'ACTIVE' || a.status === 'PENDING') && can('POST', '/price-agreements/:id/end') && <Button size="small" onClick={() => { df.resetFields(); setDeciding({ a, mode: 'end' }); }}>Akhiri</Button>}
              </Space>
            ),
          },
        ]}
      />
      <Modal title="Kontrak harga baru" open={creating} onCancel={() => setCreating(false)} onOk={() => form.submit()} confirmLoading={create.isPending} okText="Kirim" destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Form.Item name="supplierId" label="Pemasok / prinsipal" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(suppliers ?? []).filter((s) => s.isActive !== false).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} /></Form.Item>
          <Form.Item name="productId" label="Barang" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(products ?? []).map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }))} /></Form.Item>
          <Form.Item name="price" label="Harga per satuan dasar" rules={[{ required: true }]}><InputNumber min={1} prefix="Rp" style={{ width: 220 }} /></Form.Item>
          <Form.Item name="period" label="Berlaku" rules={[{ required: true }]}><DatePicker.RangePicker style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="note" label="Keterangan"><Input maxLength={255} placeholder="mis. nomor perjanjian" /></Form.Item>
        </Form>
      </Modal>
      <Modal title={deciding?.mode === 'reject' ? 'Tolak kontrak' : 'Akhiri kontrak'} open={!!deciding} onCancel={() => setDeciding(null)} onOk={() => df.submit()} confirmLoading={decide.isPending} okText="Simpan" okButtonProps={{ danger: true }} destroyOnHidden>
        <Form form={df} layout="vertical" onFinish={(v) => decide.mutate({ id: deciding!.a.id, mode: deciding!.mode, reason: v.reason })}>
          <Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5, message: 'Minimal 5 huruf' }]}><Input.TextArea rows={3} maxLength={255} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
