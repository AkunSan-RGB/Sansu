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
interface Res { id: string; name: string; kind: Kind; employeeId: string | null; employeeName: string | null; note: string | null; isActive: boolean; workStart: number; workEnd: number; workDays: string }
const DAYS = [{ value: 1, label: 'Sen' }, { value: 2, label: 'Sel' }, { value: 3, label: 'Rab' }, { value: 4, label: 'Kam' }, { value: 5, label: 'Jum' }, { value: 6, label: 'Sab' }, { value: 7, label: 'Min' }];
interface Booking { id: string; resourceId: string; resourceName: string; kind: Kind; title: string; startsAt: string; endsAt: string; status: 'BOOKED' | 'DONE' | 'CANCELLED'; note: string | null; cancelReason: string | null; customerName: string | null; projectName: string | null; seriesId: string | null; offHours: boolean }
interface Project { id: string; code: string; name: string; status: string }
interface Emp { id: string; code: string; name: string }
interface Controls { overloadedPeople: { resource: string; day: string; hours: string }[]; notCompleted: { id: string; title: string; resource: string; endsAt: string }[]; offHours: { id: string; title: string; resource: string; startsAt: string }[]; overloadHours: number }
interface Slot { date: string; startsAt: string; endsAt: string }
interface Conflict { id: string; title: string; startsAt: string; endsAt: string }
interface Leave { startDate: string; endDate: string; type: string }
interface Occurrence { index: number; startsAt: string; conflicts?: { title: string }[]; leaves?: Leave[] }
const hm = (s: string) => dayjs(s).format('HH:mm');
/** Senin pada minggu tanggal ini (tidak bergantung locale) */
const monday = (d: dayjs.Dayjs) => d.subtract((d.day() + 6) % 7, 'day').startOf('day');

export default function SchedulePage() {
  const can = useCan();
  const controls = useQuery({ queryKey: [...KEY, 'controls'], queryFn: () => get<Controls>('/scheduling/controls'), retry: false });
  const warn = controls.data ? controls.data.overloadedPeople.length + controls.data.notCompleted.length + (controls.data.offHours?.length ?? 0) : 0;
  return (
    <>
      <PageHeader title="Jadwal sumber daya" />
      {warn > 0 && controls.data && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Perlu ditindaklanjuti" description={
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {controls.data.overloadedPeople.map((o) => <li key={`${o.resource}${o.day}`}>{o.resource} dijadwalkan {Number(o.hours)} jam pada {fmtDate(o.day)} (batas {controls.data!.overloadHours} jam)</li>)}
            {(controls.data.offHours?.length ?? 0) > 0 && <li>{controls.data.offHours.length} pemesanan di luar jam/hari kerja sumber dayanya (periksa apakah disengaja)</li>}
            {controls.data.notCompleted.length > 0 && <li>{controls.data.notCompleted.length} pemesanan sudah lewat lebih dari sehari tetapi belum ditandai selesai/dibatalkan</li>}
          </ul>} />
      )}
      <Tabs destroyOnHidden items={[
        { key: 'jadwal', label: 'Jadwal', children: <Grid /> },
        { key: 'slot', label: 'Cari slot kosong', children: <Slots /> },
        { key: 'sumber', label: 'Sumber daya', children: <Resources canEdit={can('POST', '/scheduling/resources')} /> },
        ...(can('POST', '/scheduling/feeds') ? [{ key: 'kalender', label: 'Kalender (iCal)', children: <Feeds /> }] : []),
      ]} />
    </>
  );
}

interface Feed { id: string; name: string; tokenPrefix: string; resourceName: string | null; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }

/** Tautan langganan kalender (Google Calendar/Outlook/Apple): satu arah, hanya waktu dan judul; token tampil sekali dan bisa dicabut */
function Feeds() {
  const { message } = App.useApp();
  const feeds = useQuery({ queryKey: [...KEY, 'feeds'], queryFn: () => get<Feed[]>('/scheduling/feeds') });
  const resources = useResources();
  const [form] = Form.useForm<{ name: string; resourceId?: string }>();
  const [link, setLink] = useState<string | null>(null);
  const create = useAction((v: { name: string; resourceId?: string }) => post<{ path: string }>('/scheduling/feeds', v), { invalidate: [...KEY, 'feeds'], onSuccess: (r) => { form.resetFields(); setLink(`${window.location.origin}${(r as { path: string }).path}`); } });
  const revoke = useAction((id: string) => post(`/scheduling/feeds/${id}/revoke`), { invalidate: [...KEY, 'feeds'], success: 'Tautan dicabut' });
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Alert type="info" showIcon message="Tempel tautan di Google Calendar (Tambah kalender → Dari URL), Outlook, atau Apple Calendar. Searah: perubahan di kalender tidak masuk ke SANSU, dan aplikasi kalender memperbarui tiap beberapa jam. Isinya hanya judul dan waktu pemesanan aktif, tanpa nama pelanggan. Siapa pun yang memegang tautan bisa melihatnya, jadi cabut bila bocor." />
      <Form form={form} layout="inline" onFinish={(v) => create.mutate(v)}>
        <Form.Item name="name" rules={[{ required: true, min: 2, message: 'Beri nama' }]}><Input placeholder="Nama tautan, mis. Kalender tim" maxLength={80} style={{ width: 240 }} /></Form.Item>
        <Form.Item name="resourceId"><Select allowClear placeholder="Semua sumber daya" style={{ width: 220 }} options={(resources.data ?? []).filter((r) => r.isActive).map((r) => ({ value: r.id, label: r.name }))} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={create.isPending}>Buat tautan</Button>
      </Form>
      <Table size="small" rowKey="id" pagination={false} loading={feeds.isLoading} dataSource={feeds.data} locale={{ emptyText: 'Belum ada tautan' }}
        columns={[
          { title: 'Nama', dataIndex: 'name' },
          { title: 'Sumber daya', dataIndex: 'resourceName', render: (v: string | null) => v ?? 'Semua' },
          { title: 'Token', dataIndex: 'tokenPrefix', render: (v: string) => `${v}…` },
          { title: 'Dibuka terakhir', dataIndex: 'lastUsedAt', render: (v: string | null) => (v ? fmtDate(v) : 'belum pernah') },
          { title: 'Status', render: (_: unknown, f: Feed) => (f.revokedAt ? <Tag>Dicabut</Tag> : <Tag color="green">Aktif</Tag>) },
          { render: (_: unknown, f: Feed) => !f.revokedAt && <Button size="small" danger onClick={() => revoke.mutate(f.id)}>Cabut</Button> },
        ]} />
      <Modal open={!!link} title="Tautan kalender" onCancel={() => setLink(null)} footer={<Button type="primary" onClick={() => { void navigator.clipboard?.writeText(link ?? '').then(() => message.success('Tautan disalin'), () => undefined); }}>Salin tautan</Button>} destroyOnHidden>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Simpan sekarang: tautan ini tidak akan ditampilkan lagi." />
        <Typography.Paragraph copyable code style={{ wordBreak: 'break-all' }}>{link}</Typography.Paragraph>
      </Modal>
    </Space>
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
  const [f] = Form.useForm<{ resourceId: string; range: [dayjs.Dayjs, dayjs.Dayjs]; title: string; customerId?: string; projectId?: string; note?: string; repeat?: 'DAILY' | 'WEEKLY'; count?: number }>();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const save = useAction(async (v: { resourceId: string; range: [dayjs.Dayjs, dayjs.Dayjs]; title: string; customerId?: string; projectId?: string; note?: string; repeat?: 'DAILY' | 'WEEKLY'; count?: number }) => {
    setConflicts([]);
    setProblems([]);
    try {
      const body = { resourceId: v.resourceId, title: v.title, startsAt: v.range[0].toISOString(), endsAt: v.range[1].toISOString(), customerId: v.customerId, projectId: v.projectId, note: v.note };
      return v.repeat ? await post('/scheduling/bookings/recurring', { ...body, repeat: v.repeat, count: v.count ?? 4 }) : await post('/scheduling/bookings', body);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const d = e.data as { conflicts?: Conflict[]; leaves?: Leave[]; occurrences?: Occurrence[] } | undefined;
        setConflicts(d?.conflicts ?? []);
        setProblems([
          ...(d?.leaves ?? []).map((l) => `Cuti ${fmtDate(l.startDate)}–${fmtDate(l.endDate)}`),
          ...(d?.occurrences ?? []).map((o) => `Kejadian ke-${o.index} (${dayjs(o.startsAt).format('D MMM')}): ${[...(o.conflicts ?? []).map((c) => `bentrok dengan ${c.title}`), ...(o.leaves ?? []).map(() => 'jatuh pada cuti')].join(', ')}`),
        ]);
        message.error(e.message);
        return undefined;
      }
      throw e;
    }
  }, { invalidate: KEY, onSuccess: (r) => { if (r) { message.success('Jadwal dipesan'); onClose(); } } });
  return (
    <Modal title="Pesan jadwal" open={open} onCancel={onClose} onOk={() => f.submit()} confirmLoading={save.isPending} okText="Pesan" destroyOnHidden afterOpenChange={(o) => { if (o) f.setFieldsValue({ resourceId: initial?.resourceId, range: initial?.start && initial?.end ? [initial.start, initial.end] : undefined, title: '', customerId: undefined, projectId: undefined, note: undefined }); }}>
      {problems.length > 0 && <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Tidak dapat dipesan" description={problems.join('; ')} />}
      {conflicts.length > 0 && <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Bentrok dengan pemesanan lain" description={conflicts.map((c) => `${c.title}: ${dayjs(c.startsAt).format('D MMM HH:mm')}–${hm(c.endsAt)}`).join('; ')} />}
      <Form form={f} layout="vertical" onFinish={(v) => save.mutate(v)}>
        <Form.Item name="resourceId" label="Sumber daya" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(resources.data ?? []).filter((r) => r.isActive).map((r) => ({ value: r.id, label: `${r.name} (${KIND[r.kind]})` }))} /></Form.Item>
        <Form.Item name="range" label="Waktu" rules={[{ required: true }]}><DatePicker.RangePicker showTime={{ format: 'HH:mm', minuteStep: 15 }} format="D MMM YYYY HH:mm" style={{ width: '100%' }} /></Form.Item>
        <Space align="start">
          <Form.Item name="repeat" label="Ulangi (opsional)"><Select allowClear placeholder="Tidak berulang" style={{ width: 170 }} options={[{ value: 'WEEKLY', label: 'Setiap minggu' }, { value: 'DAILY', label: 'Setiap hari' }]} /></Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.repeat !== b.repeat}>{() => f.getFieldValue('repeat') ? <Form.Item name="count" label="Jumlah kejadian" initialValue={4}><InputNumber min={2} max={26} /></Form.Item> : null}</Form.Item>
        </Space>
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
  const [series, setSeries] = useState(false);
  const [cf] = Form.useForm<{ reason: string }>();
  const [moving, setMoving] = useState(false);
  const [mf] = Form.useForm<{ range: [dayjs.Dayjs, dayjs.Dayjs] }>();
  const done = useAction((id: string) => post(`/scheduling/bookings/${id}/done`), { invalidate: KEY, success: 'Ditandai selesai', onSuccess: () => setSel(null) });
  const toEntry = useAction((id: string) => post(`/scheduling/bookings/${id}/time-entry`), { invalidate: [...KEY, 'timesheets'], success: 'Draf catatan waktu dibuat (lihat Lembar waktu)', onSuccess: () => setSel(null) });
  const cancel = useAction((v: { reason: string }) => post(series ? `/scheduling/bookings/${sel!.id}/cancel-series` : `/scheduling/bookings/${sel!.id}/cancel`, v), { invalidate: KEY, success: 'Pemesanan dibatalkan', onSuccess: () => { setCancelling(false); setSel(null); } });
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
                  <b>{hm(b.startsAt)}–{hm(b.endsAt)}</b>{b.seriesId && <span title="Bagian dari seri berulang"> ↻</span>}{b.offHours && <Tag color="orange" style={{ marginLeft: 4, fontSize: 10, lineHeight: '14px', padding: '0 3px' }}>luar jam</Tag>}<div>{b.title}</div>
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
              {sel.status === 'BOOKED' && can('POST', '/scheduling/bookings/:id/cancel') && <Button danger onClick={() => { cf.resetFields(); setSeries(false); setCancelling(true); }}>Batalkan</Button>}
              {sel.status === 'BOOKED' && sel.seriesId && can('POST', '/scheduling/bookings/:id/cancel-series') && <Button danger onClick={() => { cf.resetFields(); setSeries(true); setCancelling(true); }}>Batalkan seri (ini dan setelahnya)</Button>}
            </Space>
          </Space>
        )}
      </Modal>
      <Modal title={series ? 'Batalkan seri pemesanan' : 'Batalkan pemesanan'} open={cancelling} onCancel={() => setCancelling(false)} onOk={() => cf.submit()} confirmLoading={cancel.isPending} okText="Batalkan" okButtonProps={{ danger: true }} destroyOnHidden>
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
      <Typography.Paragraph type="secondary">Mencari celah kosong pada jam dan hari kerja sumber daya tersebut (bawaan 08.00–17.00 WIB, Senin–Sabtu); hari cuti karyawan dilewati.</Typography.Paragraph>
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
  const [hoursFor, setHoursFor] = useState<Res | null>(null);
  const [hf] = Form.useForm<{ range: [number, number]; days: number[] }>();
  const saveHours = useAction((v: { workStart: number; workEnd: number; workDays: string }) => put(`/scheduling/resources/${hoursFor!.id}`, { name: hoursFor!.name, kind: hoursFor!.kind, employeeId: hoursFor!.employeeId ?? undefined, note: hoursFor!.note ?? undefined, isActive: hoursFor!.isActive, ...v }), { invalidate: KEY, success: 'Jam kerja disimpan', onSuccess: () => setHoursFor(null) });
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
        columns={[{ title: 'Nama', dataIndex: 'name' }, { title: 'Jenis', render: (_: unknown, r: Res) => KIND[r.kind] }, { title: 'Karyawan', render: (_: unknown, r: Res) => r.employeeName ?? '-' }, { title: 'Jam kerja (WIB)', render: (_: unknown, r: Res) => <span>{String(r.workStart).padStart(2, '0')}.00–{String(r.workEnd).padStart(2, '0')}.00 · {r.workDays.split(',').map((d) => DAYS[Number(d) - 1].label).join(' ')}{canEdit && <Button size="small" type="link" onClick={() => { hf.setFieldsValue({ range: [r.workStart, r.workEnd], days: r.workDays.split(',').map(Number) }); setHoursFor(r); }}>Atur</Button>}</span> }, { title: 'Aktif', render: (_: unknown, r: Res) => <Switch size="small" checked={r.isActive} disabled={!canEdit} onChange={() => toggle.mutate(r)} /> }]} />
      <Modal title={`Jam kerja ${hoursFor?.name ?? ''}`} open={!!hoursFor} onCancel={() => setHoursFor(null)} onOk={() => hf.submit()} confirmLoading={saveHours.isPending} okText="Simpan" destroyOnHidden>
        <Typography.Paragraph type="secondary">Pemesanan di luar jam/hari ini tetap bisa dibuat tetapi ditandai "luar jam" dan muncul di peringatan.</Typography.Paragraph>
        <Form form={hf} layout="vertical" onFinish={(v) => saveHours.mutate({ workStart: v.range[0], workEnd: v.range[1], workDays: [...v.days].sort().join(',') })}>
          <Space><Form.Item label="Mulai (jam)" name={['range', 0]} rules={[{ required: true }]}><InputNumber min={0} max={23} /></Form.Item><Form.Item label="Selesai (jam)" name={['range', 1]} rules={[{ required: true }]}><InputNumber min={1} max={24} /></Form.Item></Space>
          <Form.Item label="Hari kerja" name="days" rules={[{ required: true, message: 'Pilih minimal satu hari' }]}><Select mode="multiple" options={DAYS} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
