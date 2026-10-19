import { useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tabs, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { ApiError, get, post, put } from '@/api/client';
import { useAction, useCustomers } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import PageHeader from '@/layout/PageHeader';
import { fmtDate } from '@/lib/format';

const KEY = ['scheduling'];
type Kind = 'PERSON' | 'ROOM' | 'EQUIPMENT';
const KIND: Record<Kind, string> = { PERSON: 'Orang', ROOM: 'Ruang', EQUIPMENT: 'Peralatan' };
interface Res { id: string; name: string; kind: Kind; employeeId: string | null; employeeName: string | null; note: string | null; isActive: boolean }
interface Booking { id: string; resourceId: string; resourceName: string; kind: Kind; title: string; startsAt: string; endsAt: string; status: 'BOOKED' | 'DONE' | 'CANCELLED'; note: string | null; cancelReason: string | null; customerName: string | null; projectName: string | null }
interface Project { id: string; code: string; name: string; status: string }
interface Emp { id: string; code: string; name: string }
interface Controls { overloadedPeople: { resource: string; day: string; hours: string }[]; notCompleted: { id: string; title: string; resource: string; endsAt: string }[]; overloadHours: number }
interface Slot { date: string; startsAt: string; endsAt: string }
interface Conflict { id: string; title: string; startsAt: string; endsAt: string }
const hm = (s: string) => dayjs(s).format('HH:mm');
/** Senin pada minggu tanggal ini (tidak bergantung locale) */
const monday = (d: dayjs.Dayjs) => d.subtract((d.day() + 6) % 7, 'day').startOf('day');

export default function SchedulePage() {
  const can = useCan();
  const controls = useQuery({ queryKey: [...KEY, 'controls'], queryFn: () => get<Controls>('/scheduling/controls'), retry: false });
  const warn = controls.data ? controls.data.overloadedPeople.length + controls.data.notCompleted.length : 0;
  return (
    <>
      <PageHeader title="Jadwal sumber daya" />
      {warn > 0 && controls.data && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Perlu ditindaklanjuti" description={
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {controls.data.overloadedPeople.map((o) => <li key={`${o.resource}${o.day}`}>{o.resource} dijadwalkan {Number(o.hours)} jam pada {fmtDate(o.day)} (batas {controls.data!.overloadHours} jam)</li>)}
            {controls.data.notCompleted.length > 0 && <li>{controls.data.notCompleted.length} pemesanan sudah lewat lebih dari sehari tetapi belum ditandai selesai/dibatalkan</li>}
          </ul>} />
      )}
      <Tabs destroyOnHidden items={[
        { key: 'jadwal', label: 'Jadwal', children: <Grid /> },
        { key: 'slot', label: 'Cari slot kosong', children: <Slots /> },
        { key: 'sumber', label: 'Sumber daya', children: <Resources canEdit={can('POST', '/scheduling/resources')} /> },
      ]} />
    </>
  );
}

function useResources() {
  return useQuery({ queryKey: [...KEY, 'resources'], queryFn: () => get<Res[]>('/scheduling/resources') });
}

/** Form pemesanan dengan penanganan bentrok (409): menampilkan pemesanan yang bertabrakan */
function BookModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: { resourceId?: string; start?: dayjs.Dayjs; end?: dayjs.Dayjs } }) {
  const { message } = App.useApp();
  const resources = useResources();
  const customers = useCustomers();
  const projects = useQuery({ queryKey: [...KEY, 'projects'], queryFn: () => get<Project[]>('/services/projects'), staleTime: 60_000 });
  const [f] = Form.useForm<{ resourceId: string; range: [dayjs.Dayjs, dayjs.Dayjs]; title: string; customerId?: string; projectId?: string; note?: string }>();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const save = useAction(async (v: { resourceId: string; range: [dayjs.Dayjs, dayjs.Dayjs]; title: string; customerId?: string; projectId?: string; note?: string }) => {
    setConflicts([]);
    try {
      return await post('/scheduling/bookings', { resourceId: v.resourceId, title: v.title, startsAt: v.range[0].toISOString(), endsAt: v.range[1].toISOString(), customerId: v.customerId, projectId: v.projectId, note: v.note });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const d = e.data as { conflicts?: Conflict[] } | undefined;
        setConflicts(d?.conflicts ?? []);
        message.error(e.message);
        return undefined;
      }
      throw e;
    }
  }, { invalidate: KEY, onSuccess: (r) => { if (r) { message.success('Jadwal dipesan'); onClose(); } } });
  return (
    <Modal title="Pesan jadwal" open={open} onCancel={onClose} onOk={() => f.submit()} confirmLoading={save.isPending} okText="Pesan" destroyOnHidden afterOpenChange={(o) => { if (o) f.setFieldsValue({ resourceId: initial?.resourceId, range: initial?.start && initial?.end ? [initial.start, initial.end] : undefined, title: '', customerId: undefined, projectId: undefined, note: undefined }); }}>
      {conflicts.length > 0 && <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Bentrok dengan pemesanan lain" description={conflicts.map((c) => `${c.title}: ${dayjs(c.startsAt).format('D MMM HH:mm')}–${hm(c.endsAt)}`).join('; ')} />}
      <Form form={f} layout="vertical" onFinish={(v) => save.mutate(v)}>
        <Form.Item name="resourceId" label="Sumber daya" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(resources.data ?? []).filter((r) => r.isActive).map((r) => ({ value: r.id, label: `${r.name} (${KIND[r.kind]})` }))} /></Form.Item>
        <Form.Item name="range" label="Waktu" rules={[{ required: true }]}><DatePicker.RangePicker showTime={{ format: 'HH:mm', minuteStep: 15 }} format="D MMM YYYY HH:mm" style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="title" label="Keperluan" rules={[{ required: true, min: 3 }]}><Input maxLength={160} /></Form.Item>
        <Form.Item name="projectId" label="Proyek (opsional)"><Select allowClear showSearch optionFilterProp="label" options={(projects.data ?? []).filter((p) => p.status === 'ACTIVE').map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} /></Form.Item>
        <Form.Item name="customerId" label="Klien (opsional)"><Select allowClear showSearch optionFilterProp="label" options={(customers.data ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Form.Item>
        <Form.Item name="note" label="Catatan"><Input maxLength={255} /></Form.Item>
      </Form>
    </Modal>
  );
}

function Grid() {
  const can = useCan();
  const [weekStart, setWeekStart] = useState(monday(dayjs()));
  const from = weekStart.format('YYYY-MM-DD');
  const to = weekStart.add(6, 'day').format('YYYY-MM-DD');
  const resources = useResources();
  const bookings = useQuery({ queryKey: [...KEY, 'bookings', from], queryFn: () => get<Booking[]>(`/scheduling/bookings?from=${from}&to=${to}`) });
  const [booking, setBooking] = useState(false);
  const [sel, setSel] = useState<Booking | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cf] = Form.useForm<{ reason: string }>();
  const [moving, setMoving] = useState(false);
  const [mf] = Form.useForm<{ range: [dayjs.Dayjs, dayjs.Dayjs] }>();
  const done = useAction((id: string) => post(`/scheduling/bookings/${id}/done`), { invalidate: KEY, success: 'Ditandai selesai', onSuccess: () => setSel(null) });
  const toEntry = useAction((id: string) => post(`/scheduling/bookings/${id}/time-entry`), { invalidate: [...KEY, 'timesheets'], success: 'Draf catatan waktu dibuat (lihat Lembar waktu)', onSuccess: () => setSel(null) });
  const cancel = useAction((v: { reason: string }) => post(`/scheduling/bookings/${sel!.id}/cancel`, v), { invalidate: KEY, success: 'Pemesanan dibatalkan', onSuccess: () => { setCancelling(false); setSel(null); } });
  const move = useAction((v: { range: [dayjs.Dayjs, dayjs.Dayjs] }) => put(`/scheduling/bookings/${sel!.id}`, { startsAt: v.range[0].toISOString(), endsAt: v.range[1].toISOString() }), { invalidate: KEY, success: 'Jadwal dipindah', onSuccess: () => { setMoving(false); setSel(null); } });
  const days = [...Array(7)].map((_, i) => weekStart.add(i, 'day'));
  const active = (bookings.data ?? []).filter((b) => b.status !== 'CANCELLED');
  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <DatePicker picker="week" allowClear={false} value={weekStart} onChange={(d) => d && setWeekStart(monday(d))} />
        <Button onClick={() => setWeekStart((w) => w.subtract(7, 'day'))}>‹ Minggu lalu</Button>
        <Button onClick={() => setWeekStart((w) => w.add(7, 'day'))}>Minggu depan ›</Button>
        {can('POST', '/scheduling/bookings') && <Button type="primary" onClick={() => setBooking(true)}>Pesan jadwal</Button>}
      </Space>
      <div style={{ overflowX: 'auto' }}>
        <Table size="small" pagination={false} bordered rowKey="id" loading={resources.isLoading || bookings.isLoading} dataSource={(resources.data ?? []).filter((r) => r.isActive)} locale={{ emptyText: 'Belum ada sumber daya; tambahkan di tab Sumber daya' }} scroll={{ x: 900 }}
          columns={[
            { title: 'Sumber daya', width: 170, fixed: 'left' as const, render: (_: unknown, r: Res) => <div>{r.name}<div style={{ fontSize: 12, color: '#64748b' }}>{KIND[r.kind]}</div></div> },
            ...days.map((d) => ({
              title: <div>{d.format('ddd D/M')}</div>,
              width: 130,
              render: (_: unknown, r: Res) => active.filter((b) => b.resourceId === r.id && dayjs(b.startsAt).isSame(d, 'day')).map((b) => (
                <div key={b.id} onClick={() => setSel(b)} style={{ cursor: 'pointer', background: b.status === 'DONE' ? '#f0f5ff' : '#e6fffb', borderLeft: `3px solid ${b.status === 'DONE' ? '#597ef7' : '#13c2c2'}`, padding: '2px 6px', marginBottom: 4, fontSize: 12 }}>
                  <b>{hm(b.startsAt)}–{hm(b.endsAt)}</b><div>{b.title}</div>
                </div>
              )),
            })),
          ]} />
      </div>
      <BookModal open={booking} onClose={() => setBooking(false)} />
      <Modal title={sel?.title} open={!!sel && !cancelling && !moving} onCancel={() => setSel(null)} footer={null} destroyOnHidden>
        {sel && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <div>{sel.resourceName} · {dayjs(sel.startsAt).format('D MMM YYYY HH:mm')}–{hm(sel.endsAt)} <Tag color={sel.status === 'DONE' ? 'blue' : 'green'}>{sel.status === 'DONE' ? 'Selesai' : 'Dipesan'}</Tag></div>
            {(sel.customerName || sel.projectName) && <Typography.Text type="secondary">{sel.customerName}{sel.projectName ? ` · ${sel.projectName}` : ''}</Typography.Text>}
            {sel.note && <Typography.Text>{sel.note}</Typography.Text>}
            <Space wrap>
              {sel.status === 'BOOKED' && can('POST', '/scheduling/bookings/:id/done') && <Button onClick={() => done.mutate(sel.id)} loading={done.isPending}>Tandai selesai</Button>}
              {sel.kind === 'PERSON' && can('POST', '/scheduling/bookings/:id/time-entry') && <Button onClick={() => toEntry.mutate(sel.id)} loading={toEntry.isPending}>Jadikan catatan waktu</Button>}
              {sel.status === 'BOOKED' && can('PUT', '/scheduling/bookings/:id') && <Button onClick={() => { mf.setFieldsValue({ range: [dayjs(sel.startsAt), dayjs(sel.endsAt)] }); setMoving(true); }}>Pindah</Button>}
              {sel.status === 'BOOKED' && can('POST', '/scheduling/bookings/:id/cancel') && <Button danger onClick={() => { cf.resetFields(); setCancelling(true); }}>Batalkan</Button>}
            </Space>
          </Space>
        )}
      </Modal>
      <Modal title="Batalkan pemesanan" open={cancelling} onCancel={() => setCancelling(false)} onOk={() => cf.submit()} confirmLoading={cancel.isPending} okText="Batalkan" okButtonProps={{ danger: true }} destroyOnHidden>
        <Form form={cf} layout="vertical" onFinish={(v) => cancel.mutate(v)}><Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5 }]}><Input maxLength={255} /></Form.Item></Form>
      </Modal>
      <Modal title="Pindahkan jadwal" open={moving} onCancel={() => setMoving(false)} onOk={() => mf.submit()} confirmLoading={move.isPending} okText="Pindah" destroyOnHidden>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Jika bentrok dengan pemesanan lain, perpindahan ditolak." />
        <Form form={mf} layout="vertical" onFinish={(v) => move.mutate(v)}><Form.Item name="range" label="Waktu baru" rules={[{ required: true }]}><DatePicker.RangePicker showTime={{ format: 'HH:mm', minuteStep: 15 }} format="D MMM YYYY HH:mm" style={{ width: '100%' }} /></Form.Item></Form>
      </Modal>
    </>
  );
}

function Slots() {
  const resources = useResources();
  const [f] = Form.useForm<{ resourceId: string; range: [dayjs.Dayjs, dayjs.Dayjs]; minutes: number }>();
  const [q, setQ] = useState<{ resourceId: string; from: string; to: string; minutes: number } | null>(null);
  const slots = useQuery({ queryKey: [...KEY, 'slots', q], enabled: !!q, queryFn: () => get<Slot[]>(`/scheduling/free-slots?resourceId=${q!.resourceId}&from=${q!.from}&to=${q!.to}&minutes=${q!.minutes}`) });
  const [pick, setPick] = useState<{ resourceId: string; start: dayjs.Dayjs; end: dayjs.Dayjs } | null>(null);
  return (
    <>
      <Typography.Paragraph type="secondary">Mencari celah kosong pada jam kerja 08.00–17.00 WIB (Senin–Sabtu).</Typography.Paragraph>
      <Form form={f} layout="inline" initialValues={{ minutes: 60 }} onFinish={(v) => setQ({ resourceId: v.resourceId, from: v.range[0].format('YYYY-MM-DD'), to: v.range[1].format('YYYY-MM-DD'), minutes: v.minutes })} style={{ marginBottom: 12, rowGap: 8 }}>
        <Form.Item name="resourceId" rules={[{ required: true }]}><Select placeholder="Sumber daya" style={{ width: 220 }} options={(resources.data ?? []).filter((r) => r.isActive).map((r) => ({ value: r.id, label: r.name }))} /></Form.Item>
        <Form.Item name="range" rules={[{ required: true }]}><DatePicker.RangePicker /></Form.Item>
        <Form.Item name="minutes" rules={[{ required: true }]}><InputNumber min={15} max={600} step={15} addonAfter="menit" style={{ width: 140 }} /></Form.Item>
        <Button htmlType="submit" type="primary">Cari</Button>
      </Form>
      <Table<Slot> size="small" rowKey="startsAt" loading={slots.isFetching} pagination={false} dataSource={q ? slots.data : []} locale={{ emptyText: q ? 'Tidak ada slot kosong' : 'Isi pencarian di atas' }}
        columns={[{ title: 'Tanggal', render: (_: unknown, s: Slot) => fmtDate(s.date) }, { title: 'Kosong', render: (_: unknown, s: Slot) => `${hm(s.startsAt)}–${hm(s.endsAt)}` }, { render: (_: unknown, s: Slot) => <Button size="small" onClick={() => setPick({ resourceId: q!.resourceId, start: dayjs(s.startsAt), end: dayjs(s.startsAt).add(q!.minutes, 'minute') })}>Pesan</Button> }]} />
      <BookModal open={!!pick} onClose={() => setPick(null)} initial={pick ?? undefined} />
    </>
  );
}

function Resources({ canEdit }: { canEdit: boolean }) {
  const resources = useResources();
  const emps = useQuery({ queryKey: [...KEY, 'emps'], queryFn: () => get<Emp[]>('/hr/employees'), retry: false, staleTime: 60_000 });
  const [f] = Form.useForm<{ name: string; kind: Kind; employeeId?: string }>();
  const kind = Form.useWatch('kind', f);
  const add = useAction((v: { name: string; kind: Kind; employeeId?: string }) => post('/scheduling/resources', v), { invalidate: KEY, success: 'Sumber daya ditambahkan', onSuccess: () => f.resetFields() });
  const toggle = useAction((r: Res) => put(`/scheduling/resources/${r.id}`, { name: r.name, kind: r.kind, employeeId: r.employeeId ?? undefined, note: r.note ?? undefined, isActive: !r.isActive }), { invalidate: KEY });
  return (
    <>
      {canEdit && (
        <Card size="small" style={{ marginBottom: 12 }}>
          <Form form={f} layout="inline" onFinish={(v) => add.mutate(v)} style={{ rowGap: 8 }} initialValues={{ kind: 'PERSON' }}>
            <Form.Item name="name" rules={[{ required: true, min: 2 }]}><Input placeholder="Nama (mis. Ruang Rapat A)" maxLength={80} style={{ width: 220 }} /></Form.Item>
            <Form.Item name="kind"><Select style={{ width: 130 }} options={Object.entries(KIND).map(([k, v]) => ({ value: k, label: v }))} /></Form.Item>
            {kind === 'PERSON' && <Form.Item name="employeeId"><Select allowClear showSearch optionFilterProp="label" placeholder="Karyawan (opsional)" style={{ width: 220 }} options={(emps.data ?? []).map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }))} /></Form.Item>}
            <Button htmlType="submit" type="primary" loading={add.isPending}>Tambah</Button>
          </Form>
        </Card>
      )}
      <Table<Res> size="small" rowKey="id" pagination={false} loading={resources.isLoading} dataSource={resources.data} locale={{ emptyText: 'Belum ada sumber daya' }}
        columns={[{ title: 'Nama', dataIndex: 'name' }, { title: 'Jenis', render: (_: unknown, r: Res) => KIND[r.kind] }, { title: 'Karyawan', render: (_: unknown, r: Res) => r.employeeName ?? '-' }, { title: 'Aktif', render: (_: unknown, r: Res) => <Switch size="small" checked={r.isActive} disabled={!canEdit} onChange={() => toggle.mutate(r)} /> }]} />
    </>
  );
}
