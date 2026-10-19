import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tabs, Tag, TimePicker, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post, put } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney } from '@/lib/format';
import { type WorkCenter, useWorkCenters } from './OperationsPanels';

const KEY = ['work-centers', 'production', 'order-ops'];
interface Plan { from: string; to: string; operations: { id: string; name: string; status: string; workCenterId: string; workCenterCode: string; orderNumber: string; scheduledStart: string; scheduledEnd: string }[]; downtime: { id: string; workCenterId: string; startsAt: string; endsAt: string; reason: string }[] }
interface Controls { overbookedDays: { code: string; name: string; day: string; hours: string; capacity: string }[]; overdueNotStarted: { name: string; orderNumber: string; workCenter: string; scheduledEnd: string }[]; overruns: { orderNumber: string; name: string; planned: string; actual: string; note: string | null }[]; scheduledDuringDowntime: { orderNumber: string; name: string; workCenter: string; reason: string }[]; scheduledOffShift?: { orderNumber: string; name: string; workCenter: string; scheduledStart: string }[]; unscheduledOrders: { orderNumber: string; operations: number }[] }
interface Util { from: string; to: string; rows: { id: string; code: string; name: string; capacityHours: string; actualHours: string; plannedHours: string; cost: string }[] }

export default function WorkCentersPage() {
  const controls = useQuery({ queryKey: ['production', 'sched-controls'], queryFn: () => get<Controls>('/production/schedule/controls'), retry: false });
  const c = controls.data;
  const warn = c ? c.overbookedDays.length + c.overdueNotStarted.length + c.scheduledDuringDowntime.length + c.overruns.length + (c.scheduledOffShift?.length ?? 0) : 0;
  return (
    <>
      <PageHeader title="Pusat kerja & jadwal mesin" />
      {warn > 0 && c && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Perlu ditindaklanjuti" description={
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {c.overbookedDays.map((o) => <li key={`${o.code}${o.day}`}>{o.code} dijadwalkan {Number(o.hours)} jam pada {o.day} (kapasitas {Number(o.capacity)} jam)</li>)}
            {c.overdueNotStarted.length > 0 && <li>{c.overdueNotStarted.length} operasi sudah lewat jadwal tetapi belum dimulai</li>}
            {c.scheduledDuringDowntime.map((d) => <li key={`${d.orderNumber}${d.name}`}>{d.orderNumber} · {d.name} di {d.workCenter} bertabrakan dengan mesin mati ({d.reason})</li>)}
            {(c.scheduledOffShift ?? []).map((d) => <li key={`${d.orderNumber}${d.name}`}>{d.orderNumber} · {d.name} di {d.workCenter} dijadwalkan di luar shift ({dayjs(d.scheduledStart).format('D MMM HH:mm')})</li>)}
            {c.overruns.length > 0 && <li>{c.overruns.length} operasi memakan waktu &gt; 150% rencana (60 hari terakhir)</li>}
          </ul>} />
      )}
      <Tabs destroyOnHidden items={[
        { key: 'pusat', label: 'Pusat kerja', children: <Centers /> },
        { key: 'jadwal', label: 'Jadwal', children: <Schedule /> },
        { key: 'pakai', label: 'Pemakaian', children: <Utilization /> },
      ]} />
    </>
  );
}

function Centers() {
  const can = useCan();
  const wcs = useWorkCenters();
  const [editing, setEditing] = useState<WorkCenter | 'new' | null>(null);
  const [down, setDown] = useState<WorkCenter | null>(null);
  const [shiftWc, setShiftWc] = useState<WorkCenter | null>(null);
  const [shf] = Form.useForm<{ rows: { days: number[]; range: [dayjs.Dayjs, dayjs.Dayjs] }[] }>();
  const shifts = useQuery({ queryKey: ['production', 'shifts', shiftWc?.id], enabled: !!shiftWc, queryFn: () => get<{ weekday: number; start: string; end: string }[]>(`/production/work-centers/${shiftWc!.id}/shifts`) });
  const saveShifts = useAction((v: { rows: { days: number[]; range: [dayjs.Dayjs, dayjs.Dayjs] }[] }) => put(`/production/work-centers/${shiftWc!.id}/shifts`, { shifts: (v.rows ?? []).flatMap((r) => r.days.map((weekday) => ({ weekday, start: r.range[0].format('HH:mm'), end: r.range[1].format('HH:mm') }))) }), { invalidate: [...KEY, 'shifts'], success: 'Kalender shift disimpan', onSuccess: () => setShiftWc(null) });
  const [f] = Form.useForm<{ code: string; name: string; kind: string; laborRate: number; overheadRate: number; capacityHours: number; isActive: boolean }>();
  const [df] = Form.useForm<{ range: [dayjs.Dayjs, dayjs.Dayjs]; reason: string }>();
  const save = useAction((v: { code: string; name: string; kind: string; laborRate: number; overheadRate: number; capacityHours: number; isActive: boolean }) => (editing === 'new' ? post('/production/work-centers', v) : put(`/production/work-centers/${(editing as WorkCenter).id}`, v)), { invalidate: KEY, success: 'Pusat kerja disimpan', onSuccess: () => setEditing(null) });
  const addDown = useAction((v: { range: [dayjs.Dayjs, dayjs.Dayjs]; reason: string }) => post(`/production/work-centers/${down!.id}/downtime`, { startsAt: v.range[0].toISOString(), endsAt: v.range[1].toISOString(), reason: v.reason }), { invalidate: KEY, success: 'Jadwal mesin mati dicatat', onSuccess: () => setDown(null) });
  return (
    <>
      {can('POST', '/production/work-centers') && <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { setEditing('new'); f.setFieldsValue({ code: '', name: '', kind: 'MACHINE', laborRate: 0, overheadRate: 0, capacityHours: 8, isActive: true }); }}>Pusat kerja baru</Button>}
      <Table<WorkCenter> rowKey="id" size="small" loading={wcs.isLoading} dataSource={wcs.data} pagination={false} locale={{ emptyText: 'Belum ada pusat kerja' }} scroll={{ x: 760 }}
        columns={[
          { title: 'Kode', dataIndex: 'code' }, { title: 'Nama', dataIndex: 'name' },
          { title: 'Upah / jam', render: (_: unknown, w: WorkCenter) => fmtMoney(w.laborRate) }, { title: 'Overhead / jam', render: (_: unknown, w: WorkCenter) => fmtMoney(w.overheadRate) },
          { title: 'Kapasitas', render: (_: unknown, w: WorkCenter) => `${Number(w.capacityHours)} jam/hari` }, { title: 'Status', render: (_: unknown, w: WorkCenter) => (w.isActive ? <Tag color="green">Aktif</Tag> : <Tag>Nonaktif</Tag>) },
          { render: (_: unknown, w: WorkCenter) => <Space>{can('PUT', '/production/work-centers/:id') && <Button size="small" onClick={() => { f.setFieldsValue({ ...w, laborRate: Number(w.laborRate), overheadRate: Number(w.overheadRate), capacityHours: Number(w.capacityHours) }); setEditing(w); }}>Ubah</Button>}{can('POST', '/production/work-centers/:id/downtime') && <Button size="small" onClick={() => { df.resetFields(); setDown(w); }}>Mesin mati</Button>}{can('PUT', '/production/work-centers/:id/shifts') && <Button size="small" onClick={() => { shf.resetFields(); setShiftWc(w); }}>Shift</Button>}</Space> },
        ]} />
      <Modal title={editing === 'new' ? 'Pusat kerja baru' : 'Ubah pusat kerja'} open={!!editing} onCancel={() => setEditing(null)} onOk={() => f.submit()} confirmLoading={save.isPending} okText="Simpan" destroyOnHidden>
        <Form form={f} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Space wrap><Form.Item name="code" label="Kode" rules={[{ required: true, min: 2 }]}><Input maxLength={30} style={{ width: 140 }} /></Form.Item><Form.Item name="name" label="Nama" rules={[{ required: true, min: 2 }]}><Input maxLength={100} style={{ width: 260 }} /></Form.Item></Space>
          <Form.Item name="kind" label="Jenis"><Select style={{ width: 200 }} options={[{ value: 'MACHINE', label: 'Mesin' }, { value: 'LINE', label: 'Lini produksi' }, { value: 'STATION', label: 'Stasiun kerja' }]} /></Form.Item>
          <Space wrap>
            <Form.Item name="laborRate" label="Upah per jam (Rp)" rules={[{ required: true }]}><InputNumber min={0} style={{ width: 160 }} /></Form.Item>
            <Form.Item name="overheadRate" label="Overhead per jam (Rp)" rules={[{ required: true }]}><InputNumber min={0} style={{ width: 160 }} /></Form.Item>
            <Form.Item name="capacityHours" label="Kapasitas jam/hari"><InputNumber min={0.5} max={24} style={{ width: 120 }} /></Form.Item>
          </Space>
          <Form.Item name="isActive" label="Aktif" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
      <Modal title={`Kalender shift — ${shiftWc?.code ?? ''}`} open={!!shiftWc} onCancel={() => setShiftWc(null)} onOk={() => shf.submit()} confirmLoading={saveShifts.isPending} okText="Simpan" width={640} destroyOnHidden
        afterOpenChange={(o) => { if (o && shifts.data) { const g = new Map<string, number[]>(); for (const x of shifts.data) g.set(`${x.start}-${x.end}`, [...(g.get(`${x.start}-${x.end}`) ?? []), x.weekday]); shf.setFieldsValue({ rows: [...g.entries()].map(([k, days]) => { const [a, b] = k.split('-'); return { days, range: [dayjs(a, 'HH:mm'), dayjs(b === '24:00' ? '23:59' : b, 'HH:mm')] as [dayjs.Dayjs, dayjs.Dayjs] }; }) }); } }}>
        <Typography.Paragraph type="secondary">Tanpa kalender, operasi bisa dijadwalkan kapan saja (hanya dibatasi kapasitas jam/hari). Dengan kalender, operasi harus berada di dalam satu shift pada hari yang sama; di luar itu hanya Admin dengan alasan dan ditandai di peringatan. Kapasitas harian mengikuti jumlah jam shift.</Typography.Paragraph>
        <Form form={shf} layout="vertical" onFinish={(v) => saveShifts.mutate(v)}>
          <Form.List name="rows">
            {(fields, { add, remove }) => (
              <>
                {fields.map((fl) => (
                  <Space key={fl.key} align="baseline" wrap>
                    <Form.Item name={[fl.name, 'days']} rules={[{ required: true, message: 'Pilih hari' }]}><Select mode="multiple" placeholder="Hari" style={{ width: 240 }} options={[{ value: 1, label: 'Sen' }, { value: 2, label: 'Sel' }, { value: 3, label: 'Rab' }, { value: 4, label: 'Kam' }, { value: 5, label: 'Jum' }, { value: 6, label: 'Sab' }, { value: 7, label: 'Min' }]} /></Form.Item>
                    <Form.Item name={[fl.name, 'range']} rules={[{ required: true, message: 'Isi jam' }]}><TimePicker.RangePicker format="HH:mm" minuteStep={15} /></Form.Item>
                    <Button danger size="small" onClick={() => remove(fl.name)}>Hapus</Button>
                  </Space>
                ))}
                <Button onClick={() => add({ days: [1, 2, 3, 4, 5], range: [dayjs('07:00', 'HH:mm'), dayjs('15:00', 'HH:mm')] })}>Tambah shift</Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
      <Modal title={`Mesin mati — ${down?.code ?? ''}`} open={!!down} onCancel={() => setDown(null)} onOk={() => df.submit()} confirmLoading={addDown.isPending} okText="Catat" destroyOnHidden>
        <Typography.Paragraph type="secondary">Waktu perawatan/kerusakan: operasi tidak bisa dijadwalkan pada rentang ini.</Typography.Paragraph>
        <Form form={df} layout="vertical" onFinish={(v) => addDown.mutate(v)}>
          <Form.Item name="range" label="Rentang waktu" rules={[{ required: true }]}><DatePicker.RangePicker showTime={{ format: 'HH:mm', minuteStep: 15 }} format="D MMM YYYY HH:mm" style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 3 }]}><Input maxLength={200} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function Schedule() {
  const wcs = useWorkCenters();
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().subtract(1, 'day'), dayjs().add(13, 'day')]);
  const [wc, setWc] = useState<string>();
  const from = range[0].format('YYYY-MM-DD');
  const to = range[1].format('YYYY-MM-DD');
  const plan = useQuery({ queryKey: ['production', 'schedule', from, to, wc], queryFn: () => get<Plan>(`/production/schedule?from=${from}&to=${to}${wc ? `&workCenterId=${wc}` : ''}`) });
  const rows = [
    ...(plan.data?.operations ?? []).map((o) => ({ key: o.id, start: o.scheduledStart, end: o.scheduledEnd, wc: o.workCenterCode, title: `${o.orderNumber} · ${o.name}`, kind: 'op' as const, status: o.status })),
    ...(plan.data?.downtime ?? []).filter((d) => !wc || d.workCenterId === wc).map((d) => ({ key: d.id, start: d.startsAt, end: d.endsAt, wc: (wcs.data ?? []).find((w) => w.id === d.workCenterId)?.code ?? '', title: `Mesin mati: ${d.reason}`, kind: 'down' as const, status: '' })),
  ].sort((a, b) => a.start.localeCompare(b.start));
  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <DatePicker.RangePicker allowClear={false} value={range} onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])} />
        <Select allowClear placeholder="Semua pusat kerja" style={{ width: 220 }} value={wc} onChange={setWc} options={(wcs.data ?? []).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
        <Typography.Text type="secondary">Jadwalkan operasi dari rincian perintah produksi (Produksi › Perintah produksi).</Typography.Text>
      </Space>
      <Table size="small" rowKey="key" loading={plan.isLoading} pagination={{ pageSize: 20 }} dataSource={rows} locale={{ emptyText: 'Tidak ada jadwal pada rentang ini' }}
        columns={[
          { title: 'Mulai', render: (_: unknown, r: (typeof rows)[number]) => dayjs(r.start).format('ddd D MMM HH:mm') }, { title: 'Selesai', render: (_: unknown, r: (typeof rows)[number]) => dayjs(r.end).format('D MMM HH:mm') },
          { title: 'Pusat kerja', dataIndex: 'wc' }, { title: 'Pekerjaan', render: (_: unknown, r: (typeof rows)[number]) => (r.kind === 'down' ? <Tag color="red">{r.title}</Tag> : r.title) },
          { title: 'Status', render: (_: unknown, r: (typeof rows)[number]) => (r.kind === 'op' ? <Tag>{r.status === 'RUNNING' ? 'Berjalan' : r.status === 'DONE' ? 'Selesai' : 'Menunggu'}</Tag> : null) },
        ]} />
    </>
  );
}

function Utilization() {
  const u = useQuery({ queryKey: ['production', 'wc-util'], queryFn: () => get<Util>('/production/work-centers-utilization'), retry: false });
  return (
    <Card>
      <Typography.Paragraph type="secondary">Jam aktual operasi selesai dan biayanya per pusat kerja (30 hari terakhir).</Typography.Paragraph>
      <Table size="small" rowKey="id" pagination={false} dataSource={u.data?.rows} locale={{ emptyText: 'Belum ada data' }}
        columns={[
          { title: 'Pusat kerja', render: (_: unknown, r: Util['rows'][number]) => `${r.code} · ${r.name}` }, { title: 'Jam aktual', render: (_: unknown, r: Util['rows'][number]) => Number(r.actualHours).toFixed(1) },
          { title: 'Jam rencana', render: (_: unknown, r: Util['rows'][number]) => Number(r.plannedHours).toFixed(1) },
          { title: 'Efisiensi', render: (_: unknown, r: Util['rows'][number]) => (Number(r.actualHours) ? `${Math.round((Number(r.plannedHours) / Number(r.actualHours)) * 100)}%` : '-') },
          { title: 'Biaya operasi', render: (_: unknown, r: Util['rows'][number]) => fmtMoney(r.cost) },
        ]} />
    </Card>
  );
}
