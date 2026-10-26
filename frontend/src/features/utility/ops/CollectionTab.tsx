import { VISIT_OUTCOMES, VISIT_OUTCOME_LABELS, type VisitOutcome } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import { fmtDate, fmtMoney } from '@/lib/format';
import { Stats, opt } from './kit';

interface Row { connection_id: string; number: string; address: string; customer: string; phone: string | null; route_name: string | null; outstanding: string; bills: number; oldest_due: string; days_late: number; last_outcome: VisitOutcome | null; last_visit_at: string | null; promised_on: string | null; promised_amount: string | null; promise: 'MENUNGGU' | 'INGKAR' | null; whatsapp: string | null }
interface Visit { id: string; visited_at: string; outcome: VisitOutcome; promised_on: string | null; promised_amount: string | null; note: string | null; collector: string | null }
const lateColor = (d: number) => (d > 35 ? 'red' : d > 21 ? 'volcano' : d > 7 ? 'orange' : 'gold');

/** Penagihan lapangan: daftar kunjungan kolektor per rute, hasil kunjungan, dan janji bayar yang dipantau sampai lunas */
export function CollectionTab() {
  const can = useCan();
  const [routeId, setRouteId] = useState<string>();
  const [q, setQ] = useState('');
  const [visiting, setVisiting] = useState<Row | null>(null);
  const routes = useQuery({ queryKey: ['utility', 'routes'], queryFn: () => get<{ routes: { id: string; code: string; name: string }[] }>('/utility/routes') });
  const list = useQuery({ queryKey: ['utility', 'collection', routeId, q], queryFn: () => get<Row[]>(`/utility/collection/worklist?${new URLSearchParams({ ...(routeId ? { routeId } : {}), ...(q ? { q } : {}) })}`) });
  const sum = useQuery({ queryKey: ['utility', 'collection', 'summary'], queryFn: () => get<{ visitsToday: number; promisesToday: number; broken: number; overdueConnections: number; overdueAmount: number }>('/utility/collection/summary') });
  const s = sum.data;
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Cara pakai" description="Daftar di bawah adalah pelanggan yang tagihannya lewat jatuh tempo (urut per rute). Kunjungi, lalu catat hasilnya. Bila pelanggan berjanji bayar, isi tanggal janji — janji yang terlewat tanpa pelunasan ditandai 'Ingkar'. Pembayaran tetap diterima di loket." />
      <Stats items={[
        { title: 'Pelanggan menunggak', value: s?.overdueConnections ?? 0, hint: s ? fmtMoney(s.overdueAmount) : undefined, warn: (s?.overdueConnections ?? 0) > 0 },
        { title: 'Dikunjungi hari ini', value: s?.visitsToday ?? 0, ok: true },
        { title: 'Janji jatuh hari ini', value: s?.promisesToday ?? 0 },
        { title: 'Janji ingkar', value: s?.broken ?? 0, warn: (s?.broken ?? 0) > 0 },
      ]} />
      <Space wrap style={{ marginBottom: 12 }}>
        <Select allowClear placeholder="Semua rute" style={{ width: 220 }} value={routeId} onChange={setRouteId} options={(routes.data?.routes ?? []).map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` }))} />
        <Input.Search allowClear placeholder="Cari nomor, nama, alamat" onSearch={setQ} style={{ width: 240 }} />
      </Space>
      <ResponsiveTable<Row> rowKey="connection_id" size="small" loading={list.isLoading} dataSource={list.data} pagination={{ pageSize: 25 }} locale={{ emptyText: 'Tidak ada tunggakan pada rute ini' }}
        expandable={{ expandedRowRender: (r) => <VisitHistory connectionId={r.connection_id} /> }}
        columns={[
          { title: 'Pelanggan', render: (_: unknown, r: Row) => <><b>{r.customer}</b><div style={{ fontSize: 12, color: '#64748b' }}>{r.number} · {r.address}</div>{r.route_name && <div style={{ fontSize: 12, color: '#64748b' }}>{r.route_name}</div>}</> },
          { title: 'Tunggakan', align: 'right' as const, render: (_: unknown, r: Row) => <>{fmtMoney(r.outstanding)}<div style={{ fontSize: 12, color: '#64748b' }}>{r.bills} tagihan</div></> },
          { title: 'Telat', render: (_: unknown, r: Row) => <Tag color={lateColor(r.days_late)}>{r.days_late} hari</Tag> },
          { title: 'Kunjungan terakhir', render: (_: unknown, r: Row) => (r.last_outcome ? <>{VISIT_OUTCOME_LABELS[r.last_outcome]}<div style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(r.last_visit_at)}</div></> : <span style={{ color: '#94a3b8' }}>belum pernah</span>) },
          { title: 'Janji bayar', render: (_: unknown, r: Row) => (r.promise ? <Tag color={r.promise === 'INGKAR' ? 'red' : 'blue'}>{r.promise === 'INGKAR' ? 'Ingkar' : 'Menunggu'} · {fmtDate(r.promised_on)}</Tag> : '-') },
          { render: (_: unknown, r: Row) => <Space wrap>{can('POST', '/utility/collection/visits') && <Button size="small" type="primary" onClick={() => setVisiting(r)}>Catat kunjungan</Button>}{r.whatsapp && <Button size="small" href={r.whatsapp} target="_blank" rel="noreferrer">WhatsApp</Button>}{r.phone && <Button size="small" href={`tel:${r.phone}`}>Telepon</Button>}</Space> },
        ]} />
      <VisitModal row={visiting} onClose={() => setVisiting(null)} />
    </>
  );
}

function VisitHistory({ connectionId }: { connectionId: string }) {
  const q = useQuery({ queryKey: ['utility', 'collection', 'visits', connectionId], queryFn: () => get<Visit[]>(`/utility/collection/visits?connectionId=${connectionId}`) });
  return <Table size="small" rowKey="id" loading={q.isLoading} pagination={false} dataSource={q.data} locale={{ emptyText: 'Belum ada kunjungan' }} columns={[
    { title: 'Waktu', render: (_: unknown, v: Visit) => dayjs(v.visited_at).format('DD MMM HH:mm') }, { title: 'Hasil', render: (_: unknown, v: Visit) => VISIT_OUTCOME_LABELS[v.outcome] },
    { title: 'Janji', render: (_: unknown, v: Visit) => (v.promised_on ? `${fmtDate(v.promised_on)}${v.promised_amount ? ` · ${fmtMoney(v.promised_amount)}` : ''}` : '-') }, { title: 'Catatan', dataIndex: 'note' }, { title: 'Kolektor', dataIndex: 'collector' },
  ]} />;
}

function VisitModal({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const [f] = Form.useForm();
  const outcome = Form.useWatch('outcome', f) as VisitOutcome | undefined;
  const save = useAction((v: Record<string, unknown>) => new Promise<unknown>((resolve, reject) => {
    const send = (pos?: GeolocationPosition) => post('/utility/collection/visits', { ...v, connectionId: row!.connection_id, promisedOn: v.promisedOn ? dayjs(v.promisedOn as string).format('YYYY-MM-DD') : undefined, lat: pos?.coords.latitude, lng: pos?.coords.longitude }).then(resolve, reject);
    // lokasi dicatat bila diizinkan; bila ditolak/lambat tetap disimpan tanpa lokasi
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition(send, () => send(), { timeout: 4000 }); else send();
  }), { success: 'Kunjungan dicatat', invalidate: ['utility'], onSuccess: () => { f.resetFields(); onClose(); } });
  return (
    <Modal open={!!row} title={row ? `Kunjungan — ${row.customer}` : ''} okText="Simpan" cancelText="Batal" confirmLoading={save.isPending} destroyOnHidden onCancel={onClose} onOk={() => f.validateFields().then((v) => save.mutate(v))}>
      {row && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`Tunggakan ${fmtMoney(row.outstanding)} · telat ${row.days_late} hari`} />}
      <Form form={f} layout="vertical">
        <Form.Item name="outcome" label="Hasil kunjungan" rules={[{ required: true }]}><Select options={opt(VISIT_OUTCOMES, VISIT_OUTCOME_LABELS)} /></Form.Item>
        {outcome === 'JANJI_BAYAR' && <Space align="start"><Form.Item name="promisedOn" label="Janji bayar tanggal" rules={[{ required: true }]}><DatePicker disabledDate={(d) => d.isBefore(dayjs(), 'day') || d.isAfter(dayjs().add(30, 'day'))} /></Form.Item><Form.Item name="promisedAmount" label="Jumlah (opsional)"><InputNumber min={1} style={{ width: 180 }} /></Form.Item></Space>}
        <Form.Item name="note" label="Catatan" rules={outcome === 'LAINNYA' ? [{ required: true }] : []}><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}
