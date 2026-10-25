import { PlusOutlined } from '@ant-design/icons';
import { UTILITY_CONNECTION_LABELS, UTILITY_SERVICE_LABELS } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Tag } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post, put } from '@/api/client';
import { useAction, useCustomers } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import { Connection, STATUS_COLOR, Tariff } from './shared';
import { ConnectionDrawer } from './ConnectionDrawer';

// ---------- Sambungan ----------
export function ConnectionsTab() {
  const can = useCan();
  const [status, setStatus] = useState<string>();
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['utility', 'connections', status, search], queryFn: () => get<Connection[]>(`/utility/connections?${new URLSearchParams({ ...(status ? { status } : {}), ...(search ? { search } : {}) })}`) });
  const tariffs = useQuery({ queryKey: ['utility', 'tariffs'], queryFn: () => get<Tariff[]>('/utility/tariffs') });
  const customers = useCustomers();
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [act, setAct] = useState<{ c: Connection; mode: 'suspend' | 'reconnect' | 'disconnect' } | null>(null);
  const [form] = Form.useForm();
  const [zf] = Form.useForm<{ zone?: string }>();
  const [zoneOf, setZoneOf] = useState<Connection | null>(null);
  const [af] = Form.useForm<{ reason: string; onRequest?: boolean }>();
  const tariffId = Form.useWatch('tariffId', form);
  const metered = tariffs.data?.find((t) => t.id === tariffId)?.metered;
  const create = useAction((v: Record<string, unknown>) => post('/utility/connections', { ...v, installedAt: (v.installedAt as dayjs.Dayjs | undefined)?.format('YYYY-MM-DD') }), { success: 'Sambungan didaftarkan', invalidate: ['utility'], onSuccess: () => setCreating(false) });
  const saveZone = useAction((v: { id: string; zone?: string }) => put(`/utility/connections/${v.id}/zone`, { zone: v.zone ?? '' }), { success: 'Zona tersimpan', invalidate: ['utility'], onSuccess: () => setZoneOf(null) });
  const doAct = useAction((v: { id: string; mode: string; reason: string; onRequest?: boolean }) => post(`/utility/connections/${v.id}/${v.mode}`, { reason: v.reason, onRequest: v.onRequest }), { success: 'Tersimpan', invalidate: ['utility'], onSuccess: () => setAct(null) });
  const TITLE = { suspend: 'Putus sementara', reconnect: 'Sambung kembali', disconnect: 'Bongkar sambungan (permanen)' } as const;
  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search allowClear placeholder="Cari nama, nomor, meter, alamat" onSearch={setSearch} style={{ width: 260 }} />
        <Select allowClear placeholder="Semua status" style={{ width: 180 }} value={status} onChange={setStatus} options={Object.entries(UTILITY_CONNECTION_LABELS).map(([value, label]) => ({ value, label }))} />
        {can('POST', '/utility/connections') && <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setCreating(true); }}>Sambungan baru</Button>}
      </Space>
      <ResponsiveTable<Connection> rowKey="id" size="small" loading={isLoading} dataSource={data} pagination={{ pageSize: 20 }} scroll={{ x: 900 }} locale={{ emptyText: 'Belum ada sambungan' }}
        columns={[
          { title: 'No. sambungan', dataIndex: 'number', render: (v: string, c: Connection) => <a onClick={() => setDetail(c.id)}>{v}</a> },
          { title: 'Pelanggan', dataIndex: 'customerName' },
          { title: 'Alamat', dataIndex: 'address', ellipsis: true },
          { title: 'Zona', dataIndex: 'zone', render: (v: string | null, c: Connection) => (can('PUT', '/utility/connections/:id/zone') ? <a onClick={() => { zf.setFieldsValue({ zone: v ?? '' }); setZoneOf(c); }}>{v || 'atur'}</a> : v || '-') },
          { title: 'Layanan', render: (_: unknown, c: Connection) => `${c.tariffName}${c.meterNo ? ` · meter ${c.meterNo}` : ''}` },
          { title: 'Meter terakhir', render: (_: unknown, c: Connection) => (c.metered ? `${c.lastReading ?? '-'} ${c.unit}${c.lastPeriod ? ` (${c.lastPeriod})` : ''}` : 'tarif tetap') },
          { title: 'Status', render: (_: unknown, c: Connection) => <Tag color={STATUS_COLOR[c.status]}>{UTILITY_CONNECTION_LABELS[c.status]}</Tag> },
          {
            render: (_: unknown, c: Connection) => (
              <Space wrap>
                {c.status === 'ACTIVE' && can('POST', '/utility/connections/:id/suspend') && <Button size="small" onClick={() => { af.resetFields(); setAct({ c, mode: 'suspend' }); }}>Putus sementara</Button>}
                {c.status === 'SUSPENDED' && can('POST', '/utility/connections/:id/reconnect') && <Button size="small" type="primary" onClick={() => { af.resetFields(); setAct({ c, mode: 'reconnect' }); }}>Sambung kembali</Button>}
                {c.status !== 'DISCONNECTED' && can('POST', '/utility/connections/:id/disconnect') && <Button size="small" danger onClick={() => { af.resetFields(); setAct({ c, mode: 'disconnect' }); }}>Bongkar</Button>}
              </Space>
            ),
          },
        ]}
      />
      <Modal title="Sambungan baru" open={creating} onCancel={() => setCreating(false)} onOk={() => form.submit()} confirmLoading={create.isPending} okText="Daftarkan" destroyOnHidden>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Daftarkan sambungan setelah pemasangan selesai dan biaya sambung dibayar. Pemasang dan pendaftar sebaiknya orang berbeda." />
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)} initialValues={{ initialReading: 0 }}>
          <Form.Item name="customerId" label="Pelanggan" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(customers.data ?? []).filter((c) => c.isActive !== false).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Form.Item>
          <Form.Item name="tariffId" label="Tarif / layanan" rules={[{ required: true }]}><Select options={(tariffs.data ?? []).filter((t) => t.isActive).map((t) => ({ value: t.id, label: `${t.name} (${UTILITY_SERVICE_LABELS[t.serviceType]})` }))} /></Form.Item>
          <Form.Item name="address" label="Alamat pemasangan" rules={[{ required: true, min: 5 }]}><Input maxLength={300} /></Form.Item>
          {metered && <Form.Item name="meterNo" label="Nomor meter" rules={[{ required: true }]}><Input maxLength={60} /></Form.Item>}
          {metered && <Form.Item name="initialReading" label="Angka meter saat dipasang"><InputNumber min={0} style={{ width: 200 }} /></Form.Item>}
          <Form.Item name="zone" label="Zona (opsional)" extra="Wilayah/jaringan untuk menghitung kehilangan, mis. Zona A."><Input maxLength={60} /></Form.Item>
          <Form.Item name="installedAt" label="Tanggal pasang"><DatePicker disabledDate={(d) => d.isAfter(dayjs())} /></Form.Item>
        </Form>
      </Modal>
      <Modal title={act ? `${TITLE[act.mode]} — ${act.c.number}` : ''} open={!!act} onCancel={() => setAct(null)} onOk={() => af.submit()} confirmLoading={doAct.isPending} okText="Simpan" okButtonProps={{ danger: act?.mode !== 'reconnect' }} destroyOnHidden>
        {act?.mode === 'suspend' && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Pemutusan hanya untuk tunggakan melewati batas hari, atau atas permintaan pelanggan. Sambung kembali harus dilakukan orang lain setelah lunas." />}
        <Form form={af} layout="vertical" onFinish={(v) => doAct.mutate({ id: act!.c.id, mode: act!.mode, ...v })}>
          <Form.Item name="reason" label="Alasan / dasar" rules={[{ required: true, min: 5, message: 'Minimal 5 huruf' }]}><Input.TextArea rows={3} maxLength={255} /></Form.Item>
          {act?.mode === 'suspend' && <Form.Item name="onRequest" valuePropName="checked"><Checkbox>Atas permintaan pelanggan (tanpa tunggakan)</Checkbox></Form.Item>}
        </Form>
      </Modal>
      <Modal title={zoneOf ? `Zona — ${zoneOf.number}` : ''} open={!!zoneOf} onCancel={() => setZoneOf(null)} onOk={() => zf.submit()} confirmLoading={saveZone.isPending} okText="Simpan" destroyOnHidden>
        <Form form={zf} layout="vertical" onFinish={(v) => saveZone.mutate({ id: zoneOf!.id, zone: v.zone })}>
          <Form.Item name="zone" label="Zona" extra="Kosongkan untuk mengeluarkan dari zona."><Input maxLength={60} /></Form.Item>
        </Form>
      </Modal>
      <ConnectionDrawer id={detail} onClose={() => setDetail(null)} />
    </>
  );
}
