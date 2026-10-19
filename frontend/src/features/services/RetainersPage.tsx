import { useQuery } from '@tanstack/react-query';
import { Alert, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post, put } from '@/api/client';
import { useAction, useCustomers } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';

const KEY = ['retainers'];
interface Row { id: string; customerName: string; projectName: string | null; title: string; monthlyFee: string; startDate: string; endDate: string | null; isActive: boolean; billedPeriods: { period: string; invoice: string }[]; unbilledPeriods: string[]; withVat: boolean | null }

/** Retainer: biaya tetap bulanan per klien; satu faktur per periode */
export default function RetainersPage() {
  const can = useCan();
  const rows = useQuery({ queryKey: KEY, queryFn: () => get<Row[]>('/retainers') });
  const customers = useCustomers();
  const [creating, setCreating] = useState(false);
  const [cf] = Form.useForm<{ customerId: string; title: string; monthlyFee: number; startDate: dayjs.Dayjs; endDate?: dayjs.Dayjs; withVat?: boolean }>();
  const create = useAction((v: { customerId: string; title: string; monthlyFee: number; startDate: dayjs.Dayjs; endDate?: dayjs.Dayjs; withVat?: boolean }) => post('/retainers', { ...v, monthlyFee: String(v.monthlyFee), startDate: v.startDate.format('YYYY-MM-DD'), endDate: v.endDate?.format('YYYY-MM-DD') }), { invalidate: KEY, success: 'Retainer dibuat', onSuccess: () => setCreating(false) });
  const bill = useAction((v: { id: string; period: string }) => post(`/retainers/${v.id}/bill`, { period: v.period }), { invalidate: [...KEY, 'invoices'], success: 'Faktur retainer dibuat' });
  const [editing, setEditing] = useState<Row | null>(null);
  const [ef] = Form.useForm<{ monthlyFee: number; isActive: boolean; reason: string }>();
  const update = useAction((v: { monthlyFee: number; isActive: boolean; reason: string }) => put(`/retainers/${editing!.id}`, { monthlyFee: String(v.monthlyFee), isActive: v.isActive, reason: v.reason }), { invalidate: KEY, success: 'Retainer diperbarui', onSuccess: () => setEditing(null) });
  const missed = (rows.data ?? []).filter((r) => r.isActive).reduce((a, r) => a + r.unbilledPeriods.length, 0);
  return (
    <>
      <PageHeader title="Retainer" extra={can('POST', '/retainers') && <Button type="primary" onClick={() => { cf.resetFields(); setCreating(true); }}>Retainer baru</Button>} />
      {missed > 0 && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`${missed} periode retainer belum ditagih`} description="Periode yang terlewat adalah pendapatan yang belum ditagih. Tagih per periode di tabel di bawah." />}
      <Table<Row> size="small" rowKey="id" loading={rows.isLoading} dataSource={rows.data} pagination={false} locale={{ emptyText: 'Belum ada retainer' }} scroll={{ x: 900 }}
        columns={[
          { title: 'Klien', render: (_: unknown, r: Row) => <div>{r.customerName}<div style={{ fontSize: 12, color: '#64748b' }}>{r.title}{r.projectName ? ` · ${r.projectName}` : ''}</div></div> },
          { title: 'Per bulan', align: 'right' as const, render: (_: unknown, r: Row) => fmtMoney(r.monthlyFee) },
          { title: 'Masa', render: (_: unknown, r: Row) => `${fmtDate(r.startDate)} – ${r.endDate ? fmtDate(r.endDate) : 'berjalan'}` },
          { title: 'Sudah ditagih', render: (_: unknown, r: Row) => r.billedPeriods.length ? r.billedPeriods.map((b) => <Tag key={b.period} color="green">{b.period}</Tag>) : '-' },
          { title: 'Belum ditagih', render: (_: unknown, r: Row) => r.unbilledPeriods.length ? <Space wrap>{r.unbilledPeriods.map((p) => <Button key={p} size="small" disabled={!can('POST', '/retainers/:id/bill')} loading={bill.isPending} onClick={() => bill.mutate({ id: r.id, period: p })}>Tagih {p}</Button>)}</Space> : <Typography.Text type="secondary">{r.isActive ? 'Lengkap' : 'Nonaktif'}</Typography.Text> },
          { title: '', render: (_: unknown, r: Row) => can('PUT', '/retainers/:id') && <Button size="small" onClick={() => { ef.setFieldsValue({ monthlyFee: Number(r.monthlyFee), isActive: r.isActive, reason: '' }); setEditing(r); }}>Ubah</Button> },
        ]} />
      <Modal title="Retainer baru" open={creating} onCancel={() => setCreating(false)} onOk={() => cf.submit()} confirmLoading={create.isPending} okText="Simpan" destroyOnHidden>
        <Form form={cf} layout="vertical" onFinish={(v) => create.mutate(v)} initialValues={{ startDate: dayjs().startOf('month') }}>
          <Form.Item name="customerId" label="Klien" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(customers.data ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Form.Item>
          <Form.Item name="title" label="Layanan" rules={[{ required: true, min: 3 }]}><Input maxLength={120} placeholder="mis. Retainer konsultasi pajak" /></Form.Item>
          <Form.Item name="monthlyFee" label="Biaya per bulan" rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
          <Space><Form.Item name="startDate" label="Mulai" rules={[{ required: true }]}><DatePicker /></Form.Item><Form.Item name="endDate" label="Berakhir (opsional)"><DatePicker /></Form.Item></Space>
          <Form.Item name="withVat" label="Dikenai PPN" valuePropName="checked" extra="Kosongkan untuk mengikuti pengaturan perusahaan."><Switch /></Form.Item>
        </Form>
      </Modal>
      <Modal title="Ubah retainer" open={!!editing} onCancel={() => setEditing(null)} onOk={() => ef.submit()} confirmLoading={update.isPending} okText="Simpan" destroyOnHidden>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Perubahan biaya berlaku untuk periode yang belum ditagih; faktur yang sudah terbit tidak berubah." />
        <Form form={ef} layout="vertical" onFinish={(v) => update.mutate(v)}>
          <Form.Item name="monthlyFee" label="Biaya per bulan" rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="isActive" label="Aktif" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="reason" label="Alasan perubahan" rules={[{ required: true, min: 5 }]}><Input maxLength={255} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
