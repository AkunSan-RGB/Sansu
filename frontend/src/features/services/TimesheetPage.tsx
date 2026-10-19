import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tabs, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { get, post, put } from '@/api/client';
import { useAction, useCustomers } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';

const KEY = ['timesheets'];
type Status = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'BILLED' | 'REJECTED' | 'WRITTEN_OFF';
const ST: Record<Status, { label: string; color: string }> = {
  DRAFT: { label: 'Draf', color: 'default' }, SUBMITTED: { label: 'Menunggu persetujuan', color: 'gold' }, APPROVED: { label: 'Disetujui', color: 'blue' },
  BILLED: { label: 'Tertagih', color: 'green' }, REJECTED: { label: 'Ditolak', color: 'red' }, WRITTEN_OFF: { label: 'Dihapus-tagih', color: 'default' },
};
interface Entry { id: string; employeeId: string; employeeName: string; projectId: string | null; projectName: string | null; customerId: string; customerName: string; workDate: string; hours: string; description: string; billable: boolean; rate: string | null; amount: string; rateNote: string | null; status: Status; decisionNote: string | null; invoiceId: string | null }
interface Emp { id: string; code: string; name: string }
interface Project { id: string; code: string; name: string; customerId: string; status: string }
interface Rate { id: string; employeeName: string | null; projectName: string | null; rate: string; validFrom: string; note: string | null }
interface Unbilled { customerId: string; customerName: string; projectId: string | null; projectName: string | null; entries: number; hours: string; amount: string; oldest: string }
interface Controls { submittedOver3Days: { id: string; employee: string; workDate: string; hours: string }[]; approvedUnbilledOver30Days: { customer: string; entries: number; hours: string; amount: string; oldest: string }[]; billableWithoutRate: { id: string; employee: string; workDate: string }[]; longDays: { employee: string; workDate: string; hours: string }[]; rateOverrides: { employee: string; workDate: string; rate: string; note: string }[]; writtenOff: { employee: string; workDate: string; hours: string; reason: string }[] }
interface Util { from: string; to: string; rows: { employeeId: string; employee: string; totalHours: string; billableHours: string; billed: string; approvedUnbilled: string }[] }

export default function TimesheetPage() {
  const can = useCan();
  const canApprove = can('POST', '/timesheets/entries/:id/approve');
  const canBill = can('POST', '/timesheets/bill');
  const controls = useQuery({ queryKey: [...KEY, 'controls'], queryFn: () => get<Controls>('/timesheets/controls'), retry: false });
  const warn = controls.data ? controls.data.submittedOver3Days.length + controls.data.approvedUnbilledOver30Days.length + controls.data.billableWithoutRate.length : 0;
  return (
    <>
      <PageHeader title="Lembar waktu" />
      {warn > 0 && controls.data && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Perlu ditindaklanjuti" description={
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {controls.data.submittedOver3Days.length > 0 && <li>{controls.data.submittedOver3Days.length} catatan menunggu persetujuan lebih dari 3 hari</li>}
            {controls.data.approvedUnbilledOver30Days.map((x) => <li key={x.customer}>{x.customer}: {x.hours} jam ({fmtMoney(x.amount)}) disetujui lebih dari 30 hari belum ditagih</li>)}
            {controls.data.billableWithoutRate.length > 0 && <li>{controls.data.billableWithoutRate.length} catatan dapat ditagih tetapi belum bertarif</li>}
          </ul>} />
      )}
      <Tabs destroyOnHidden items={[
        { key: 'catatan', label: 'Catatan waktu', children: <><TimerCard /><Entries /></> },
        ...(canApprove ? [{ key: 'setuju', label: 'Persetujuan', children: <Approvals /> }] : []),
        ...(canBill ? [{ key: 'tagih', label: 'Penagihan', children: <Billing /> }] : []),
        { key: 'tarif', label: 'Tarif', children: <Rates /> },
        ...(controls.data ? [{ key: 'kontrol', label: 'Kontrol & utilisasi', children: <ControlsTab c={controls.data} /> }] : []),
      ]} />
    </>
  );
}

function useProjects() {
  return useQuery({ queryKey: [...KEY, 'projects'], queryFn: () => get<Project[]>('/services/projects'), staleTime: 60_000 });
}
function useEmployees() {
  return useQuery({ queryKey: [...KEY, 'employees'], queryFn: () => get<Emp[]>('/hr/employees'), retry: false, staleTime: 60_000 });
}

interface TimerRow { id: string; customerName: string; description: string; startedAt: string; elapsedSeconds: number; billable: boolean }

/** Timer jam kerja: jam tidak diketik; dihentikan menjadi draf catatan waktu (dibulatkan ke atas per 15 menit) */
function TimerCard() {
  const can = useCan();
  const timer = useQuery({ queryKey: [...KEY, 'timer'], queryFn: () => get<TimerRow | null>('/timesheets/timer'), retry: false, refetchInterval: 60_000 });
  const customers = useCustomers();
  const projects = useProjects();
  const [f] = Form.useForm<{ customerId?: string; projectId?: string; description: string }>();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const start = useAction((v: { customerId?: string; projectId?: string; description: string }) => post('/timesheets/timer/start', v), { invalidate: KEY, success: 'Timer dimulai', onSuccess: () => f.resetFields() });
  const stop = useAction(() => post('/timesheets/timer/stop'), { invalidate: KEY, success: 'Timer dihentikan; draf catatan waktu dibuat' });
  const [discarding, setDiscarding] = useState(false);
  const [df] = Form.useForm<{ reason: string }>();
  const discard = useAction((v: { reason: string }) => post('/timesheets/timer/discard', v), { invalidate: KEY, success: 'Timer dibuang', onSuccess: () => setDiscarding(false) });
  if (!can('POST', '/timesheets/timer/start')) return null;
  const t = timer.data && 'id' in timer.data ? timer.data : null;
  const secs = t ? Math.max(0, Math.floor((now - new Date(t.startedAt).getTime()) / 1000)) : 0;
  const clock = `${String(Math.floor(secs / 3600)).padStart(2, '0')}:${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  return (
    <Card size="small" style={{ marginBottom: 12 }} title="Timer">
      {t ? (
        <Space wrap>
          <Typography.Title level={3} style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>{clock}</Typography.Title>
          <span>{t.description} · {t.customerName}</span>
          <Button type="primary" danger onClick={() => stop.mutate()} loading={stop.isPending}>Hentikan</Button>
          <Button onClick={() => { df.resetFields(); setDiscarding(true); }}>Buang</Button>
        </Space>
      ) : (
        <Form form={f} layout="inline" onFinish={(v) => start.mutate(v)} style={{ rowGap: 8 }}>
          <Form.Item name="description" rules={[{ required: true, min: 3 }]}><Input placeholder="Sedang mengerjakan apa?" maxLength={300} style={{ width: 240 }} /></Form.Item>
          <Form.Item name="projectId"><Select allowClear showSearch optionFilterProp="label" placeholder="Proyek" style={{ width: 200 }} options={(projects.data ?? []).filter((p) => p.status === 'ACTIVE').map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} /></Form.Item>
          <Form.Item name="customerId"><Select allowClear showSearch optionFilterProp="label" placeholder="Klien (bila tanpa proyek)" style={{ width: 220 }} options={(customers.data ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Form.Item>
          <Button htmlType="submit" type="primary" loading={start.isPending}>Mulai</Button>
        </Form>
      )}
      <Modal title="Buang timer" open={discarding} onCancel={() => setDiscarding(false)} onOk={() => df.submit()} confirmLoading={discard.isPending} okText="Buang" okButtonProps={{ danger: true }} destroyOnHidden>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Waktu timer ini tidak dicatat. Alasan tersimpan di jejak audit; catat jamnya manual bila perlu." />
        <Form form={df} layout="vertical" onFinish={(v) => discard.mutate(v)}><Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5 }]}><Input maxLength={255} /></Form.Item></Form>
      </Modal>
    </Card>
  );
}

function Entries() {
  const can = useCan();
  const [status, setStatus] = useState<string>();
  const list = useQuery({ queryKey: [...KEY, 'entries', status], queryFn: () => get<Entry[]>(`/timesheets/entries${status ? `?status=${status}` : ''}`) });
  const customers = useCustomers();
  const projects = useProjects();
  const emps = useEmployees();
  const [editing, setEditing] = useState<Entry | 'new' | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [form] = Form.useForm<{ employeeId?: string; workDate: dayjs.Dayjs; hours: number; projectId?: string; customerId?: string; description: string; billable: boolean }>();
  const projectId = Form.useWatch('projectId', form);
  const save = useAction((v: { employeeId?: string; workDate: dayjs.Dayjs; hours: number; projectId?: string; customerId?: string; description: string; billable: boolean }) => {
    const body = { ...v, workDate: v.workDate.format('YYYY-MM-DD'), hours: String(v.hours) };
    return editing === 'new' ? post('/timesheets/entries', body) : put(`/timesheets/entries/${(editing as Entry).id}`, { workDate: body.workDate, hours: body.hours, description: body.description, billable: body.billable });
  }, { invalidate: KEY, success: 'Catatan disimpan', onSuccess: () => setEditing(null) });
  const submit = useAction((ids: string[]) => post('/timesheets/submit', { ids }), { invalidate: KEY, success: 'Diajukan untuk persetujuan', onSuccess: () => setPicked([]) });
  const total = (list.data ?? []).reduce((a, e) => a + Number(e.hours), 0);
  const open = (e: Entry | 'new') => {
    setEditing(e);
    if (e === 'new') form.setFieldsValue({ workDate: dayjs(), hours: undefined, projectId: undefined, customerId: undefined, description: '', billable: true, employeeId: undefined });
    else form.setFieldsValue({ workDate: dayjs(e.workDate), hours: Number(e.hours), description: e.description, billable: e.billable });
  };
  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        {can('POST', '/timesheets/entries') && <Button type="primary" onClick={() => open('new')}>Catat waktu</Button>}
        <Select allowClear placeholder="Semua status" value={status} onChange={setStatus} style={{ width: 200 }} options={Object.entries(ST).map(([k, v]) => ({ value: k, label: v.label }))} />
        <Button disabled={!picked.length} onClick={() => submit.mutate(picked)} loading={submit.isPending}>Ajukan terpilih ({picked.length})</Button>
        <Typography.Text type="secondary">Total {total.toLocaleString('id-ID')} jam</Typography.Text>
      </Space>
      <ResponsiveTable<Entry> rowKey="id" size="small" loading={list.isLoading} dataSource={list.data} pagination={{ pageSize: 15 }} scroll={{ x: 900 }} locale={{ emptyText: 'Belum ada catatan waktu' }}
        rowSelection={{ selectedRowKeys: picked, onChange: (k) => setPicked(k as string[]), getCheckboxProps: (e) => ({ disabled: !['DRAFT', 'REJECTED'].includes(e.status) }) }}
        columns={[
          { title: 'Tanggal', render: (_: unknown, e: Entry) => fmtDate(e.workDate) },
          { title: 'Karyawan', dataIndex: 'employeeName' },
          { title: 'Klien / proyek', render: (_: unknown, e: Entry) => <div>{e.customerName}{e.projectName && <div style={{ fontSize: 12, color: '#64748b' }}>{e.projectName}</div>}</div> },
          { title: 'Uraian', dataIndex: 'description', ellipsis: true },
          { title: 'Jam', render: (_: unknown, e: Entry) => `${Number(e.hours)}${e.billable ? '' : ' (non-tagih)'}` },
          { title: 'Nilai', render: (_: unknown, e: Entry) => (e.billable && e.rate ? fmtMoney(e.amount) : e.billable ? <Tag color="orange">belum bertarif</Tag> : '-') },
          { title: 'Status', render: (_: unknown, e: Entry) => <div><Tag color={ST[e.status].color}>{ST[e.status].label}</Tag>{e.decisionNote && <div style={{ fontSize: 12, color: '#64748b' }}>{e.decisionNote}</div>}</div> },
          { render: (_: unknown, e: Entry) => (['DRAFT', 'REJECTED'].includes(e.status) && can('PUT', '/timesheets/entries/:id') ? <Space><Button size="small" onClick={() => open(e)}>Ubah</Button><Button size="small" onClick={() => submit.mutate([e.id])}>Ajukan</Button></Space> : null) },
        ]} />
      <Modal title={editing === 'new' ? 'Catat waktu' : 'Ubah catatan waktu'} open={!!editing} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={save.isPending} okText="Simpan" destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          {editing === 'new' && emps.data && emps.data.length > 0 && can('POST', '/timesheets/rates') && <Form.Item name="employeeId" label="Karyawan (kosong = saya)"><Select allowClear showSearch optionFilterProp="label" options={emps.data.map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }))} /></Form.Item>}
          <Space wrap>
            <Form.Item name="workDate" label="Tanggal" rules={[{ required: true }]}><DatePicker allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} /></Form.Item>
            <Form.Item name="hours" label="Jam" rules={[{ required: true }]}><InputNumber min={0.25} max={16} step={0.25} style={{ width: 110 }} /></Form.Item>
          </Space>
          {editing === 'new' && (
            <>
              <Form.Item name="projectId" label="Proyek (opsional)"><Select allowClear showSearch optionFilterProp="label" options={(projects.data ?? []).filter((p) => p.status === 'ACTIVE').map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} /></Form.Item>
              {!projectId && <Form.Item name="customerId" label="Klien" rules={[{ required: true, message: 'Pilih klien atau proyek' }]}><Select showSearch optionFilterProp="label" options={(customers.data ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Form.Item>}
            </>
          )}
          <Form.Item name="description" label="Uraian pekerjaan" rules={[{ required: true, min: 3 }]}><Input maxLength={300} /></Form.Item>
          <Form.Item name="billable" label="Dapat ditagih" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function Approvals() {
  const can = useCan();
  const list = useQuery({ queryKey: [...KEY, 'entries', 'SUBMITTED'], queryFn: () => get<Entry[]>('/timesheets/entries?status=SUBMITTED') });
  const [dec, setDec] = useState<{ e: Entry; mode: 'approve' | 'reject' } | null>(null);
  const [f] = Form.useForm<{ reason?: string; rate?: number; rateNote?: string }>();
  const admin = can('POST', '/timesheets/entries/:id/write-off'); // hanya Admin/Pemilik yang boleh ubah tarif
  const decide = useAction((v: { reason?: string; rate?: number; rateNote?: string }) => post(`/timesheets/entries/${dec!.e.id}/${dec!.mode}`, dec!.mode === 'reject' ? { reason: v.reason } : { rate: v.rate != null ? String(v.rate) : undefined, rateNote: v.rateNote }), { invalidate: KEY, success: 'Tersimpan', onSuccess: () => setDec(null) });
  return (
    <>
      <ResponsiveTable<Entry> rowKey="id" size="small" loading={list.isLoading} dataSource={list.data} pagination={{ pageSize: 15 }} locale={{ emptyText: 'Tidak ada catatan yang menunggu persetujuan' }}
        columns={[
          { title: 'Tanggal', render: (_: unknown, e: Entry) => fmtDate(e.workDate) }, { title: 'Karyawan', dataIndex: 'employeeName' }, { title: 'Klien', dataIndex: 'customerName' },
          { title: 'Uraian', dataIndex: 'description', ellipsis: true }, { title: 'Jam', render: (_: unknown, e: Entry) => Number(e.hours) },
          { title: 'Tarif', render: (_: unknown, e: Entry) => (e.billable ? (e.rate ? fmtMoney(e.rate) : <Tag color="orange">belum ada</Tag>) : 'non-tagih') },
          { render: (_: unknown, e: Entry) => <Space><Button size="small" type="primary" onClick={() => { f.resetFields(); setDec({ e, mode: 'approve' }); }}>Setujui</Button><Button size="small" danger onClick={() => { f.resetFields(); setDec({ e, mode: 'reject' }); }}>Tolak</Button></Space> },
        ]} />
      <Modal title={dec?.mode === 'approve' ? 'Setujui catatan waktu' : 'Tolak catatan waktu'} open={!!dec} onCancel={() => setDec(null)} onOk={() => f.submit()} confirmLoading={decide.isPending} okText="Simpan" destroyOnHidden>
        {dec && <Typography.Paragraph type="secondary">{dec.e.employeeName} · {fmtDate(dec.e.workDate)} · {Number(dec.e.hours)} jam · {dec.e.description}</Typography.Paragraph>}
        <Form form={f} layout="vertical" onFinish={(v) => decide.mutate(v)}>
          {dec?.mode === 'reject' ? (
            <Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5, message: 'Minimal 5 huruf' }]}><Input maxLength={255} /></Form.Item>
          ) : admin && dec?.e.billable ? (
            <>
              <Form.Item name="rate" label="Ubah tarif per jam (opsional, Admin/Pemilik)"><InputNumber min={1} style={{ width: 200 }} placeholder={dec.e.rate ? String(Number(dec.e.rate)) : 'tarif'} /></Form.Item>
              <Form.Item noStyle shouldUpdate={(a, b) => a.rate !== b.rate}>{({ getFieldValue }) => getFieldValue('rate') != null && <Form.Item name="rateNote" label="Alasan ubah tarif" rules={[{ required: true, min: 5 }]}><Input maxLength={255} /></Form.Item>}</Form.Item>
            </>
          ) : null}
        </Form>
      </Modal>
    </>
  );
}

function Billing() {
  const can = useCan();
  const unbilled = useQuery({ queryKey: [...KEY, 'unbilled'], queryFn: () => get<Unbilled[]>('/timesheets/unbilled') });
  const [group, setGroup] = useState<Unbilled | null>(null);
  const entries = useQuery({ queryKey: [...KEY, 'billable', group?.customerId, group?.projectId], enabled: !!group, queryFn: async () => (await get<Entry[]>(`/timesheets/entries?status=APPROVED&customerId=${group!.customerId}`)).filter((e) => e.billable && (e.projectId ?? null) === (group!.projectId ?? null)) });
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [f] = Form.useForm<{ date: dayjs.Dayjs; withVat: boolean; description?: string }>();
  const sum = (entries.data ?? []).filter((e) => picked.includes(e.id)).reduce((a, e) => a + Number(e.amount), 0);
  const bill = useAction((v: { date: dayjs.Dayjs; withVat: boolean; description?: string }) => post<{ number: string }>('/timesheets/bill', { customerId: group!.customerId, entryIds: picked, date: v.date.format('YYYY-MM-DD'), withVat: v.withVat, description: v.description }), { invalidate: KEY, success: (r) => `Faktur ${(r as { number: string }).number} dibuat`, onSuccess: () => { setOpen(false); setPicked([]); setGroup(null); } });
  const [wo, setWo] = useState<Entry | null>(null);
  const [wf] = Form.useForm<{ reason: string }>();
  const writeOff = useAction((v: { reason: string }) => post(`/timesheets/entries/${wo!.id}/write-off`, v), { invalidate: KEY, success: 'Dihapus-tagih', onSuccess: () => setWo(null) });
  return (
    <>
      <Typography.Paragraph type="secondary">Waktu yang sudah disetujui dan belum ditagih. Pilih pelanggan/proyek, centang catatan, lalu buat faktur jasa (jam × tarif).</Typography.Paragraph>
      <ResponsiveTable<Unbilled> rowKey={(u) => `${u.customerId}-${u.projectId ?? ''}`} size="small" loading={unbilled.isLoading} dataSource={unbilled.data} pagination={false} locale={{ emptyText: 'Tidak ada waktu yang menunggu penagihan' }}
        columns={[
          { title: 'Klien / proyek', render: (_: unknown, u: Unbilled) => <div>{u.customerName}{u.projectName && <div style={{ fontSize: 12, color: '#64748b' }}>{u.projectName}</div>}</div> },
          { title: 'Catatan', dataIndex: 'entries' }, { title: 'Jam', render: (_: unknown, u: Unbilled) => Number(u.hours) },
          { title: 'Nilai', render: (_: unknown, u: Unbilled) => fmtMoney(u.amount) }, { title: 'Tertua', render: (_: unknown, u: Unbilled) => fmtDate(u.oldest) },
          { render: (_: unknown, u: Unbilled) => <Button size="small" type="primary" onClick={() => { setGroup(u); setPicked([]); }}>Pilih</Button> },
        ]} />
      {group && (
        <Card style={{ marginTop: 16 }} title={`${group.customerName}${group.projectName ? ` · ${group.projectName}` : ''}`} extra={<Button onClick={() => setGroup(null)}>Tutup</Button>}>
          <ResponsiveTable<Entry> rowKey="id" size="small" loading={entries.isLoading} dataSource={entries.data} pagination={false}
            rowSelection={{ selectedRowKeys: picked, onChange: (k) => setPicked(k as string[]) }}
            columns={[
              { title: 'Tanggal', render: (_: unknown, e: Entry) => fmtDate(e.workDate) }, { title: 'Karyawan', dataIndex: 'employeeName' }, { title: 'Uraian', dataIndex: 'description', ellipsis: true },
              { title: 'Jam × tarif', render: (_: unknown, e: Entry) => `${Number(e.hours)} × ${fmtMoney(e.rate ?? 0)}` }, { title: 'Nilai', render: (_: unknown, e: Entry) => fmtMoney(e.amount) },
              { render: (_: unknown, e: Entry) => (can('POST', '/timesheets/entries/:id/write-off') ? <Button size="small" danger onClick={() => { wf.resetFields(); setWo(e); }}>Hapus-tagih</Button> : null) },
            ]} />
          <Space style={{ marginTop: 12 }}>
            <Button type="primary" disabled={!picked.length} onClick={() => { f.setFieldsValue({ date: dayjs(), withVat: true, description: undefined }); setOpen(true); }}>Buat faktur ({picked.length})</Button>
            {picked.length > 0 && <Typography.Text type="secondary">Subtotal {fmtMoney(sum)}</Typography.Text>}
          </Space>
        </Card>
      )}
      <Modal title="Buat faktur dari lembar waktu" open={open} onCancel={() => setOpen(false)} onOk={() => f.submit()} confirmLoading={bill.isPending} okText="Buat faktur" destroyOnHidden>
        <Form form={f} layout="vertical" onFinish={(v) => bill.mutate(v)}>
          <Form.Item name="date" label="Tanggal faktur" rules={[{ required: true }]}><DatePicker allowClear={false} /></Form.Item>
          <Form.Item name="withVat" valuePropName="checked"><Checkbox>Kenakan PPN (bila PKP)</Checkbox></Form.Item>
          <Form.Item name="description" label="Keterangan faktur"><Input maxLength={300} placeholder="mis. Jasa konsultasi Oktober 2026" /></Form.Item>
        </Form>
      </Modal>
      <Modal title="Hapus-tagih catatan waktu" open={!!wo} onCancel={() => setWo(null)} onOk={() => wf.submit()} confirmLoading={writeOff.isPending} okText="Hapus-tagih" okButtonProps={{ danger: true }} destroyOnHidden>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Waktu ini tidak akan ditagih. Tercatat di jejak audit." />
        <Form form={wf} layout="vertical" onFinish={(v) => writeOff.mutate(v)}><Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5 }]}><Input maxLength={255} /></Form.Item></Form>
      </Modal>
    </>
  );
}

function Rates() {
  const can = useCan();
  const rates = useQuery({ queryKey: [...KEY, 'rates'], queryFn: () => get<Rate[]>('/timesheets/rates') });
  const projects = useProjects();
  const emps = useEmployees();
  const [f] = Form.useForm<{ employeeId?: string; projectId?: string; rate: number; validFrom: dayjs.Dayjs; note?: string }>();
  const add = useAction((v: { employeeId?: string; projectId?: string; rate: number; validFrom: dayjs.Dayjs; note?: string }) => post('/timesheets/rates', { ...v, rate: String(v.rate), validFrom: v.validFrom.format('YYYY-MM-DD') }), { invalidate: KEY, success: 'Tarif ditambahkan', onSuccess: () => f.resetFields() });
  return (
    <>
      <Typography.Paragraph type="secondary">Tarif per jam. Yang paling spesifik dipakai: proyek + karyawan, lalu proyek, lalu karyawan, lalu tarif umum — berlaku sejak tanggalnya.</Typography.Paragraph>
      {can('POST', '/timesheets/rates') && (
        <Form form={f} layout="inline" onFinish={(v) => add.mutate(v)} style={{ marginBottom: 12, rowGap: 8 }} initialValues={{ validFrom: dayjs() }}>
          <Form.Item name="employeeId"><Select allowClear showSearch optionFilterProp="label" placeholder="Semua karyawan" style={{ width: 200 }} options={(emps.data ?? []).map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }))} /></Form.Item>
          <Form.Item name="projectId"><Select allowClear showSearch optionFilterProp="label" placeholder="Semua proyek" style={{ width: 200 }} options={(projects.data ?? []).map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} /></Form.Item>
          <Form.Item name="rate" rules={[{ required: true }]}><InputNumber min={1} placeholder="Tarif/jam" style={{ width: 130 }} /></Form.Item>
          <Form.Item name="validFrom" rules={[{ required: true }]}><DatePicker allowClear={false} /></Form.Item>
          <Button htmlType="submit" type="primary" loading={add.isPending}>Tambah</Button>
        </Form>
      )}
      <Table<Rate> rowKey="id" size="small" pagination={false} dataSource={rates.data} locale={{ emptyText: 'Belum ada tarif' }}
        columns={[{ title: 'Karyawan', render: (_: unknown, r: Rate) => r.employeeName ?? 'Semua' }, { title: 'Proyek', render: (_: unknown, r: Rate) => r.projectName ?? 'Semua' }, { title: 'Tarif/jam', render: (_: unknown, r: Rate) => fmtMoney(r.rate) }, { title: 'Berlaku sejak', render: (_: unknown, r: Rate) => fmtDate(r.validFrom) }]} />
    </>
  );
}

function ControlsTab({ c }: { c: Controls }) {
  const util = useQuery({ queryKey: [...KEY, 'util'], queryFn: () => get<Util>('/timesheets/utilization'), retry: false });
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={5} style={{ margin: 0 }}>Utilisasi 30 hari</Typography.Title>
      <Table size="small" rowKey="employeeId" pagination={false} dataSource={util.data?.rows} locale={{ emptyText: 'Belum ada data' }}
        columns={[
          { title: 'Karyawan', dataIndex: 'employee' }, { title: 'Jam dicatat', render: (_: unknown, r: Util['rows'][number]) => Number(r.totalHours) },
          { title: 'Jam dapat ditagih', render: (_: unknown, r: Util['rows'][number]) => Number(r.billableHours) },
          { title: '% tagih', render: (_: unknown, r: Util['rows'][number]) => (Number(r.totalHours) ? `${Math.round((Number(r.billableHours) / Number(r.totalHours)) * 100)}%` : '-') },
          { title: 'Tertagih', render: (_: unknown, r: Util['rows'][number]) => fmtMoney(r.billed) }, { title: 'Disetujui belum ditagih', render: (_: unknown, r: Util['rows'][number]) => fmtMoney(r.approvedUnbilled) },
        ]} />
      {c.longDays.length > 0 && <Alert type="info" showIcon message="Hari dengan jam kerja > 12" description={c.longDays.map((x) => `${x.employee} ${fmtDate(x.workDate)} (${Number(x.hours)} jam)`).join('; ')} />}
      {c.rateOverrides.length > 0 && <Alert type="info" showIcon message="Tarif diubah manual (60 hari)" description={c.rateOverrides.map((x) => `${x.employee} ${fmtDate(x.workDate)}: ${fmtMoney(x.rate)} — ${x.note}`).join('; ')} />}
      {c.writtenOff.length > 0 && <Alert type="info" showIcon message="Dihapus-tagih (60 hari)" description={c.writtenOff.map((x) => `${x.employee} ${fmtDate(x.workDate)} ${Number(x.hours)} jam — ${x.reason}`).join('; ')} />}
    </Space>
  );
}
