import { ADJUSTMENT_ADMIN_THRESHOLD, ADJUSTMENT_KINDS, ADJUSTMENT_KIND_LABELS, DECISION_STATUS_LABELS, type AdjustmentKind, type DecisionStatus } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Form, Input, InputNumber, Modal, Radio, Select, Space, Tag } from 'antd';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import { fmtDate, fmtMoney } from '@/lib/format';
import { ReasonModal, Stats, opt } from './kit';

interface Adj { id: string; number: string; invoice_number: string; customer_name: string; connection_number: string | null; kind: AdjustmentKind; amount: string; reason: string; status: DecisionStatus; requester_name: string | null; decider_name: string | null; decision_note: string | null; created_at: string }
interface Inv { id: string; number: string; customer: string; connection: string | null; date: string; total: string; paid: string; open: string; kind: string }
const COLOR: Record<DecisionStatus, string> = { DIAJUKAN: 'gold', DISETUJUI: 'green', DITOLAK: 'red' };

/** Koreksi tagihan dan pemutihan denda: nilai tagihan dikurangi lewat nota kredit berjurnal setelah disetujui orang lain */
export function AdjustmentsTab() {
  const can = useCan();
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [rejecting, setRejecting] = useState<Adj | null>(null);
  const list = useQuery({ queryKey: ['utility', 'adjustments', status], queryFn: () => get<Adj[]>(`/utility/adjustments${status ? `?status=${status}` : ''}`) });
  const sum = useQuery({ queryKey: ['utility', 'adjustments', 'summary'], queryFn: () => get<{ pending: number; pendingAmount: number; approved30d: number }>('/utility/adjustments/summary') });
  const approve = useAction((id: string) => post(`/utility/adjustments/${id}/approve`, {}), { success: 'Koreksi disetujui — nota kredit dan jurnal dibuat', invalidate: ['utility', 'invoices'] });
  const reject = useAction((v: { id: string; note: string }) => post(`/utility/adjustments/${v.id}/reject`, { note: v.note }), { success: 'Pengajuan ditolak', invalidate: ['utility'], onSuccess: () => setRejecting(null) });
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Koreksi harus disetujui orang lain" description={`Pelayanan mengajukan, Keuangan/Admin menyetujui. Koreksi mulai ${fmtMoney(ADJUSTMENT_ADMIN_THRESHOLD)} wajib disetujui Admin atau Pemilik. Setelah disetujui, sisa tagihan berkurang dan pendapatan dikoreksi otomatis di buku besar.`} />
      <Stats items={[
        { title: 'Menunggu persetujuan', value: sum.data?.pending ?? 0, warn: (sum.data?.pending ?? 0) > 0, hint: sum.data?.pending ? fmtMoney(sum.data.pendingAmount) : undefined },
        { title: 'Disetujui 30 hari', value: fmtMoney(sum.data?.approved30d ?? 0) },
      ]} />
      <Space wrap style={{ marginBottom: 12 }}>
        <Radio.Group optionType="button" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'Semua' }, ...opt(['DIAJUKAN', 'DISETUJUI', 'DITOLAK'] as DecisionStatus[], DECISION_STATUS_LABELS)]} />
        {can('POST', '/utility/adjustments') && <Button type="primary" onClick={() => setCreating(true)}>Ajukan koreksi</Button>}
      </Space>
      <ResponsiveTable<Adj> rowKey="id" size="small" loading={list.isLoading} dataSource={list.data}
        columns={[
          { title: 'Nomor', dataIndex: 'number' }, { title: 'Tanggal', render: (_: unknown, a: Adj) => fmtDate(a.created_at) },
          { title: 'Tagihan', render: (_: unknown, a: Adj) => <>{a.invoice_number}<div style={{ fontSize: 12, color: '#64748b' }}>{a.customer_name}</div></> },
          { title: 'Jenis', render: (_: unknown, a: Adj) => ADJUSTMENT_KIND_LABELS[a.kind] },
          { title: 'Jumlah', align: 'right' as const, render: (_: unknown, a: Adj) => fmtMoney(a.amount) },
          { title: 'Alasan', render: (_: unknown, a: Adj) => <>{a.reason}<div style={{ fontSize: 12, color: '#64748b' }}>Diajukan {a.requester_name ?? '-'}</div></> },
          { title: 'Status', render: (_: unknown, a: Adj) => <><Tag color={COLOR[a.status]}>{DECISION_STATUS_LABELS[a.status]}</Tag>{a.decider_name && <div style={{ fontSize: 12, color: '#64748b' }}>{a.decider_name}{a.decision_note ? `: ${a.decision_note}` : ''}</div>}</> },
          { render: (_: unknown, a: Adj) => a.status === 'DIAJUKAN' && can('POST', '/utility/adjustments/:id/approve') ? <Space><Button size="small" type="primary" loading={approve.isPending} onClick={() => approve.mutate(a.id)}>Setujui</Button><Button size="small" danger onClick={() => setRejecting(a)}>Tolak</Button></Space> : null },
        ]} />
      <CreateAdjustment open={creating} onClose={() => setCreating(false)} />
      <ReasonModal open={!!rejecting} title="Tolak pengajuan" label="Alasan penolakan" danger okText="Tolak" loading={reject.isPending} onCancel={() => setRejecting(null)} onSubmit={(t) => rejecting && reject.mutate({ id: rejecting.id, note: t })} />
    </>
  );
}

function CreateAdjustment({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f] = Form.useForm();
  const [q, setQ] = useState('');
  const kind = Form.useWatch('kind', f) as AdjustmentKind | undefined;
  const invoiceId = Form.useWatch('invoiceId', f) as string | undefined;
  const invs = useQuery({ queryKey: ['utility', 'adjustments', 'invoices', q], queryFn: () => get<Inv[]>(`/utility/adjustments/invoices?q=${encodeURIComponent(q)}`), enabled: open });
  const inv = (invs.data ?? []).find((i) => i.id === invoiceId);
  const save = useAction((v: Record<string, unknown>) => post('/utility/adjustments', { ...v, amount: v.amount != null ? String(v.amount) : undefined }), { success: 'Pengajuan koreksi dikirim', invalidate: ['utility'], onSuccess: () => { f.resetFields(); onClose(); } });
  return (
    <Modal open={open} title="Ajukan koreksi tagihan" okText="Ajukan" cancelText="Batal" confirmLoading={save.isPending} destroyOnHidden onCancel={onClose} onOk={() => f.validateFields().then((v) => save.mutate(v))}>
      <Form form={f} layout="vertical">
        <Form.Item name="invoiceId" label="Tagihan yang masih bersisa" rules={[{ required: true }]}>
          <Select showSearch filterOption={false} onSearch={setQ} placeholder="Cari nomor tagihan, pelanggan, atau sambungan" loading={invs.isLoading}
            options={(invs.data ?? []).map((i) => ({ value: i.id, label: `${i.number} — ${i.customer}${i.connection ? ` (${i.connection})` : ''} — sisa ${fmtMoney(i.open)} ${i.kind === 'AIR' ? '' : '[non-air]'}` }))} />
        </Form.Item>
        <Form.Item name="kind" label="Jenis koreksi" rules={[{ required: true }]}><Select options={opt(ADJUSTMENT_KINDS, ADJUSTMENT_KIND_LABELS)} /></Form.Item>
        {kind !== 'PEMBATALAN' && <Form.Item name="amount" label="Jumlah pengurangan (termasuk PPN bila ada)" rules={[{ required: true }]} extra={inv ? `Sisa tagihan ${fmtMoney(inv.open)}` : undefined}><InputNumber min={1} style={{ width: 220 }} /></Form.Item>}
        {kind === 'PEMBATALAN' && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Seluruh sisa tagihan akan dibatalkan (hanya untuk tagihan yang belum dibayar sama sekali)." />}
        <Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5, message: 'Tulis alasan (minimal 5 huruf)' }]}><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}
