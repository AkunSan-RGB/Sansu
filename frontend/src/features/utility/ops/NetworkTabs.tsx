import { ASSET_CONDITIONS, ASSET_CONDITION_LABELS, NETWORK_ASSET_LABELS, NETWORK_ASSET_TYPES, PRIORITIES, PRIORITY_LABELS, WORK_ORDER_STATUS_LABELS, WORK_ORDER_TYPES, WORK_ORDER_TYPE_LABELS, type AssetCondition, type NetworkAssetType, type WorkOrderStatus } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, DatePicker, Form, Input, InputNumber, Modal, Radio, Select, Space, Switch, Tag } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post, put } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import { fmtDate, fmtMoney } from '@/lib/format';
import { PRIORITY_COLOR, StaffSelect, Stats, opt } from './kit';

interface Asset { id: string; code: string; name: string; type: NetworkAssetType; zone: string | null; location: string | null; installed_on: string | null; condition: AssetCondition; note: string | null; is_active: boolean; open_orders: number; last_done: string | null }
interface Order { id: string; number: string; asset_id: string | null; type: string; title: string; description: string | null; priority: string; status: WorkOrderStatus; planned_on: string | null; finished_at: string | null; labor_cost: string; material_cost: string; result: string | null; asset_code: string | null; asset_name: string | null; complaint_number: string | null; assignee_name: string | null }
interface WoSummary { open: number; done30d: number; cost30d: number; brokenAssets: number; needCare: number }
const COND_COLOR: Record<AssetCondition, string> = { BAIK: 'green', PERLU_PERAWATAN: 'orange', RUSAK: 'red' };
const WO_COLOR: Record<WorkOrderStatus, string> = { DIBUAT: 'gold', DIKERJAKAN: 'blue', SELESAI: 'green', BATAL: 'default' };

/** Aset jaringan: sumber air, pompa, reservoir, pipa, valve; kondisi diperbarui otomatis saat perintah kerja selesai */
export function NetworkAssetsTab() {
  const can = useCan();
  const q = useQuery({ queryKey: ['utility', 'network-assets'], queryFn: () => get<Asset[]>('/utility/network-assets') });
  const sum = useQuery({ queryKey: ['utility', 'work-orders', 'summary'], queryFn: () => get<WoSummary>('/utility/work-orders/summary') });
  const [edit, setEdit] = useState<Asset | 'new' | null>(null);
  const [wo, setWo] = useState<Asset | null>(null);
  const [f] = Form.useForm();
  const save = useAction((v: Record<string, unknown>) => { const body = { ...v, installedOn: v.installedOn ? dayjs(v.installedOn as string).format('YYYY-MM-DD') : undefined }; return edit && edit !== 'new' ? put(`/utility/network-assets/${edit.id}`, body) : post('/utility/network-assets', body); }, { success: 'Aset disimpan', invalidate: ['utility'], onSuccess: () => setEdit(null) });
  const manage = can('POST', '/utility/network-assets');
  return (
    <>
      <Stats items={[
        { title: 'Aset rusak', value: sum.data?.brokenAssets ?? 0, warn: (sum.data?.brokenAssets ?? 0) > 0 },
        { title: 'Perlu perawatan', value: sum.data?.needCare ?? 0, warn: (sum.data?.needCare ?? 0) > 0 },
        { title: 'Perintah kerja berjalan', value: sum.data?.open ?? 0 },
      ]} />
      {manage && <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { f.resetFields(); f.setFieldsValue({ condition: 'BAIK', isActive: true }); setEdit('new'); }}>Tambah aset</Button>}
      <ResponsiveTable<Asset> rowKey="id" size="small" loading={q.isLoading} dataSource={q.data} pagination={{ pageSize: 20 }}
        columns={[
          { title: 'Kode', dataIndex: 'code' }, { title: 'Nama', dataIndex: 'name' },
          { title: 'Jenis', render: (_: unknown, a: Asset) => NETWORK_ASSET_LABELS[a.type] },
          { title: 'Zona / lokasi', render: (_: unknown, a: Asset) => [a.zone, a.location].filter(Boolean).join(' · ') || '-' },
          { title: 'Kondisi', render: (_: unknown, a: Asset) => <Tag color={a.is_active ? COND_COLOR[a.condition] : 'default'}>{a.is_active ? ASSET_CONDITION_LABELS[a.condition] : 'Nonaktif'}</Tag> },
          { title: 'Terakhir dirawat', render: (_: unknown, a: Asset) => fmtDate(a.last_done) },
          { title: 'PK terbuka', dataIndex: 'open_orders', align: 'right' as const },
          { render: (_: unknown, a: Asset) => <Space>{can('POST', '/utility/work-orders') && <Button size="small" onClick={() => setWo(a)}>Buat perintah kerja</Button>}{manage && <Button size="small" onClick={() => { f.setFieldsValue({ ...a, installedOn: a.installed_on ? dayjs(a.installed_on) : undefined, isActive: a.is_active }); setEdit(a); }}>Ubah</Button>}</Space> },
        ]} />
      <Modal open={!!edit} title={edit === 'new' ? 'Tambah aset jaringan' : 'Ubah aset'} okText="Simpan" cancelText="Batal" confirmLoading={save.isPending} destroyOnHidden onCancel={() => setEdit(null)} onOk={() => f.validateFields().then((v) => save.mutate(v))}>
        <Form form={f} layout="vertical">
          <Space align="start"><Form.Item name="code" label="Kode" rules={[{ required: true, min: 2 }]}><Input placeholder="PMP-01" /></Form.Item><Form.Item name="name" label="Nama" rules={[{ required: true, min: 3 }]}><Input style={{ width: 260 }} /></Form.Item></Space>
          <Form.Item name="type" label="Jenis" rules={[{ required: true }]}><Select options={opt(NETWORK_ASSET_TYPES, NETWORK_ASSET_LABELS)} /></Form.Item>
          <Space align="start"><Form.Item name="zone" label="Zona"><Input /></Form.Item><Form.Item name="location" label="Lokasi"><Input style={{ width: 240 }} /></Form.Item></Space>
          <Space align="start"><Form.Item name="installedOn" label="Dipasang"><DatePicker /></Form.Item><Form.Item name="condition" label="Kondisi"><Select style={{ width: 200 }} options={opt(ASSET_CONDITIONS, ASSET_CONDITION_LABELS)} /></Form.Item></Space>
          <Form.Item name="note" label="Catatan"><Input.TextArea rows={2} /></Form.Item>
          {edit !== 'new' && <Form.Item name="isActive" label="Aktif" valuePropName="checked"><Switch /></Form.Item>}
        </Form>
      </Modal>
      <NewOrder asset={wo} onClose={() => setWo(null)} />
    </>
  );
}

function NewOrder({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  const [f] = Form.useForm();
  const save = useAction((v: Record<string, unknown>) => post<{ number: string }>('/utility/work-orders', { ...v, assetId: asset?.id, plannedOn: v.plannedOn ? dayjs(v.plannedOn as string).format('YYYY-MM-DD') : undefined }), { success: (r) => `Perintah kerja ${r.number} dibuat`, invalidate: ['utility'], onSuccess: onClose });
  return (
    <Modal open={!!asset} title={`Perintah kerja — ${asset?.name ?? ''}`} okText="Buat" cancelText="Batal" confirmLoading={save.isPending} destroyOnHidden onCancel={onClose} onOk={() => f.validateFields().then((v) => save.mutate(v))}>
      <Form form={f} layout="vertical" initialValues={{ type: 'PERAWATAN', priority: 'NORMAL' }}>
        <Form.Item name="type" label="Jenis pekerjaan"><Select options={opt(WORK_ORDER_TYPES, WORK_ORDER_TYPE_LABELS)} /></Form.Item>
        <Form.Item name="title" label="Judul" rules={[{ required: true, min: 3 }]}><Input /></Form.Item>
        <Form.Item name="description" label="Uraian"><Input.TextArea rows={2} /></Form.Item>
        <Space align="start"><Form.Item name="priority" label="Prioritas"><Select style={{ width: 140 }} options={opt(PRIORITIES, PRIORITY_LABELS)} /></Form.Item><Form.Item name="plannedOn" label="Rencana tanggal"><DatePicker /></Form.Item></Space>
        <Form.Item name="assigneeId" label="Teknisi"><StaffSelect allowClear /></Form.Item>
      </Form>
    </Modal>
  );
}

/** Perintah kerja: dari pengaduan atau jadwal perawatan; biaya dan hasil dicatat saat selesai */
export function WorkOrdersTab() {
  const can = useCan();
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: ['utility', 'work-orders', status], queryFn: () => get<Order[]>(`/utility/work-orders${status ? `?status=${status}` : ''}`) });
  const sum = useQuery({ queryKey: ['utility', 'work-orders', 'summary'], queryFn: () => get<WoSummary>('/utility/work-orders/summary') });
  const [act, setAct] = useState<{ o: Order; to: WorkOrderStatus } | null>(null);
  const [f] = Form.useForm();
  const set = useAction((v: Record<string, unknown>) => post(`/utility/work-orders/${act!.o.id}/status`, { status: act!.to, ...v, laborCost: v.laborCost != null ? String(v.laborCost) : undefined, materialCost: v.materialCost != null ? String(v.materialCost) : undefined }), { success: 'Status perintah kerja diperbarui', invalidate: ['utility'], onSuccess: () => { f.resetFields(); setAct(null); } });
  const NEXT: Record<WorkOrderStatus, WorkOrderStatus[]> = { DIBUAT: ['DIKERJAKAN', 'BATAL'], DIKERJAKAN: ['SELESAI', 'BATAL'], SELESAI: [], BATAL: [] };
  return (
    <>
      <Stats items={[
        { title: 'Berjalan', value: sum.data?.open ?? 0 },
        { title: 'Selesai 30 hari', value: sum.data?.done30d ?? 0, ok: true },
        { title: 'Biaya 30 hari', value: fmtMoney(sum.data?.cost30d ?? 0), hint: 'Upah + bahan' },
      ]} />
      <Radio.Group optionType="button" style={{ marginBottom: 12 }} value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'Semua' }, ...opt(['DIBUAT', 'DIKERJAKAN', 'SELESAI', 'BATAL'] as WorkOrderStatus[], WORK_ORDER_STATUS_LABELS)]} />
      <ResponsiveTable<Order> rowKey="id" size="small" loading={q.isLoading} dataSource={q.data} pagination={{ pageSize: 20 }}
        columns={[
          { title: 'Nomor', dataIndex: 'number' },
          { title: 'Pekerjaan', render: (_: unknown, o: Order) => <>{o.title}<div style={{ fontSize: 12, color: '#64748b' }}>{WORK_ORDER_TYPE_LABELS[o.type as keyof typeof WORK_ORDER_TYPE_LABELS]}{o.asset_name && ` · ${o.asset_name}`}{o.complaint_number && ` · dari ${o.complaint_number}`}</div></> },
          { title: 'Prioritas', render: (_: unknown, o: Order) => <Tag color={PRIORITY_COLOR[o.priority]}>{PRIORITY_LABELS[o.priority as keyof typeof PRIORITY_LABELS]}</Tag> },
          { title: 'Teknisi', render: (_: unknown, o: Order) => o.assignee_name ?? '-' },
          { title: 'Rencana', render: (_: unknown, o: Order) => fmtDate(o.planned_on) },
          { title: 'Status', render: (_: unknown, o: Order) => <Tag color={WO_COLOR[o.status]}>{WORK_ORDER_STATUS_LABELS[o.status]}</Tag> },
          { title: 'Biaya', align: 'right' as const, render: (_: unknown, o: Order) => (o.status === 'SELESAI' ? fmtMoney(Number(o.labor_cost) + Number(o.material_cost)) : '-') },
          { render: (_: unknown, o: Order) => can('POST', '/utility/work-orders/:id/status') ? <Space>{NEXT[o.status].map((n) => <Button key={n} size="small" danger={n === 'BATAL'} type={n === 'SELESAI' ? 'primary' : 'default'} onClick={() => { f.resetFields(); setAct({ o, to: n }); }}>{n === 'DIKERJAKAN' ? 'Mulai' : n === 'SELESAI' ? 'Selesaikan' : 'Batalkan'}</Button>)}</Space> : null },
        ]} />
      <Modal open={!!act} title={act ? `${act.o.number} — ${WORK_ORDER_STATUS_LABELS[act.to]}` : ''} okText="Simpan" cancelText="Batal" confirmLoading={set.isPending} destroyOnHidden onCancel={() => setAct(null)} onOk={() => f.validateFields().then((v) => set.mutate(v))}>
        {act?.to === 'SELESAI' ? (
          <Form form={f} layout="vertical" initialValues={{ laborCost: 0, materialCost: 0 }}>
            <Form.Item name="result" label="Hasil pekerjaan" rules={[{ required: true, min: 3 }]}><Input.TextArea rows={3} /></Form.Item>
            <Space align="start"><Form.Item name="laborCost" label="Biaya upah"><InputNumber min={0} style={{ width: 180 }} /></Form.Item><Form.Item name="materialCost" label="Biaya bahan"><InputNumber min={0} style={{ width: 180 }} /></Form.Item></Space>
            {act.o.asset_id && <Form.Item name="assetCondition" label="Kondisi aset sesudahnya"><Select allowClear options={opt(ASSET_CONDITIONS, ASSET_CONDITION_LABELS)} /></Form.Item>}
          </Form>
        ) : <Form form={f} layout="vertical"><Form.Item name="result" label={act?.to === 'BATAL' ? 'Alasan pembatalan' : 'Catatan'} rules={act?.to === 'BATAL' ? [{ required: true }] : []}><Input.TextArea rows={2} /></Form.Item></Form>}
      </Modal>
    </>
  );
}
