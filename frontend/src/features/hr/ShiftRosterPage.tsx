import { LeftOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tabs, Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { api, get, post, patch } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import PageHeader from '@/layout/PageHeader';

interface Tpl { id: string; name: string; startTime: string; endTime: string; minStaff: number; premiumRateId: string | null; premiumRateName: string | null; premiumRate: string | null; isActive: boolean; hours: number }
interface Asg { id: string; employeeId: string; employeeCode: string; employeeName: string; templateId: string; templateName: string; workDate: string; startTime: string; endTime: string; premiumStatus: string | null; attendance: string | null }
interface Roster { assignments: Asg[]; gaps: { date: string; templateId: string; templateName: string; need: number; have: number }[] }
interface Emp { id: string; code: string; name: string; isActive: boolean; verified?: boolean }
interface AssignResult { created: number; failed: number; results: { employeeId: string; date: string; ok: boolean; error?: string; warnings?: string[] }[] }

const monday = (d: dayjs.Dayjs) => d.subtract((d.day() + 6) % 7, 'day').startOf('day');

/** Jadwal shift mingguan: pilih pegawai dan shift per hari; aturan istirahat, hari berturut-turut, dan jam per minggu dicek server */
export default function ShiftRosterPage() {
  return (
    <>
      <PageHeader title="Jadwal shift" />
      <Tabs items={[
        { key: 'roster', label: 'Jadwal', children: <RosterTab /> },
        { key: 'tpl', label: 'Shift', children: <TemplatesTab /> },
      ]} />
    </>
  );
}

function RosterTab() {
  const can = useCan();
  const [week, setWeek] = useState(monday(dayjs()));
  const from = week.format('YYYY-MM-DD');
  const to = week.add(6, 'day').format('YYYY-MM-DD');
  const { data: tpls } = useQuery({ queryKey: ['shift-tpls'], queryFn: () => get<Tpl[]>('/shifts/templates') });
  const { data: emps } = useQuery({ queryKey: ['employees'], queryFn: () => get<Emp[]>('/shifts/staff') });
  const roster = useQuery({ queryKey: ['shift-roster', from], queryFn: () => get<Roster>(`/shifts/roster?from=${from}&to=${to}`) });
  const [cell, setCell] = useState<{ employeeId: string; date: string } | null>(null);
  const [pick, setPick] = useState<string | undefined>();
  const [result, setResult] = useState<AssignResult | null>(null);
  const assign = useAction((v: { employeeId: string; date: string; templateId: string }) => post<AssignResult>('/shifts/roster', { employeeIds: [v.employeeId], dates: [v.date], templateId: v.templateId }), {
    invalidate: ['shift-roster'],
    onSuccess: (r) => { setResult(r); setCell(null); },
  });
  const remove = useAction((id: string) => api(`/shifts/roster/${id}`, { method: 'DELETE' }), { success: 'Penugasan dibatalkan', invalidate: ['shift-roster'] });
  const days = Array.from({ length: 7 }, (_, i) => week.add(i, 'day'));
  const active = (emps ?? []).filter((e) => e.isActive && e.verified !== false);
  const today = dayjs().format('YYYY-MM-DD');
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Server menolak jadwal yang bentrok, istirahat < 8 jam, > 2 shift per hari, > 6 hari berturut-turut, > 58 jam per minggu, atau pada hari cuti. Premi shift muncul otomatis (menunggu persetujuan Keuangan) hanya bila pegawai tercatat hadir di Absensi." />
      <Space wrap style={{ marginBottom: 8 }}>
        <Button icon={<LeftOutlined />} onClick={() => setWeek(week.subtract(7, 'day'))} />
        <strong>{week.format('DD MMM')} – {week.add(6, 'day').format('DD MMM YYYY')}</strong>
        <Button icon={<RightOutlined />} onClick={() => setWeek(week.add(7, 'day'))} />
        <Button onClick={() => setWeek(monday(dayjs()))}>Minggu ini</Button>
      </Space>
      {!!roster.data?.gaps.length && (
        <Alert type="warning" showIcon style={{ marginBottom: 8 }} message="Petugas kurang" description={roster.data.gaps.slice(0, 6).map((g) => `${dayjs(g.date).format('ddd DD/MM')} ${g.templateName}: ${g.have} dari ${g.need}`).join(' · ')} />
      )}
      <Table size="small" rowKey="id" loading={roster.isLoading} dataSource={active} pagination={false} scroll={{ x: 900 }}
        columns={[
          { title: 'Pegawai', fixed: 'left' as const, width: 170, render: (_: unknown, e: Emp) => `${e.code} · ${e.name}` },
          ...days.map((d) => ({
            title: <span style={{ color: d.format('YYYY-MM-DD') === today ? '#2563eb' : undefined }}>{d.format('ddd DD/MM')}</span>,
            width: 120,
            render: (_: unknown, e: Emp) => {
              const date = d.format('YYYY-MM-DD');
              const mine = (roster.data?.assignments ?? []).filter((a) => a.employeeId === e.id && a.workDate === date);
              return (
                <Space size={2} wrap>
                  {mine.map((a) => (
                    <Tooltip key={a.id} title={`${a.startTime}–${a.endTime}${a.attendance ? ` · absensi ${a.attendance}` : ''}${a.premiumStatus ? ` · premi ${a.premiumStatus === 'PENDING' ? 'menunggu' : 'disetujui'}` : ''}`}>
                      <Tag color={a.premiumStatus ? 'gold' : 'blue'} closable={date >= today && !a.premiumStatus && can('DELETE', '/shifts/roster/:id')} onClose={(ev) => { ev.preventDefault(); remove.mutate(a.id); }}>{a.templateName}</Tag>
                    </Tooltip>
                  ))}
                  {date >= today && can('POST', '/shifts/roster') && <Button size="small" type="text" icon={<PlusOutlined />} aria-label="Tambah shift" onClick={() => { setPick(undefined); setCell({ employeeId: e.id, date }); }} />}
                </Space>
              );
            },
          })),
        ]}
      />
      <Modal title="Tambah shift" open={!!cell} onCancel={() => setCell(null)} okText="Jadwalkan" okButtonProps={{ disabled: !pick, loading: assign.isPending }} onOk={() => cell && pick && assign.mutate({ ...cell, templateId: pick })} destroyOnHidden>
        <Select style={{ width: '100%' }} placeholder="Pilih shift" value={pick} onChange={setPick} options={(tpls ?? []).filter((t) => t.isActive).map((t) => ({ value: t.id, label: `${t.name} · ${t.startTime}–${t.endTime} (${t.hours} jam)` }))} />
      </Modal>
      <Modal title="Hasil penjadwalan" open={!!result} onCancel={() => setResult(null)} footer={<Button type="primary" onClick={() => setResult(null)}>Tutup</Button>}>
        {result?.results.map((r, i) => <Alert key={i} style={{ marginBottom: 6 }} type={r.ok ? (r.warnings?.length ? 'warning' : 'success') : 'error'} showIcon message={r.ok ? (r.warnings?.[0] ?? 'Dijadwalkan') : r.error} />)}
      </Modal>
    </>
  );
}

function TemplatesTab() {
  const can = useCan();
  const { data, isLoading } = useQuery({ queryKey: ['shift-tpls'], queryFn: () => get<Tpl[]>('/shifts/templates') });
  const { data: rates } = useQuery({ queryKey: ['svc-rates'], queryFn: () => get<{ id: string; name: string; unit: string; rate: string; isActive: boolean }[]>('/payroll/service/rates'), retry: false });
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<{ name: string; startTime: string; endTime: string; minStaff: number; premiumRateId?: string }>();
  const create = useAction((v: { name: string; startTime: string; endTime: string; minStaff: number; premiumRateId?: string }) => post('/shifts/templates', v), { success: 'Shift disimpan', invalidate: ['shift-tpls'], onSuccess: () => setCreating(false) });
  const toggle = useAction((v: { id: string; isActive: boolean }) => patch(`/shifts/templates/${v.id}`, { isActive: v.isActive }), { invalidate: ['shift-tpls'] });
  return (
    <>
      {can('POST', '/shifts/templates') && <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 8 }} onClick={() => { form.resetFields(); form.setFieldsValue({ startTime: '07:00', endTime: '15:00', minStaff: 1 }); setCreating(true); }}>Shift baru</Button>}
      <Table size="small" rowKey="id" loading={isLoading} dataSource={data} pagination={false}
        columns={[
          { title: 'Shift', dataIndex: 'name' },
          { title: 'Jam', render: (_: unknown, t: Tpl) => `${t.startTime}–${t.endTime} (${t.hours} jam)` },
          { title: 'Minimal petugas', dataIndex: 'minStaff', align: 'right' as const },
          { title: 'Premi', render: (_: unknown, t: Tpl) => (t.premiumRateName ? `${t.premiumRateName} · Rp${Number(t.premiumRate).toLocaleString('id-ID')}` : '—') },
          { title: 'Aktif', render: (_: unknown, t: Tpl) => <Switch size="small" checked={t.isActive} disabled={!can('PATCH', '/shifts/templates/:id')} onChange={(isActive) => toggle.mutate({ id: t.id, isActive })} /> },
        ]}
      />
      <Modal title="Shift baru" open={creating} onCancel={() => setCreating(false)} onOk={() => form.submit()} confirmLoading={create.isPending} okText="Simpan" destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Form.Item name="name" label="Nama shift" rules={[{ required: true, min: 2 }]}><Input maxLength={40} placeholder="mis. Pagi, Siang, Malam" /></Form.Item>
          <Space>
            <Form.Item name="startTime" label="Mulai" rules={[{ required: true, pattern: /^([01][0-9]|2[0-3]):[0-5][0-9]$/, message: 'Format JJ:MM' }]}><Input style={{ width: 100 }} /></Form.Item>
            <Form.Item name="endTime" label="Selesai" rules={[{ required: true, pattern: /^([01][0-9]|2[0-3]):[0-5][0-9]$/, message: 'Format JJ:MM' }]}><Input style={{ width: 100 }} /></Form.Item>
            <Form.Item name="minStaff" label="Minimal petugas"><InputNumber min={0} max={50} /></Form.Item>
          </Space>
          <Form.Item name="premiumRateId" label="Tarif premi (opsional)" extra="Pilih dari kartu tarif bersatuan per shift yang diatur Keuangan (menu Upah)."><Select allowClear options={(rates ?? []).filter((r) => r.unit === 'SHIFT' && r.isActive).map((r) => ({ value: r.id, label: `${r.name} · Rp${Number(r.rate).toLocaleString('id-ID')}` }))} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
