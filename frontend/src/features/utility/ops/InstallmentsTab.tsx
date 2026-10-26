import { INSTALLMENT_STATUSES, INSTALLMENT_STATUS_LABELS, type InstallmentStatus } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, DatePicker, Form, InputNumber, Modal, Radio, Select, Space, Table, Tag, Input } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import { fmtDate, fmtMoney } from '@/lib/format';
import { ConnectionSelect, ReasonModal, Stats, opt } from './kit';

interface Plan { id: string; number: string; customer_name: string; connection_number: string | null; total: string; status: InstallmentStatus; note: string | null; requester_name: string | null; paid_since: string; remaining: number; items: { seq: number; dueDate: string; amount: number; paid: number; status: string }[]; invoices: { invoice_id: string; number: string; open: string }[] }
const COLOR: Record<InstallmentStatus, string> = { DIAJUKAN: 'gold', AKTIF: 'blue', LUNAS: 'green', MACET: 'red', BATAL: 'default' };
const ITEM_COLOR: Record<string, string> = { LUNAS: 'green', TERLAMBAT: 'red', SEBAGIAN: 'blue', BELUM: 'default' };

/** Angsuran tunggakan: tunggakan dicicil sesuai jadwal; selama rencana berjalan sambungan tidak diusulkan putus */
export function InstallmentsTab() {
  const can = useCan();
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<Plan | null>(null);
  const list = useQuery({ queryKey: ['utility', 'installments', status], queryFn: () => get<Plan[]>(`/utility/installments${status ? `?status=${status}` : ''}`) });
  const all = useQuery({ queryKey: ['utility', 'installments', ''], queryFn: () => get<Plan[]>('/utility/installments') });
  const approve = useAction((id: string) => post(`/utility/installments/${id}/approve`, {}), { success: 'Rencana angsuran disetujui', invalidate: ['utility'] });
  const cancel = useAction((v: { id: string; reason: string }) => post(`/utility/installments/${v.id}/cancel`, { reason: v.reason }), { success: 'Rencana dibatalkan', invalidate: ['utility'], onSuccess: () => setCancelling(null) });
  const n = (s: InstallmentStatus) => (all.data ?? []).filter((p) => p.status === s).length;
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Cara kerja angsuran" description="Pilih tunggakan satu sambungan, tentukan jumlah cicilan dan tanggal pertama. Setelah disetujui orang lain, sambungan tidak diusulkan putus selama cicilan berjalan. Pembayaran dicatat seperti biasa di loket; status dihitung dari pembayaran sebenarnya. Cicilan telat lebih dari 14 hari = macet." />
      <Stats items={[
        { title: 'Menunggu persetujuan', value: n('DIAJUKAN'), warn: n('DIAJUKAN') > 0, onClick: () => setStatus('DIAJUKAN') },
        { title: 'Berjalan', value: n('AKTIF'), onClick: () => setStatus('AKTIF') },
        { title: 'Macet', value: n('MACET'), warn: n('MACET') > 0, onClick: () => setStatus('MACET') },
        { title: 'Lunas', value: n('LUNAS'), ok: true, onClick: () => setStatus('LUNAS') },
      ]} />
      <Space wrap style={{ marginBottom: 12 }}>
        <Radio.Group optionType="button" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'Semua' }, ...opt(INSTALLMENT_STATUSES, INSTALLMENT_STATUS_LABELS)]} />
        {can('POST', '/utility/installments') && <Button type="primary" onClick={() => setCreating(true)}>Buat rencana angsuran</Button>}
      </Space>
      <ResponsiveTable<Plan> rowKey="id" size="small" loading={list.isLoading} dataSource={list.data}
        expandable={{ expandedRowRender: (p) => <Table size="small" rowKey="seq" pagination={false} dataSource={p.items} columns={[
          { title: 'Cicilan ke', dataIndex: 'seq' }, { title: 'Jatuh tempo', render: (_: unknown, i: Plan['items'][number]) => fmtDate(i.dueDate) },
          { title: 'Jumlah', align: 'right' as const, render: (_: unknown, i: Plan['items'][number]) => fmtMoney(i.amount) },
          { title: 'Terbayar', align: 'right' as const, render: (_: unknown, i: Plan['items'][number]) => fmtMoney(i.paid) },
          { title: 'Status', render: (_: unknown, i: Plan['items'][number]) => <Tag color={ITEM_COLOR[i.status]}>{i.status === 'BELUM' ? 'Belum jatuh tempo' : i.status === 'SEBAGIAN' ? 'Sebagian' : i.status === 'TERLAMBAT' ? 'Terlambat' : 'Lunas'}</Tag> },
        ]} /> }}
        columns={[
          { title: 'Nomor', dataIndex: 'number' },
          { title: 'Pelanggan', render: (_: unknown, p: Plan) => <>{p.customer_name}{p.connection_number && <div style={{ fontSize: 12, color: '#64748b' }}>{p.connection_number}</div>}</> },
          { title: 'Total', align: 'right' as const, render: (_: unknown, p: Plan) => fmtMoney(p.total) },
          { title: 'Sisa', align: 'right' as const, render: (_: unknown, p: Plan) => fmtMoney(p.remaining) },
          { title: 'Cicilan', render: (_: unknown, p: Plan) => `${p.items.length}×` },
          { title: 'Status', render: (_: unknown, p: Plan) => <Tag color={COLOR[p.status]}>{INSTALLMENT_STATUS_LABELS[p.status]}</Tag> },
          { render: (_: unknown, p: Plan) => <Space>{p.status === 'DIAJUKAN' && can('POST', '/utility/installments/:id/approve') && <Button size="small" type="primary" onClick={() => approve.mutate(p.id)}>Setujui</Button>}{!['LUNAS', 'BATAL'].includes(p.status) && can('POST', '/utility/installments/:id/cancel') && <Button size="small" danger onClick={() => setCancelling(p)}>Batalkan</Button>}</Space> },
        ]} />
      <CreatePlan open={creating} onClose={() => setCreating(false)} />
      <ReasonModal open={!!cancelling} title="Batalkan rencana angsuran" danger okText="Batalkan rencana" loading={cancel.isPending} onCancel={() => setCancelling(null)} onSubmit={(t) => cancelling && cancel.mutate({ id: cancelling.id, reason: t })} />
    </>
  );
}

function CreatePlan({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f] = Form.useForm();
  const connectionId = Form.useWatch('connectionId', f) as string | undefined;
  const cover = useQuery({ queryKey: ['utility', 'installments', 'coverable', connectionId], queryFn: () => get<{ id: string; number: string; due_date: string; open: string; late_days: number }[]>(`/utility/installments/coverable/${connectionId}`), enabled: !!connectionId });
  const save = useAction((v: Record<string, unknown>) => post<{ number: string }>('/utility/installments', { ...v, firstDue: dayjs(v.firstDue as string).format('YYYY-MM-DD') }), { success: (r) => `Rencana ${r.number} diajukan untuk disetujui`, invalidate: ['utility'], onSuccess: () => { f.resetFields(); onClose(); } });
  return (
    <Modal open={open} title="Rencana angsuran tunggakan" okText="Ajukan" cancelText="Batal" confirmLoading={save.isPending} destroyOnHidden onCancel={onClose} onOk={() => f.validateFields().then((v) => save.mutate(v))}>
      <Form form={f} layout="vertical" initialValues={{ count: 3, intervalDays: 30, firstDue: dayjs().add(7, 'day') }}>
        <Form.Item name="connectionId" label="Sambungan" rules={[{ required: true }]}><ConnectionSelect /></Form.Item>
        <Form.Item name="invoiceIds" label="Tunggakan yang dicicil" rules={[{ required: true, message: 'Pilih sedikitnya satu tagihan' }]} extra={connectionId && !cover.isLoading && !(cover.data ?? []).length ? 'Sambungan ini tidak punya tunggakan yang bisa dicicil' : undefined}>
          <Select mode="multiple" loading={cover.isLoading} options={(cover.data ?? []).map((c) => ({ value: c.id, label: `${c.number} — sisa ${fmtMoney(c.open)}${c.late_days ? ` — telat ${c.late_days} hari` : ''}` }))} />
        </Form.Item>
        <Space align="start">
          <Form.Item name="count" label="Jumlah cicilan" rules={[{ required: true }]}><InputNumber min={2} max={12} style={{ width: 120 }} /></Form.Item>
          <Form.Item name="firstDue" label="Cicilan pertama" rules={[{ required: true }]}><DatePicker disabledDate={(d) => d.isBefore(dayjs(), 'day')} /></Form.Item>
          <Form.Item name="intervalDays" label="Jarak (hari)"><InputNumber min={7} max={90} style={{ width: 100 }} /></Form.Item>
        </Space>
        <Form.Item name="note" label="Catatan"><Input /></Form.Item>
      </Form>
    </Modal>
  );
}
