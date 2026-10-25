import { PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Tabs, Tag } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, patch, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';

import { WORK_LIMITS, WORK_PAGE_TITLE, WORK_UNIT_LABELS, WORK_UNITS_BY_MODEL, type WorkUnit } from '@sansu/shared';
import { useAuth } from '@/auth/AuthContext';
import { useHasRole } from '@/lib/roles';

type Unit = WorkUnit;
const UNIT = WORK_UNIT_LABELS;
interface Rate { id: string; name: string; unit: Unit; rate: string; isActive: boolean }
interface Entry {
  id: string; employeeCode: string; employeeName: string; rateName: string; unit: Unit; workDate: string; projectCode: string | null; invoiceNumber: string | null;
  quantity: string; rate: string; amount: string; description: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'VOID';
  productionNumber?: string | null; createdByName: string | null; decidedByName: string | null; decisionNote: string | null; runNumber: string | null; runStatus: string | null;
}
interface Employee { id: string; code: string; name: string; isActive: boolean; verified?: boolean }
interface ProdOrder { id: string; number: string; status: string; plannedQty?: string; outputQty?: string; paidQty?: string }
interface Project { id: string; code: string; name: string }
interface CommInvoice { id: string; number: string; date: string; subtotal: string; customerName: string; allocatedPct: string }
interface Warn { kind: string; severity: 'warn' | 'info'; message: string }
const STATUS = { PENDING: { color: 'gold', text: 'Menunggu' }, APPROVED: { color: 'green', text: 'Disetujui' }, REJECTED: { color: 'red', text: 'Ditolak' }, VOID: { color: 'default', text: 'Dibatalkan' } };

/** Upah usaha jasa: tarif, catatan kerja (jam / sesi / borongan / komisi faktur), persetujuan; otomatis masuk slip gaji bulan berjalan */
export default function ServiceWorkPage() {
  const { me } = useAuth();
  const model = me?.businessModel ?? 'JASA';
  return (
    <>
      <PageHeader title={WORK_PAGE_TITLE[model]} />
      <Tabs items={[
        { key: 'entries', label: 'Catatan kerja', children: <EntriesTab /> },
        { key: 'rates', label: 'Tarif', children: <RatesTab /> },
        { key: 'warn', label: 'Peringatan', children: <WarnTab /> },
      ]} />
    </>
  );
}

function EntriesTab() {
  const can = useCan();
  const [month, setMonth] = useState(dayjs());
  const [status, setStatus] = useState<string | undefined>();
  const period = month.format('YYYY-MM');
  const { data, isLoading } = useQuery({ queryKey: ['svc-entries', period, status], queryFn: () => get<Entry[]>(`/payroll/service/entries?period=${period}${status ? `&status=${status}` : ''}`) });
  const { data: employees } = useQuery({ queryKey: ['employees'], queryFn: () => get<Employee[]>('/payroll/service/staff') });
  const { data: rates } = useQuery({ queryKey: ['svc-rates'], queryFn: () => get<Rate[]>('/payroll/service/rates') });
  const { me } = useAuth();
  const isJasa = me?.businessModel === 'JASA';
  const isMfg = me?.businessModel === 'MANUFAKTUR';
  // daftar proyek hanya boleh dibaca Admin/Keuangan/Sales/Akuntan (sama dengan server); peran lain (mis. SDM) tidak memanggilnya
  const canProjects = useHasRole(['ADMIN', 'FINANCE', 'SALES', 'ACCOUNTANT']);
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: () => get<Project[]>('/services/projects'), enabled: isJasa && canProjects });
  const { data: invoices } = useQuery({ queryKey: ['svc-comm-invoices'], queryFn: () => get<CommInvoice[]>('/payroll/service/commissionable-invoices'), enabled: isJasa });
  const { data: prodOrders } = useQuery({ queryKey: ['svc-prod-orders'], queryFn: () => get<ProdOrder[]>('/payroll/service/production-orders'), enabled: isMfg });
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<{ e: Entry; mode: 'reject' | 'void' } | null>(null);
  const [form] = Form.useForm<{ employeeId: string; rateId: string; workDate: dayjs.Dayjs; quantity?: number; projectId?: string; invoiceId?: string; productionOrderId?: string; description?: string }>();
  const [df] = Form.useForm<{ reason: string }>();
  const rateId = Form.useWatch('rateId', form);
  const rate = rates?.find((r) => r.id === rateId);
  const create = useAction(
    (v: { employeeId: string; rateId: string; workDate: dayjs.Dayjs; quantity?: number; projectId?: string; invoiceId?: string; productionOrderId?: string; description?: string }) =>
      post('/payroll/service/entries', { employeeId: v.employeeId, rateId: v.rateId, workDate: v.workDate.format('YYYY-MM-DD'), quantity: v.quantity !== undefined ? String(v.quantity) : undefined, projectId: v.projectId, invoiceId: v.invoiceId, productionOrderId: v.productionOrderId, description: v.description }),
    { success: 'Catatan kerja dikirim untuk disetujui', invalidate: ['svc-entries', 'svc-comm-invoices'], onSuccess: () => setCreating(false) },
  );
  const approve = useAction((id: string) => post(`/payroll/service/entries/${id}/approve`, {}), { success: 'Disetujui — otomatis masuk gaji bulan ini', invalidate: ['svc-entries'] });
  const decide = useAction((v: { id: string; mode: 'reject' | 'void'; reason: string }) => post(`/payroll/service/entries/${v.id}/${v.mode}`, { reason: v.reason }), { success: 'Tersimpan', invalidate: ['svc-entries', 'svc-comm-invoices'], onSuccess: () => setDeciding(null) });
  const total = (data ?? []).filter((e) => e.status === 'APPROVED').reduce((a, e) => a + Number(e.amount), 0);
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={isJasa ? 'Catat pekerjaan (jam, sesi, borongan) atau komisi dari faktur jasa yang sudah lunas. Nominal dihitung otomatis dari tarif. Setelah disetujui orang lain (Keuangan/Admin), upahnya otomatis masuk slip gaji bulan itu dan menjadi biaya proyek bila dikaitkan ke proyek.' : 'Catat shift, hasil, atau borongan di luar gaji pokok. Nominal dihitung otomatis dari tarif; setelah disetujui orang lain (Keuangan/Admin) otomatis masuk slip gaji bulan itu. Lembur karyawan bergaji tetap dicatat di Absensi, bukan di sini.'} />
      <Space wrap style={{ marginBottom: 8 }}>
        <DatePicker picker="month" allowClear={false} value={month} onChange={(v) => v && setMonth(v)} />
        <Select allowClear placeholder="Semua status" style={{ width: 160 }} value={status} onChange={setStatus} options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.text }))} />
        {can('POST', '/payroll/service/entries') && <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); form.setFieldsValue({ workDate: dayjs() }); setCreating(true); }}>Catatan kerja baru</Button>}
        <span>Disetujui bulan ini: <strong>{fmtMoney(total)}</strong></span>
      </Space>
      <ResponsiveTable<Entry> rowKey="id" size="small" loading={isLoading} dataSource={data} pagination={{ pageSize: 15 }} scroll={{ x: 980 }} locale={{ emptyText: 'Belum ada catatan kerja' }}
        columns={[
          { title: 'Pegawai', render: (_: unknown, e: Entry) => `${e.employeeCode} · ${e.employeeName}` },
          { title: 'Tanggal', render: (_: unknown, e: Entry) => fmtDate(e.workDate) },
          { title: 'Pekerjaan', render: (_: unknown, e: Entry) => <span>{e.rateName}{e.unit !== 'PERCENT' ? ` × ${Number(e.quantity)}` : ` (${Number(e.rate)}%)`}{e.invoiceNumber ? ` · ${e.invoiceNumber}` : ''}{e.projectCode ? ` · ${e.projectCode}` : ''}{e.productionNumber ? ` · ${e.productionNumber}` : ''}</span> },
          { title: 'Upah', align: 'right' as const, render: (_: unknown, e: Entry) => fmtMoney(e.amount) },
          { title: 'Status', render: (_: unknown, e: Entry) => <span><Tag color={STATUS[e.status].color}>{STATUS[e.status].text}</Tag>{e.runNumber && <Tag>{e.runNumber}</Tag>}</span> },
          { title: 'Dicatat / diputuskan', render: (_: unknown, e: Entry) => `${e.createdByName ?? '-'}${e.decidedByName ? ` → ${e.decidedByName}` : ''}` },
          {
            render: (_: unknown, e: Entry) => (
              <Space wrap>
                {e.status === 'PENDING' && can('POST', '/payroll/service/entries/:id/approve') && <Popconfirm title="Setujui catatan ini?" onConfirm={() => approve.mutate(e.id)}><Button size="small" type="primary">Setujui</Button></Popconfirm>}
                {e.status === 'PENDING' && can('POST', '/payroll/service/entries/:id/reject') && <Button size="small" danger onClick={() => { df.resetFields(); setDeciding({ e, mode: 'reject' }); }}>Tolak</Button>}
                {(e.status === 'PENDING' || e.status === 'APPROVED') && e.runStatus !== 'POSTED' && e.runStatus !== 'PAID' && can('POST', '/payroll/service/entries/:id/void') && <Button size="small" onClick={() => { df.resetFields(); setDeciding({ e, mode: 'void' }); }}>Batalkan</Button>}
              </Space>
            ),
          },
        ]}
      />
      <Modal title="Catatan kerja baru" open={creating} onCancel={() => setCreating(false)} onOk={() => form.submit()} confirmLoading={create.isPending} okText="Kirim" destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Form.Item name="employeeId" label="Pegawai" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(employees ?? []).filter((e) => e.isActive && e.verified !== false).map((e) => ({ value: e.id, label: `${e.code} · ${e.name}` }))} /></Form.Item>
          <Form.Item name="rateId" label="Tarif" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(rates ?? []).filter((r) => r.isActive).map((r) => ({ value: r.id, label: `${r.name} — ${r.unit === 'PERCENT' ? `${Number(r.rate)}%` : fmtMoney(r.rate)} ${UNIT[r.unit]}` }))} /></Form.Item>
          <Form.Item name="workDate" label="Tanggal kerja" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day') || d.isBefore(dayjs().subtract(62, 'day'), 'day')} /></Form.Item>
          {rate && rate.unit !== 'PERCENT' && <Form.Item name="quantity" label={rate.unit === 'HOUR' ? 'Jumlah jam (maks. 16 per hari)' : rate.unit === 'SESSION' ? 'Jumlah sesi' : rate.unit === 'SHIFT' ? `Jumlah shift (maks. ${WORK_LIMITS.shiftPerDay} per hari)` : rate.unit === 'PIECE' ? 'Jumlah hasil (unit / koli)' : 'Jumlah pekerjaan'} rules={[{ required: true }]}><InputNumber min={rate.unit === 'SHIFT' ? 1 : 0.01} step={rate.unit === 'HOUR' ? 0.5 : 1} precision={rate.unit === 'SHIFT' ? 0 : undefined} style={{ width: 200 }} /></Form.Item>}
          {rate?.unit === 'PIECE' && isMfg && <Form.Item name="productionOrderId" label="Perintah produksi (opsional)" extra="Bila diisi, jumlah hasil yang dibayar dibatasi keluaran perintah itu."><Select allowClear showSearch optionFilterProp="label" options={(prodOrders ?? []).filter((o) => o.status === 'IN_PROGRESS' || o.status === 'COMPLETED').map((o) => ({ value: o.id, label: `${o.number} · ${o.status === 'COMPLETED' ? 'selesai' : 'berjalan'} · hasil dibayar ${Number(o.paidQty ?? 0)} dari ${Number(o.status === 'COMPLETED' ? o.outputQty : o.plannedQty)}` }))} /></Form.Item>}
          {rate?.unit === 'PERCENT' && <Form.Item name="invoiceId" label="Faktur jasa (sudah lunas)" rules={[{ required: true }]} extra="Komisi dihitung dari nilai faktur sebelum PPN. Satu pegawai hanya sekali per faktur."><Select showSearch optionFilterProp="label" options={(invoices ?? []).map((i) => ({ value: i.id, label: `${i.number} · ${i.customerName} · ${fmtMoney(i.subtotal)} (sisa ${100 - Number(i.allocatedPct)}%)` }))} /></Form.Item>}
          {isJasa && canProjects && <Form.Item name="projectId" label="Proyek (opsional)"><Select allowClear showSearch optionFilterProp="label" options={(projects ?? []).map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} /></Form.Item>}
          <Form.Item name="description" label="Keterangan"><Input maxLength={255} /></Form.Item>
        </Form>
      </Modal>
      <Modal title={deciding?.mode === 'reject' ? 'Tolak catatan kerja' : 'Batalkan catatan kerja'} open={!!deciding} onCancel={() => setDeciding(null)} onOk={() => df.submit()} confirmLoading={decide.isPending} okText="Simpan" okButtonProps={{ danger: true }} destroyOnHidden>
        <Form form={df} layout="vertical" onFinish={(v) => decide.mutate({ id: deciding!.e.id, mode: deciding!.mode, reason: v.reason })}>
          <Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5, message: 'Minimal 5 huruf' }]}><Input.TextArea rows={3} maxLength={255} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function RatesTab() {
  const can = useCan();
  const { data, isLoading } = useQuery({ queryKey: ['svc-rates'], queryFn: () => get<Rate[]>('/payroll/service/rates') });
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<{ name: string; unit: Unit; rate: number }>();
  const unit = Form.useWatch('unit', form);
  const { me } = useAuth();
  const allowedUnits = WORK_UNITS_BY_MODEL[me?.businessModel ?? 'JASA'];
  const create = useAction((v: { name: string; unit: Unit; rate: number }) => post('/payroll/service/rates', { ...v, rate: String(v.rate) }), { success: 'Tarif disimpan', invalidate: ['svc-rates'], onSuccess: () => setCreating(false) });
  const update = useAction((v: { id: string; rate?: number; isActive?: boolean }) => patch(`/payroll/service/rates/${v.id}`, { rate: v.rate !== undefined ? String(v.rate) : undefined, isActive: v.isActive }), { success: 'Tarif diperbarui', invalidate: ['svc-rates'] });
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Tarif hanya diatur Keuangan/Admin — yang mengisi catatan kerja (HR) tidak bisa mengubahnya. Tarif baru hanya berlaku untuk catatan berikutnya; catatan lama tetap memakai tarif saat dibuat." />
      {can('POST', '/payroll/service/rates') && <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 8 }} onClick={() => { form.resetFields(); form.setFieldsValue({ unit: allowedUnits[0] }); setCreating(true); }}>Tarif baru</Button>}
      <ResponsiveTable<Rate> rowKey="id" size="small" loading={isLoading} dataSource={data} pagination={false} locale={{ emptyText: 'Belum ada tarif' }}
        columns={[
          { title: 'Nama', render: (_: unknown, r: Rate) => <span>{r.name} {!r.isActive && <Tag>Nonaktif</Tag>}</span> },
          { title: 'Satuan', render: (_: unknown, r: Rate) => UNIT[r.unit] },
          { title: 'Tarif', align: 'right' as const, render: (_: unknown, r: Rate) => (r.unit === 'PERCENT' ? `${Number(r.rate)}%` : fmtMoney(r.rate)) },
          {
            render: (_: unknown, r: Rate) => can('PATCH', '/payroll/service/rates/:id') && (
              <Space wrap>
                <Switch size="small" checked={r.isActive} onChange={(isActive) => update.mutate({ id: r.id, isActive })} /> aktif
              </Space>
            ),
          },
        ]}
      />
      <Modal title="Tarif baru" open={creating} onCancel={() => setCreating(false)} onOk={() => form.submit()} confirmLoading={create.isPending} okText="Simpan" destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Form.Item name="name" label="Nama tarif" rules={[{ required: true, min: 2 }]}><Input maxLength={80} placeholder={me?.businessModel === 'JASA' ? 'mis. Konsultan senior — per jam' : me?.businessModel === 'MANUFAKTUR' ? 'mis. Jahit per potong' : 'mis. Premi shift malam'} /></Form.Item>
          <Form.Item name="unit" label="Satuan" rules={[{ required: true }]}><Select options={allowedUnits.map((value) => ({ value, label: UNIT[value] }))} /></Form.Item>
          <Form.Item name="rate" label={unit === 'PERCENT' ? 'Persen dari nilai faktur (1–100)' : 'Rupiah per satuan'} rules={[{ required: true }]}><InputNumber min={0.01} max={unit === 'PERCENT' ? 100 : undefined} prefix={unit === 'PERCENT' ? undefined : 'Rp'} suffix={unit === 'PERCENT' ? '%' : undefined} style={{ width: 220 }} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function WarnTab() {
  const [month, setMonth] = useState(dayjs());
  const period = month.format('YYYY-MM');
  const { data, isLoading } = useQuery({ queryKey: ['svc-anomalies', period], queryFn: () => get<Warn[]>(`/payroll/service/anomalies?period=${period}`) });
  return (
    <>
      <Space wrap style={{ marginBottom: 8 }}><DatePicker picker="month" allowClear={false} value={month} onChange={(v) => v && setMonth(v)} /></Space>
      {!isLoading && !data?.length && <Alert type="success" showIcon message="Tidak ada hal yang perlu diperiksa bulan ini." />}
      <Space direction="vertical" style={{ width: '100%' }}>
        {(data ?? []).map((w, i) => <Alert key={i} type={w.severity === 'warn' ? 'warning' : 'info'} showIcon message={w.message} />)}
      </Space>
      <p style={{ marginTop: 12, color: '#64748b', fontSize: 12 }}>Diperiksa: jam kerja dan shift berlebih sebulan, catatan yang bentrok dengan absensi, komisi yang tertahan karena fakturnya belum lunas/dibatalkan/diretur, hasil per perintah produksi yang melebihi keluaran, dan upah kerja yang jauh melebihi gaji tetap.</p>
    </>
  );
}
