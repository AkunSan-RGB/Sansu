import { COMPLAINT_CATEGORIES, COMPLAINT_CATEGORY_LABELS, COMPLAINT_CHANNELS, COMPLAINT_CHANNEL_LABELS, COMPLAINT_NEXT, COMPLAINT_STATUS_LABELS, PRIORITIES, PRIORITY_LABELS, WORK_ORDER_TYPES, WORK_ORDER_TYPE_LABELS, type ComplaintCategory, type ComplaintStatus } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Descriptions, Drawer, Form, Input, Modal, Radio, Select, Space, Tag, Timeline, Typography } from 'antd';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import { fmtDate } from '@/lib/format';
import dayjs from 'dayjs';
import { ConnectionSelect, PRIORITY_COLOR, ReasonModal, StaffSelect, Stats, opt } from './kit';

interface Complaint {
  id: string; number: string; connection_id: string | null; category: ComplaintCategory; priority: string; channel: string; description: string; location: string | null; status: ComplaintStatus; assigned_to_id: string | null;
  due_at: string | null; resolved_at: string | null; resolution: string | null; work_order_id: string | null; created_at: string; connection_number: string | null; customer_name: string | null; assignee_name: string | null; overdue: boolean; reporter_phone: string | null;
  events?: { id: string; at: string; user_name: string | null; kind: string; from_status: string | null; to_status: string | null; note: string | null }[];
}
interface Summary { open: number; baru: number; overdue: number; done30d: number; onTimePct30d: number | null; avgHours30d: number | null }
const STATUS_COLOR: Record<string, string> = { BARU: 'red', DITUGASKAN: 'gold', DIKERJAKAN: 'blue', SELESAI: 'cyan', DITUTUP: 'default' };
const when = (v: string | null) => (v ? dayjs(v).format('DD MMM HH:mm') : '-');

/** Pengaduan dan gangguan pelanggan: dicatat, ditugaskan, dikerjakan, lalu ditutup oleh orang lain dari pelaksananya */
export function ComplaintsTab() {
  const can = useCan();
  const [scope, setScope] = useState<'open' | 'all'>('open');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['utility', 'complaints', scope, q], queryFn: () => get<Complaint[]>(`/utility/complaints?open=${scope === 'open'}${q ? `&q=${encodeURIComponent(q)}` : ''}`) });
  const sum = useQuery({ queryKey: ['utility', 'complaints', 'summary'], queryFn: () => get<Summary>('/utility/complaints/summary') });
  const s = sum.data;
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Alur pengaduan" description="Catat pengaduan → tugaskan ke petugas → petugas mengerjakan dan mengisi hasilnya → ditutup oleh orang lain (bukan pelaksananya). Setiap kategori punya batas waktu penanganan; yang lewat batas ditandai merah." />
      <Stats items={[
        { title: 'Pengaduan terbuka', value: s?.open ?? 0 },
        { title: 'Belum ditugaskan', value: s?.baru ?? 0, warn: (s?.baru ?? 0) > 0 },
        { title: 'Lewat batas waktu', value: s?.overdue ?? 0, warn: (s?.overdue ?? 0) > 0 },
        { title: 'Selesai 30 hari', value: s?.done30d ?? 0, hint: s?.onTimePct30d != null ? `${s.onTimePct30d}% tepat waktu · rata-rata ${s.avgHours30d} jam` : undefined, ok: true },
      ]} />
      <Space wrap style={{ marginBottom: 12 }}>
        <Radio.Group optionType="button" value={scope} onChange={(e) => setScope(e.target.value)} options={[{ value: 'open', label: 'Yang belum tuntas' }, { value: 'all', label: 'Semua' }]} />
        <Input.Search allowClear placeholder="Cari nomor, pelanggan, isi" onSearch={setQ} style={{ width: 260 }} />
        {can('POST', '/utility/complaints') && <Button type="primary" onClick={() => setCreating(true)}>Catat pengaduan</Button>}
      </Space>
      <ResponsiveTable<Complaint>
        rowKey="id" size="small" loading={list.isLoading} dataSource={list.data} onRow={(r) => ({ onClick: () => setOpenId(r.id), style: { cursor: 'pointer' } })}
        onMobileClick={(r) => setOpenId(r.id)}
        columns={[
          { title: 'Nomor', dataIndex: 'number' },
          { title: 'Jenis', render: (_: unknown, r: Complaint) => COMPLAINT_CATEGORY_LABELS[r.category] },
          { title: 'Pelanggan', render: (_: unknown, r: Complaint) => <>{r.customer_name ?? '-'}{r.connection_number && <div style={{ fontSize: 12, color: '#64748b' }}>{r.connection_number}</div>}</> },
          { title: 'Prioritas', render: (_: unknown, r: Complaint) => <Tag color={PRIORITY_COLOR[r.priority]}>{PRIORITY_LABELS[r.priority as keyof typeof PRIORITY_LABELS]}</Tag> },
          { title: 'Status', render: (_: unknown, r: Complaint) => <Tag color={STATUS_COLOR[r.status]}>{COMPLAINT_STATUS_LABELS[r.status]}</Tag> },
          { title: 'Petugas', render: (_: unknown, r: Complaint) => r.assignee_name ?? <Typography.Text type="secondary">belum ditugaskan</Typography.Text> },
          { title: 'Batas waktu', render: (_: unknown, r: Complaint) => <span style={r.overdue ? { color: '#dc2626', fontWeight: 600 } : undefined}>{when(r.due_at)}{r.overdue && ' · lewat'}</span> },
        ]}
      />
      <CreateComplaint open={creating} onClose={() => setCreating(false)} />
      <ComplaintDrawer id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function CreateComplaint({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f] = Form.useForm();
  const save = useAction((v: Record<string, unknown>) => post<{ number: string }>('/utility/complaints', v), { success: (r) => `Pengaduan ${r.number} dicatat`, invalidate: ['utility'], onSuccess: () => { f.resetFields(); onClose(); } });
  const conn = Form.useWatch('connectionId', f);
  return (
    <Modal open={open} title="Catat pengaduan" okText="Simpan" cancelText="Batal" confirmLoading={save.isPending} destroyOnHidden onCancel={onClose} onOk={() => f.validateFields().then((v) => save.mutate(v))}>
      <Form form={f} layout="vertical" initialValues={{ channel: 'TELEPON' }}>
        <Form.Item name="connectionId" label="Sambungan pelanggan" extra="Kosongkan bila pelapor belum menjadi pelanggan"><ConnectionSelect allowClear /></Form.Item>
        {!conn && <Form.Item name="reporterName" label="Nama pelapor" rules={[{ required: true, message: 'Isi nama pelapor atau pilih sambungan' }]}><Input /></Form.Item>}
        <Form.Item name="reporterPhone" label="Telepon pelapor"><Input /></Form.Item>
        <Form.Item name="category" label="Jenis pengaduan" rules={[{ required: true }]}><Select options={opt(COMPLAINT_CATEGORIES, COMPLAINT_CATEGORY_LABELS)} /></Form.Item>
        <Space style={{ width: '100%' }} align="start">
          <Form.Item name="priority" label="Prioritas" extra="Kosong = otomatis"><Select allowClear style={{ width: 150 }} options={opt(PRIORITIES, PRIORITY_LABELS)} /></Form.Item>
          <Form.Item name="channel" label="Diterima lewat"><Select style={{ width: 200 }} options={opt(COMPLAINT_CHANNELS, COMPLAINT_CHANNEL_LABELS)} /></Form.Item>
        </Space>
        <Form.Item name="description" label="Uraian" rules={[{ required: true, min: 5, message: 'Tulis sedikitnya 5 huruf' }]}><Input.TextArea rows={3} maxLength={1000} showCount /></Form.Item>
        <Form.Item name="location" label="Lokasi kejadian"><Input placeholder="Mis. depan Gang 3" /></Form.Item>
      </Form>
    </Modal>
  );
}

function ComplaintDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const can = useCan();
  const q = useQuery({ queryKey: ['utility', 'complaints', 'one', id], queryFn: () => get<Complaint>(`/utility/complaints/${id}`), enabled: !!id });
  const c = q.data;
  const [mode, setMode] = useState<null | { kind: 'assign' } | { kind: 'status'; to: ComplaintStatus } | { kind: 'note' } | { kind: 'wo' }>(null);
  const [assignee, setAssignee] = useState<string>();
  const [wf] = Form.useForm();
  const done = () => { setMode(null); setAssignee(undefined); };
  const assign = useAction((note: string) => post(`/utility/complaints/${id}/assign`, { assigneeId: assignee, note: note || undefined }), { success: 'Petugas ditugaskan', invalidate: ['utility'], onSuccess: done });
  const status = useAction((v: { status: ComplaintStatus; text: string }) => post(`/utility/complaints/${id}/status`, v.status === 'SELESAI' ? { status: v.status, resolution: v.text } : { status: v.status, note: v.text || undefined }), { success: 'Status diperbarui', invalidate: ['utility'], onSuccess: done });
  const note = useAction((text: string) => post(`/utility/complaints/${id}/note`, { note: text }), { success: 'Catatan ditambahkan', invalidate: ['utility'], onSuccess: done });
  const wo = useAction((v: Record<string, unknown>) => post<{ number: string }>('/utility/work-orders', { ...v, complaintId: id, description: c?.description }), { success: (r) => `Perintah kerja ${r.number} dibuat`, invalidate: ['utility'], onSuccess: () => { wf.resetFields(); done(); } });
  const next = c ? COMPLAINT_NEXT[c.status].filter((n) => !(n === 'DITUGASKAN' && c.status === 'DITUGASKAN')) : [];
  return (
    <Drawer open={!!id} onClose={onClose} width={520} title={c ? `${c.number} · ${COMPLAINT_CATEGORY_LABELS[c.category]}` : 'Pengaduan'} loading={q.isLoading}>
      {c && (
        <>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="Status"><Tag color={STATUS_COLOR[c.status]}>{COMPLAINT_STATUS_LABELS[c.status]}</Tag> {c.overdue && <Tag color="red">Lewat batas waktu</Tag>}</Descriptions.Item>
            <Descriptions.Item label="Pelapor">{c.customer_name ?? '-'}{c.reporter_phone ? ` · ${c.reporter_phone}` : ''}</Descriptions.Item>
            <Descriptions.Item label="Sambungan">{c.connection_number ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="Lokasi">{c.location ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="Uraian">{c.description}</Descriptions.Item>
            <Descriptions.Item label="Petugas">{c.assignee_name ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="Batas waktu">{when(c.due_at)}</Descriptions.Item>
            {c.resolution && <Descriptions.Item label="Hasil pekerjaan">{c.resolution}</Descriptions.Item>}
            <Descriptions.Item label="Diterima">{fmtDate(c.created_at)} · {COMPLAINT_CHANNEL_LABELS[c.channel as keyof typeof COMPLAINT_CHANNEL_LABELS]}</Descriptions.Item>
          </Descriptions>
          <Space wrap style={{ margin: '12px 0' }}>
            {can('POST', '/utility/complaints/:id/assign') && ['BARU', 'DITUGASKAN'].includes(c.status) && <Button type="primary" onClick={() => setMode({ kind: 'assign' })}>{c.assignee_name ? 'Ganti petugas' : 'Tugaskan'}</Button>}
            {next.map((n) => <Button key={n} type={n === 'SELESAI' || n === 'DITUTUP' ? 'primary' : 'default'} onClick={() => setMode({ kind: 'status', to: n })}>{n === 'DIKERJAKAN' ? 'Mulai dikerjakan' : n === 'SELESAI' ? 'Tandai selesai dikerjakan' : n === 'DITUTUP' ? 'Tutup pengaduan' : COMPLAINT_STATUS_LABELS[n]}</Button>)}
            {!c.work_order_id && ['DITUGASKAN', 'DIKERJAKAN'].includes(c.status) && can('POST', '/utility/work-orders') && <Button onClick={() => setMode({ kind: 'wo' })}>Buat perintah kerja</Button>}
            <Button onClick={() => setMode({ kind: 'note' })}>Tambah catatan</Button>
          </Space>
          <Typography.Title level={5}>Riwayat</Typography.Title>
          <Timeline items={(c.events ?? []).map((e) => ({ children: <><b>{when(e.at)}</b> · {e.user_name ?? 'Pelanggan (portal)'}<div>{e.note ?? (e.to_status ? `Status: ${COMPLAINT_STATUS_LABELS[e.to_status as ComplaintStatus] ?? e.to_status}` : '')}</div></> }))} />
        </>
      )}
      <Modal open={mode?.kind === 'assign'} title="Tugaskan petugas" okText="Tugaskan" cancelText="Batal" okButtonProps={{ disabled: !assignee, loading: assign.isPending }} onCancel={done} onOk={() => assign.mutate('')}>
        <StaffSelect value={assignee} onChange={setAssignee} />
      </Modal>
      <ReasonModal open={mode?.kind === 'status'} loading={status.isPending} title={mode?.kind === 'status' ? COMPLAINT_STATUS_LABELS[mode.to] : ''} label={mode?.kind === 'status' && mode.to === 'SELESAI' ? 'Apa yang dikerjakan?' : 'Catatan'} required={mode?.kind === 'status' && mode.to === 'SELESAI'} onCancel={done} onSubmit={(t) => mode?.kind === 'status' && status.mutate({ status: mode.to, text: t })} />
      <ReasonModal open={mode?.kind === 'note'} loading={note.isPending} title="Tambah catatan" label="Catatan" onCancel={done} onSubmit={(t) => note.mutate(t)} />
      <Modal open={mode?.kind === 'wo'} title="Buat perintah kerja" okText="Buat" cancelText="Batal" confirmLoading={wo.isPending} destroyOnHidden onCancel={done} onOk={() => wf.validateFields().then((v) => wo.mutate(v))}>
        <Form form={wf} layout="vertical" initialValues={{ type: 'PERBAIKAN', title: c ? `${COMPLAINT_CATEGORY_LABELS[c.category]} — ${c.location ?? c.connection_number ?? ''}` : '' }}>
          <Form.Item name="type" label="Jenis pekerjaan"><Select options={opt(WORK_ORDER_TYPES, WORK_ORDER_TYPE_LABELS)} /></Form.Item>
          <Form.Item name="title" label="Judul" rules={[{ required: true, min: 3 }]}><Input /></Form.Item>
          <Form.Item name="assigneeId" label="Teknisi"><StaffSelect allowClear /></Form.Item>
        </Form>
      </Modal>
    </Drawer>
  );
}
