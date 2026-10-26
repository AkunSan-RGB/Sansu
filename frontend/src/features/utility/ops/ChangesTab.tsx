import { CHANGE_KINDS, CHANGE_KIND_LABELS, DECISION_STATUS_LABELS, type ChangeKind, type DecisionStatus } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Form, Input, Modal, Radio, Select, Space, Tag } from 'antd';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction, useCustomers } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import { fmtDate } from '@/lib/format';
import { Tariff } from '../utility/shared';
import { ConnectionSelect, ReasonModal, opt } from './kit';

interface Change { id: string; connection_number: string; customer_name: string; kind: ChangeKind; before: Record<string, string | null>; after: Record<string, string | null>; reason: string; status: DecisionStatus; requester_name: string | null; decider_name: string | null; decision_note: string | null; created_at: string }
const COLOR: Record<DecisionStatus, string> = { DIAJUKAN: 'gold', DISETUJUI: 'green', DITOLAK: 'red' };
const FIELD: Record<string, string> = { customer: 'Pelanggan', tariff: 'Golongan', address: 'Alamat', zone: 'Zona', status: 'Status' };
const summary = (o: Record<string, string | null>) => Object.entries(o).filter(([k]) => FIELD[k]).map(([k, v]) => `${FIELD[k]}: ${v ?? '-'}`).join(' · ');

/** Perubahan data sambungan: balik nama, ganti golongan, ubah alamat, tutup permanen. Diajukan pelayanan, disetujui orang lain. */
export function ChangesTab() {
  const can = useCan();
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [rejecting, setRejecting] = useState<Change | null>(null);
  const list = useQuery({ queryKey: ['utility', 'changes', status], queryFn: () => get<Change[]>(`/utility/changes${status ? `?status=${status}` : ''}`) });
  const approve = useAction((id: string) => post(`/utility/changes/${id}/approve`, {}), { success: 'Perubahan disetujui dan diterapkan', invalidate: ['utility'] });
  const reject = useAction((v: { id: string; note: string }) => post(`/utility/changes/${v.id}/reject`, { note: v.note }), { success: 'Pengajuan ditolak', invalidate: ['utility'], onSuccess: () => setRejecting(null) });
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Perubahan sambungan perlu persetujuan" description="Pelayanan mengajukan, Keuangan/Admin menyetujui (bukan orang yang sama). Balik nama dan tutup permanen hanya bisa bila pelanggan tidak punya tunggakan. Ganti golongan hanya antar tarif berjenis meter yang sama." />
      <Space wrap style={{ marginBottom: 12 }}>
        <Radio.Group optionType="button" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'Semua' }, ...opt(['DIAJUKAN', 'DISETUJUI', 'DITOLAK'] as DecisionStatus[], DECISION_STATUS_LABELS)]} />
        {can('POST', '/utility/changes') && <Button type="primary" onClick={() => setCreating(true)}>Ajukan perubahan</Button>}
      </Space>
      <ResponsiveTable<Change> rowKey="id" size="small" loading={list.isLoading} dataSource={list.data}
        columns={[
          { title: 'Tanggal', render: (_: unknown, c: Change) => fmtDate(c.created_at) },
          { title: 'Sambungan', render: (_: unknown, c: Change) => <>{c.connection_number}<div style={{ fontSize: 12, color: '#64748b' }}>{c.customer_name}</div></> },
          { title: 'Jenis', render: (_: unknown, c: Change) => CHANGE_KIND_LABELS[c.kind] },
          { title: 'Perubahan', render: (_: unknown, c: Change) => <div style={{ fontSize: 12 }}><div>Dari: {summary(c.before)}</div><div>Menjadi: {summary(c.after)}</div></div> },
          { title: 'Alasan', render: (_: unknown, c: Change) => <>{c.reason}<div style={{ fontSize: 12, color: '#64748b' }}>Diajukan {c.requester_name ?? '-'}</div></> },
          { title: 'Status', render: (_: unknown, c: Change) => <><Tag color={COLOR[c.status]}>{DECISION_STATUS_LABELS[c.status]}</Tag>{c.decider_name && <div style={{ fontSize: 12, color: '#64748b' }}>{c.decider_name}{c.decision_note ? `: ${c.decision_note}` : ''}</div>}</> },
          { render: (_: unknown, c: Change) => c.status === 'DIAJUKAN' && can('POST', '/utility/changes/:id/approve') ? <Space><Button size="small" type="primary" loading={approve.isPending} onClick={() => approve.mutate(c.id)}>Setujui</Button><Button size="small" danger onClick={() => setRejecting(c)}>Tolak</Button></Space> : null },
        ]} />
      <CreateChange open={creating} onClose={() => setCreating(false)} />
      <ReasonModal open={!!rejecting} title="Tolak pengajuan" label="Alasan penolakan" danger okText="Tolak" loading={reject.isPending} onCancel={() => setRejecting(null)} onSubmit={(t) => rejecting && reject.mutate({ id: rejecting.id, note: t })} />
    </>
  );
}

function CreateChange({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f] = Form.useForm();
  const kind = Form.useWatch('kind', f) as ChangeKind | undefined;
  const customers = useCustomers();
  const tariffs = useQuery({ queryKey: ['utility', 'tariffs'], queryFn: () => get<Tariff[]>('/utility/tariffs') });
  const save = useAction((v: Record<string, unknown>) => post('/utility/changes', v), { success: 'Pengajuan dikirim untuk disetujui', invalidate: ['utility'], onSuccess: () => { f.resetFields(); onClose(); } });
  return (
    <Modal open={open} title="Ajukan perubahan sambungan" okText="Ajukan" cancelText="Batal" confirmLoading={save.isPending} destroyOnHidden onCancel={onClose} onOk={() => f.validateFields().then((v) => save.mutate(v))}>
      <Form form={f} layout="vertical">
        <Form.Item name="connectionId" label="Sambungan" rules={[{ required: true }]}><ConnectionSelect /></Form.Item>
        <Form.Item name="kind" label="Jenis perubahan" rules={[{ required: true }]}><Select options={opt(CHANGE_KINDS, CHANGE_KIND_LABELS)} /></Form.Item>
        {kind === 'BALIK_NAMA' && <Form.Item name="newCustomerId" label="Pelanggan baru (pemilik baru)" rules={[{ required: true }]} extra="Pelanggan baru harus sudah terdaftar di menu Pelanggan"><Select showSearch optionFilterProp="label" options={(customers.data ?? []).map((c) => ({ value: c.id, label: c.name }))} /></Form.Item>}
        {kind === 'GANTI_TARIF' && <Form.Item name="newTariffId" label="Golongan baru" rules={[{ required: true }]}><Select options={(tariffs.data ?? []).filter((t) => t.isActive).map((t) => ({ value: t.id, label: t.name }))} /></Form.Item>}
        {kind === 'PINDAH_ALAMAT' && <><Form.Item name="newAddress" label="Alamat baru" rules={[{ required: true, min: 5 }]}><Input.TextArea rows={2} /></Form.Item><Form.Item name="newZone" label="Zona baru"><Input /></Form.Item></>}
        <Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5, message: 'Tulis alasan (minimal 5 huruf)' }]}><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}
