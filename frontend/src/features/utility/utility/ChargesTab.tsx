import { NON_AIR_CHARGE_KEYS, REVENUE_KEY_LABELS } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, put } from '@/api/client';
import { useAction, useCustomers } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import { fmtMoney } from '@/lib/format';
import { Connection } from './shared';

interface Charge { id: string; name: string; defaultPrice: string; revenueKey: string; revenueLabel: string; vatable: boolean; isActive: boolean }
type ChargeForm = { name: string; defaultPrice: number; revenueKey: string; vatable: boolean; isActive: boolean };

/** Layanan non-air: sambung baru, sambung kembali, ganti meter, administrasi, dan sejenisnya — pendapatannya dicatat terpisah dari penjualan air */
export function ChargesTab() {
  const can = useCan();
  const navigate = useNavigate();
  const charges = useQuery({ queryKey: ['utility', 'charges'], queryFn: () => get<Charge[]>('/utility/charges') });
  const customers = useCustomers();
  const conns = useQuery({ queryKey: ['utility', 'connections'], queryFn: () => get<Connection[]>('/utility/connections') });
  const [editing, setEditing] = useState<Charge | 'new' | null>(null);
  const [issuing, setIssuing] = useState<Charge | null>(null);
  const [cf] = Form.useForm<ChargeForm>();
  const [inf] = Form.useForm<{ customerId: string; connectionId?: string; qty: number; price: number; notes?: string }>();
  const save = useAction((v: ChargeForm) => { const body = { ...v, defaultPrice: String(v.defaultPrice) }; return editing && editing !== 'new' ? put(`/utility/charges/${editing.id}`, body) : post('/utility/charges', body); }, { success: 'Layanan disimpan', invalidate: ['utility'], onSuccess: () => setEditing(null) });
  const issue = useAction((v: { customerId: string; connectionId?: string; qty: number; price: number; notes?: string }) => post<{ invoiceNumber: string }>('/utility/charges/issue', { chargeId: issuing!.id, customerId: v.customerId, connectionId: v.connectionId, qty: String(v.qty), price: String(v.price), notes: v.notes }), { success: 'Tagihan non-air diterbitkan — lunasi lewat menu Terima pembayaran (loket)', invalidate: ['utility', 'invoices'], onSuccess: () => { setIssuing(null); navigate('/invoices'); } });
  const manage = can('POST', '/utility/charges');
  const customerId = Form.useWatch('customerId', inf);
  const myConns = (conns.data ?? []).filter((c) => !customerId || (customers.data ?? []).find((x) => x.id === customerId)?.name === c.customerName);
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Pendapatan air dan non-air dipisah"
        description="Penjualan air (pemakaian dan abonemen) terbit otomatis lewat Tagihan air bulanan. Layanan di bawah ini ditagih sesekali ke pelanggan dan dicatat di akun pendapatan non-air tersendiri, jadi laporan labanya menunjukkan berapa dari air dan berapa dari layanan lain." />
      {manage && <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { cf.resetFields(); cf.setFieldsValue({ revenueKey: 'UTILITY_OTHER_REVENUE', vatable: false, isActive: true, defaultPrice: 0 }); setEditing('new'); }}>Tambah layanan</Button>}
      <ResponsiveTable<Charge>
        rowKey="id"
        size="small"
        loading={charges.isLoading}
        dataSource={charges.data}
        pagination={false}
        columns={[
          { title: 'Layanan', dataIndex: 'name' },
          { title: 'Dicatat sebagai', render: (_: unknown, c: Charge) => c.revenueLabel },
          { title: 'Harga bawaan', align: 'right' as const, render: (_: unknown, c: Charge) => fmtMoney(c.defaultPrice) },
          { title: 'PPN', render: (_: unknown, c: Charge) => (c.vatable ? <Tag color="blue">Kena PPN</Tag> : <Tag>Tanpa PPN</Tag>) },
          { title: 'Status', render: (_: unknown, c: Charge) => (c.isActive ? <Tag color="green">Aktif</Tag> : <Tag>Nonaktif</Tag>) },
          {
            render: (_: unknown, c: Charge) => (
              <Space>
                {manage && c.isActive && <Button size="small" type="primary" onClick={() => { inf.resetFields(); inf.setFieldsValue({ qty: 1, price: Number(c.defaultPrice) }); setIssuing(c); }}>Tagih</Button>}
                {manage && <Button size="small" onClick={() => { cf.setFieldsValue({ name: c.name, defaultPrice: Number(c.defaultPrice), revenueKey: c.revenueKey, vatable: c.vatable, isActive: c.isActive }); setEditing(c); }}>Ubah</Button>}
              </Space>
            ),
          },
        ]}
      />
      <Modal title={editing === 'new' ? 'Tambah layanan non-air' : 'Ubah layanan'} open={!!editing} onCancel={() => setEditing(null)} onOk={() => cf.submit()} confirmLoading={save.isPending} okText="Simpan" destroyOnHidden>
        <Form form={cf} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Form.Item name="name" label="Nama layanan" rules={[{ required: true, min: 3 }]}><Input maxLength={120} placeholder="mis. Sambung kembali setelah pemutusan" /></Form.Item>
          <Form.Item name="revenueKey" label="Dicatat sebagai pendapatan" rules={[{ required: true }]}><Select options={NON_AIR_CHARGE_KEYS.map((k) => ({ value: k, label: REVENUE_KEY_LABELS[k] }))} /></Form.Item>
          <Form.Item name="defaultPrice" label="Harga bawaan (Rp)" rules={[{ required: true }]}><InputNumber min={0} style={{ width: 220 }} /></Form.Item>
          <Form.Item name="vatable" label="Kena PPN" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="isActive" label="Aktif" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
      <Modal title={issuing ? `Tagih — ${issuing.name}` : ''} open={!!issuing} onCancel={() => setIssuing(null)} onOk={() => inf.submit()} confirmLoading={issue.isPending} okText="Terbitkan tagihan" destroyOnHidden>
        <Typography.Paragraph type="secondary">Faktur terbit atas nama pelanggan dan masuk piutang; pembayarannya diterima di loket seperti tagihan air.</Typography.Paragraph>
        <Form form={inf} layout="vertical" onFinish={(v) => issue.mutate(v)}>
          <Form.Item name="customerId" label="Pelanggan" rules={[{ required: true, message: 'Pilih pelanggan' }]}><Select showSearch optionFilterProp="label" placeholder="Cari pelanggan" options={(customers.data ?? []).map((c) => ({ value: c.id, label: c.name }))} onChange={() => inf.setFieldValue('connectionId', undefined)} /></Form.Item>
          <Form.Item name="connectionId" label="Sambungan terkait (opsional)"><Select allowClear showSearch optionFilterProp="label" placeholder="Pilih sambungan" options={myConns.map((c) => ({ value: c.id, label: `${c.number} · ${c.address}` }))} /></Form.Item>
          <Space>
            <Form.Item name="qty" label="Jumlah" rules={[{ required: true }]}><InputNumber min={1} style={{ width: 120 }} /></Form.Item>
            <Form.Item name="price" label="Harga satuan (Rp)" rules={[{ required: true }]}><InputNumber min={1} style={{ width: 200 }} /></Form.Item>
          </Space>
          <Form.Item name="notes" label="Catatan"><Input maxLength={200} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
