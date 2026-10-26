import { METER_EVENT_LABELS, METER_SIZES, METER_STATUS_LABELS, type MeterStatus } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, DatePicker, Descriptions, Drawer, Form, Input, Modal, Radio, Select, Space, Switch, Tag, Timeline } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import { fmtDate } from '@/lib/format';
import { ConnectionSelect, Stats } from './kit';

interface Meter { id: string; serial: string; brand: string | null; size: string | null; status: MeterStatus; connection_id: string | null; connection_number: string | null; customer_name: string | null; address: string | null; installed_on: string | null; last_calibrated_on: string | null; next_calibration_on: string | null; days_to_calibration: number | null; note: string | null; events?: { id: string; at: string; kind: string; connection_number: string | null; user_name: string | null; note: string | null }[] }
interface Sum { by: Record<string, number>; due: number; overdue: number }
const COLOR: Record<MeterStatus, string> = { STOK: 'default', TERPASANG: 'green', RUSAK: 'red', PENSIUN: 'default' };

/** Inventaris meter: setiap meter punya riwayat (didaftarkan, dipasang, ditera, dilepas); tera ulang tiap 5 tahun */
export function MetersTab() {
  const can = useCan();
  const [status, setStatus] = useState('');
  const [due, setDue] = useState(false);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<null | 'register' | 'replace'>(null);
  const list = useQuery({ queryKey: ['utility', 'meters', status, due, q], queryFn: () => get<Meter[]>(`/utility/meters?${new URLSearchParams({ ...(status ? { status } : {}), ...(due ? { due: 'true' } : {}), ...(q ? { q } : {}) })}`) });
  const sum = useQuery({ queryKey: ['utility', 'meters', 'summary'], queryFn: () => get<Sum>('/utility/meters/summary') });
  const sync = useAction(() => post<{ imported: number }>('/utility/meters/sync', {}), { success: (r) => `${r.imported} meter dari data sambungan didaftarkan`, invalidate: ['utility'] });
  const s = sum.data;
  const manage = can('POST', '/utility/meters');
  return (
    <>
      <Stats items={[
        { title: 'Terpasang', value: s?.by.TERPASANG ?? 0, onClick: () => { setStatus('TERPASANG'); setDue(false); } },
        { title: 'Di gudang', value: s?.by.STOK ?? 0, onClick: () => { setStatus('STOK'); setDue(false); } },
        { title: 'Tera ≤ 90 hari', value: s?.due ?? 0, warn: (s?.due ?? 0) > 0, onClick: () => { setStatus(''); setDue(true); } },
        { title: 'Lewat jadwal tera', value: s?.overdue ?? 0, warn: (s?.overdue ?? 0) > 0, hint: 'Meter tua cenderung membaca kurang' },
      ]} />
      <Space wrap style={{ marginBottom: 12 }}>
        <Radio.Group optionType="button" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'Semua' }, ...(['TERPASANG', 'STOK', 'RUSAK', 'PENSIUN'] as MeterStatus[]).map((k) => ({ value: k, label: METER_STATUS_LABELS[k] }))]} />
        <span>Jatuh tempo tera <Switch checked={due} onChange={setDue} /></span>
        <Input.Search allowClear placeholder="Cari seri, pelanggan, merek" onSearch={setQ} style={{ width: 240 }} />
        {manage && <Button type="primary" onClick={() => setMode('register')}>Daftarkan meter</Button>}
        {manage && <Button onClick={() => setMode('replace')}>Ganti meter</Button>}
        {manage && <Button loading={sync.isPending} onClick={() => sync.mutate(undefined)}>Impor dari data sambungan</Button>}
      </Space>
      <ResponsiveTable<Meter> rowKey="id" size="small" loading={list.isLoading} dataSource={list.data} onRow={(m) => ({ onClick: () => setOpenId(m.id), style: { cursor: 'pointer' } })} onMobileClick={(m) => setOpenId(m.id)}
        columns={[
          { title: 'No. seri', dataIndex: 'serial' }, { title: 'Merek / ukuran', render: (_: unknown, m: Meter) => [m.brand, m.size].filter(Boolean).join(' · ') || '-' },
          { title: 'Status', render: (_: unknown, m: Meter) => <Tag color={COLOR[m.status]}>{METER_STATUS_LABELS[m.status]}</Tag> },
          { title: 'Dipasang di', render: (_: unknown, m: Meter) => (m.connection_number ? <>{m.connection_number}<div style={{ fontSize: 12, color: '#64748b' }}>{m.customer_name}</div></> : '-') },
          { title: 'Tera berikutnya', render: (_: unknown, m: Meter) => (m.status !== 'TERPASANG' ? '-' : <span style={m.days_to_calibration != null && m.days_to_calibration < 0 ? { color: '#dc2626', fontWeight: 600 } : undefined}>{fmtDate(m.next_calibration_on)}{m.days_to_calibration != null && m.days_to_calibration < 0 && ' · lewat'}</span>) },
        ]} />
      <RegisterMeter open={mode === 'register'} onClose={() => setMode(null)} />
      <ReplaceMeter open={mode === 'replace'} onClose={() => setMode(null)} />
      <MeterDrawer id={openId} onClose={() => setOpenId(null)} manage={manage} />
    </>
  );
}

function RegisterMeter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f] = Form.useForm();
  const save = useAction((v: Record<string, unknown>) => post('/utility/meters', { ...v, lastCalibratedOn: v.lastCalibratedOn ? dayjs(v.lastCalibratedOn as string).format('YYYY-MM-DD') : undefined }), { success: 'Meter didaftarkan', invalidate: ['utility'], onSuccess: () => { f.resetFields(); onClose(); } });
  return (
    <Modal open={open} title="Daftarkan meter baru (stok gudang)" okText="Simpan" cancelText="Batal" confirmLoading={save.isPending} destroyOnHidden onCancel={onClose} onOk={() => f.validateFields().then((v) => save.mutate(v))}>
      <Form form={f} layout="vertical">
        <Form.Item name="serial" label="Nomor seri" rules={[{ required: true }]}><Input /></Form.Item>
        <Space align="start"><Form.Item name="brand" label="Merek"><Input /></Form.Item><Form.Item name="size" label="Ukuran"><Select allowClear style={{ width: 120 }} options={METER_SIZES.map((x) => ({ value: x, label: x }))} /></Form.Item></Space>
        <Form.Item name="lastCalibratedOn" label="Tanggal tera terakhir" extra="Tera berikutnya otomatis 5 tahun setelahnya"><DatePicker /></Form.Item>
      </Form>
    </Modal>
  );
}

function ReplaceMeter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f] = Form.useForm();
  const stock = useQuery({ queryKey: ['utility', 'meters', 'STOK'], queryFn: () => get<Meter[]>('/utility/meters?status=STOK'), enabled: open });
  const save = useAction((v: Record<string, unknown>) => post('/utility/meters/replace', v), { success: 'Meter diganti — catat angka akhir meter lama di menu Catat meter dengan tanda ganti meter', invalidate: ['utility'], onSuccess: () => { f.resetFields(); onClose(); } });
  return (
    <Modal open={open} title="Ganti meter pada sambungan" okText="Ganti" cancelText="Batal" confirmLoading={save.isPending} destroyOnHidden onCancel={onClose} onOk={() => f.validateFields().then((v) => save.mutate(v))}>
      <Form form={f} layout="vertical" initialValues={{ oldStatus: 'RUSAK' }}>
        <Form.Item name="connectionId" label="Sambungan" rules={[{ required: true }]}><ConnectionSelect filter={(c) => c.metered && c.status !== 'DISCONNECTED'} /></Form.Item>
        <Form.Item name="newMeterId" label="Meter pengganti (dari gudang)" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(stock.data ?? []).map((m) => ({ value: m.id, label: `${m.serial}${m.brand ? ` — ${m.brand}` : ''}` }))} /></Form.Item>
        <Form.Item name="oldStatus" label="Meter lama menjadi"><Select options={[{ value: 'RUSAK', label: 'Rusak' }, { value: 'STOK', label: 'Kembali ke gudang' }, { value: 'PENSIUN', label: 'Pensiun' }]} /></Form.Item>
        <Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 3 }]}><Input /></Form.Item>
      </Form>
    </Modal>
  );
}

function MeterDrawer({ id, onClose, manage }: { id: string | null; onClose: () => void; manage: boolean }) {
  const q = useQuery({ queryKey: ['utility', 'meters', 'one', id], queryFn: () => get<Meter>(`/utility/meters/${id}`), enabled: !!id });
  const m = q.data;
  const [mode, setMode] = useState<null | 'cal' | 'status'>(null);
  const [f] = Form.useForm();
  const done = () => { f.resetFields(); setMode(null); };
  const cal = useAction((v: { date?: string; note?: string }) => post(`/utility/meters/${id}/calibrate`, { ...v, date: v.date ? dayjs(v.date).format('YYYY-MM-DD') : undefined }), { success: 'Tera ulang dicatat', invalidate: ['utility'], onSuccess: done });
  const st = useAction((v: { status: string; note: string }) => post(`/utility/meters/${id}/status`, v), { success: 'Status meter diubah', invalidate: ['utility'], onSuccess: done });
  return (
    <Drawer open={!!id} onClose={onClose} width={480} title={m ? `Meter ${m.serial}` : 'Meter'} loading={q.isLoading}>
      {m && (
        <>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="Status"><Tag color={COLOR[m.status]}>{METER_STATUS_LABELS[m.status]}</Tag></Descriptions.Item>
            <Descriptions.Item label="Merek / ukuran">{[m.brand, m.size].filter(Boolean).join(' · ') || '-'}</Descriptions.Item>
            <Descriptions.Item label="Terpasang di">{m.connection_number ? `${m.connection_number} — ${m.customer_name} — ${m.address}` : '-'}</Descriptions.Item>
            <Descriptions.Item label="Tera terakhir">{fmtDate(m.last_calibrated_on)}</Descriptions.Item>
            <Descriptions.Item label="Tera berikutnya">{fmtDate(m.next_calibration_on)}</Descriptions.Item>
          </Descriptions>
          {manage && m.status !== 'PENSIUN' && <Space style={{ margin: '12px 0' }}><Button type="primary" onClick={() => { f.setFieldsValue({ date: dayjs() }); setMode('cal'); }}>Catat tera ulang</Button>{m.status !== 'TERPASANG' && <Button onClick={() => setMode('status')}>Ubah status</Button>}</Space>}
          <Timeline items={(m.events ?? []).map((e) => ({ children: <><b>{dayjs(e.at).format('DD MMM YYYY')}</b> · {METER_EVENT_LABELS[e.kind] ?? e.kind}{e.connection_number && ` (${e.connection_number})`}<div style={{ fontSize: 12, color: '#64748b' }}>{e.user_name}{e.note ? ` — ${e.note}` : ''}</div></> }))} />
        </>
      )}
      <Modal open={mode === 'cal'} title="Catat tera ulang" okText="Simpan" cancelText="Batal" confirmLoading={cal.isPending} destroyOnHidden onCancel={done} onOk={() => f.validateFields().then((v) => cal.mutate(v))}>
        <Form form={f} layout="vertical"><Form.Item name="date" label="Tanggal tera"><DatePicker disabledDate={(d) => d.isAfter(dayjs())} /></Form.Item><Form.Item name="note" label="Catatan"><Input /></Form.Item></Form>
      </Modal>
      <Modal open={mode === 'status'} title="Ubah status meter" okText="Simpan" cancelText="Batal" confirmLoading={st.isPending} destroyOnHidden onCancel={done} onOk={() => f.validateFields().then((v) => st.mutate(v))}>
        <Form form={f} layout="vertical"><Form.Item name="status" label="Menjadi" rules={[{ required: true }]}><Select options={[{ value: 'STOK', label: 'Di gudang' }, { value: 'RUSAK', label: 'Rusak' }, { value: 'PENSIUN', label: 'Pensiun' }]} /></Form.Item><Form.Item name="note" label="Alasan" rules={[{ required: true }]}><Input /></Form.Item></Form>
      </Modal>
      {!m && !q.isLoading && <Alert type="warning" message="Meter tidak ditemukan" />}
    </Drawer>
  );
}
