import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction, useCustomers } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';

const KEY = ['education'];
interface ClassRow { id: string; code: string; name: string; monthlyFee: string; capacity: number | null; startDate: string; endDate: string | null; isActive: boolean; students: number }
interface EnrollRow { id: string; classId: string; className: string; customerName: string; studentName: string; enrolledOn: string; leftOn: string | null; discountPct: string; monthlyFee: string; billedPeriods: string[] }
interface DueRow { customerId: string; total: string; students: { enrollmentId: string; studentName: string; className: string; amount: string }[] }

/** Pendidikan/kursus: kelas dengan kuota, peserta (ditagih ke wali), dan SPP bulanan satu faktur per wali */
export default function EducationPage() {
  const can = useCan();
  const customers = useCustomers();
  const classes = useQuery({ queryKey: [...KEY, 'classes'], queryFn: () => get<ClassRow[]>('/services/education/classes') });
  const enrolls = useQuery({ queryKey: [...KEY, 'enrollments'], queryFn: () => get<EnrollRow[]>('/services/education/enrollments') });
  const [period, setPeriod] = useState(dayjs().format('YYYY-MM'));
  const due = useQuery({ queryKey: [...KEY, 'due', period], queryFn: () => get<DueRow[]>(`/services/education/due?period=${period}`) });
  const [newClass, setNewClass] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [leaving, setLeaving] = useState<EnrollRow | null>(null);
  const [cf] = Form.useForm<{ code: string; name: string; monthlyFee: number; capacity?: number; startDate: dayjs.Dayjs }>();
  const [ef] = Form.useForm<{ classId: string; customerId: string; studentName: string; enrolledOn: dayjs.Dayjs; discountPct?: number }>();
  const [lf] = Form.useForm<{ leftOn: dayjs.Dayjs; reason: string }>();
  const createClass = useAction((v: { code: string; name: string; monthlyFee: number; capacity?: number; startDate: dayjs.Dayjs }) => post('/services/education/classes', { ...v, monthlyFee: String(v.monthlyFee), startDate: v.startDate.format('YYYY-MM-DD') }), { invalidate: KEY, success: 'Kelas dibuat', onSuccess: () => setNewClass(false) });
  const enroll = useAction((v: { classId: string; customerId: string; studentName: string; enrolledOn: dayjs.Dayjs; discountPct?: number }) => post('/services/education/enrollments', { ...v, enrolledOn: v.enrolledOn.format('YYYY-MM-DD'), discountPct: v.discountPct ? String(v.discountPct) : undefined }), { invalidate: KEY, success: 'Peserta didaftarkan', onSuccess: () => setEnrolling(false) });
  const leave = useAction((v: { leftOn: dayjs.Dayjs; reason: string }) => post(`/services/education/enrollments/${leaving!.id}/leave`, { ...v, leftOn: v.leftOn.format('YYYY-MM-DD') }), { invalidate: KEY, success: 'Peserta dicatat keluar', onSuccess: () => setLeaving(null) });
  // jasa pendidikan umumnya dibebaskan PPN: SPP ditagih tanpa PPN kecuali dicentang
  const [sppVat, setSppVat] = useState(false);
  const bill = useAction(() => post('/services/education/bill', { period, withVat: sppVat }), { invalidate: [...KEY, 'invoices'], success: 'SPP ditagih: satu faktur per wali' });
  const nameOf = (id: string) => (customers.data ?? []).find((c) => c.id === id)?.name ?? '-';
  const total = (due.data ?? []).reduce((a, d) => a + Number(d.total), 0);
  return (
    <>
      <PageHeader title="Kelas & SPP" />
      <Tabs
        items={[
          {
            key: 'classes',
            label: 'Kelas',
            children: (
              <>
                {can('POST', '/services/education/classes') && <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { cf.resetFields(); setNewClass(true); }}>Kelas baru</Button>}
                <Table<ClassRow> size="small" rowKey="id" loading={classes.isLoading} dataSource={classes.data} pagination={false} locale={{ emptyText: 'Belum ada kelas' }}
                  columns={[
                    { title: 'Kode', dataIndex: 'code' },
                    { title: 'Kelas', dataIndex: 'name' },
                    { title: 'SPP / bulan', align: 'right', render: (_: unknown, r: ClassRow) => fmtMoney(r.monthlyFee) },
                    { title: 'Peserta', align: 'right', render: (_: unknown, r: ClassRow) => (r.capacity ? <Tag color={r.students >= r.capacity ? 'red' : 'default'}>{r.students} / {r.capacity}</Tag> : r.students) },
                    { title: 'Masa', render: (_: unknown, r: ClassRow) => `${fmtDate(r.startDate)} – ${r.endDate ? fmtDate(r.endDate) : 'berjalan'}` },
                    { title: 'Status', render: (_: unknown, r: ClassRow) => (r.isActive ? <Tag color="green">aktif</Tag> : <Tag>ditutup</Tag>) },
                  ]} />
              </>
            ),
          },
          {
            key: 'students',
            label: 'Peserta',
            children: (
              <>
                {can('POST', '/services/education/enrollments') && <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { ef.resetFields(); setEnrolling(true); }}>Daftarkan peserta</Button>}
                <Table<EnrollRow> size="small" rowKey="id" loading={enrolls.isLoading} dataSource={enrolls.data} pagination={{ pageSize: 20 }} locale={{ emptyText: 'Belum ada peserta' }} scroll={{ x: 800 }}
                  columns={[
                    { title: 'Peserta', dataIndex: 'studentName' },
                    { title: 'Kelas', dataIndex: 'className' },
                    { title: 'Wali (ditagih)', dataIndex: 'customerName' },
                    { title: 'Masuk', dataIndex: 'enrolledOn', render: fmtDate },
                    { title: 'Diskon', align: 'right', render: (_: unknown, r: EnrollRow) => (Number(r.discountPct) ? `${Number(r.discountPct)}%` : '-') },
                    { title: 'SPP ditagih', render: (_: unknown, r: EnrollRow) => (r.billedPeriods.length ? <Typography.Text>{r.billedPeriods.length} periode</Typography.Text> : '-') },
                    { title: '', render: (_: unknown, r: EnrollRow) => (r.leftOn ? <Tag>keluar {fmtDate(r.leftOn)}</Tag> : can('POST', '/services/education/enrollments/:id/leave') && <Button size="small" onClick={() => { lf.resetFields(); setLeaving(r); }}>Keluar</Button>) },
                  ]} />
              </>
            ),
          },
          {
            key: 'bill',
            label: 'Tagih SPP',
            children: (
              <>
                <Space style={{ marginBottom: 12 }} wrap>
                  <DatePicker picker="month" allowClear={false} value={dayjs(`${period}-01`)} onChange={(d) => d && setPeriod(d.format('YYYY-MM'))} />
                  <Checkbox checked={sppVat} onChange={(e) => setSppVat(e.target.checked)}>Kenakan PPN pada SPP</Checkbox>
                  {can('POST', '/services/education/bill') && <Button type="primary" disabled={!due.data?.length} loading={bill.isPending} onClick={() => bill.mutate(undefined)}>Tagih semua ({due.data?.length ?? 0} wali, {fmtMoney(total)})</Button>}
                </Space>
                <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Satu faktur per wali dengan satu baris per peserta. Bulan masuk dan bulan keluar ditagih penuh (tanpa prorata); peserta dengan tagihan periode ini tidak muncul lagi." />
                <Table<DueRow> size="small" rowKey="customerId" loading={due.isLoading} dataSource={due.data} pagination={false} locale={{ emptyText: `Semua SPP periode ${period} sudah ditagih` }}
                  columns={[
                    { title: 'Wali', render: (_: unknown, r: DueRow) => nameOf(r.customerId) },
                    { title: 'Peserta', render: (_: unknown, r: DueRow) => r.students.map((s) => <div key={s.enrollmentId}>{s.studentName} · {s.className} · {fmtMoney(s.amount)}</div>) },
                    { title: 'Jumlah', align: 'right', render: (_: unknown, r: DueRow) => <b>{fmtMoney(r.total)}</b> },
                  ]} />
              </>
            ),
          },
        ]}
      />
      <Modal title="Kelas baru" open={newClass} onCancel={() => setNewClass(false)} onOk={() => cf.submit()} confirmLoading={createClass.isPending} okText="Simpan" destroyOnHidden>
        <Form form={cf} layout="vertical" onFinish={(v) => createClass.mutate(v)} initialValues={{ startDate: dayjs().startOf('month') }}>
          <Form.Item name="code" label="Kode" rules={[{ required: true, min: 2 }]}><Input maxLength={30} placeholder="mis. MAT-7" /></Form.Item>
          <Form.Item name="name" label="Nama kelas" rules={[{ required: true, min: 3 }]}><Input maxLength={120} /></Form.Item>
          <Form.Item name="monthlyFee" label="SPP per bulan" rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="capacity" label="Kuota peserta (opsional)"><InputNumber min={1} style={{ width: 160 }} /></Form.Item>
          <Form.Item name="startDate" label="Mulai" rules={[{ required: true }]}><DatePicker /></Form.Item>
        </Form>
      </Modal>
      <Modal title="Daftarkan peserta" open={enrolling} onCancel={() => setEnrolling(false)} onOk={() => ef.submit()} confirmLoading={enroll.isPending} okText="Daftarkan" destroyOnHidden>
        <Form form={ef} layout="vertical" onFinish={(v) => enroll.mutate(v)} initialValues={{ enrolledOn: dayjs() }}>
          <Form.Item name="classId" label="Kelas" rules={[{ required: true }]}><Select options={(classes.data ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Form.Item>
          <Form.Item name="studentName" label="Nama peserta" rules={[{ required: true, min: 2 }]}><Input maxLength={120} /></Form.Item>
          <Form.Item name="customerId" label="Wali yang ditagih" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(customers.data ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Form.Item>
          <Space align="start">
            <Form.Item name="enrolledOn" label="Tanggal masuk" rules={[{ required: true }]}><DatePicker /></Form.Item>
            <Form.Item name="discountPct" label="Diskon SPP (%)"><InputNumber min={0} max={100} style={{ width: 140 }} /></Form.Item>
          </Space>
        </Form>
      </Modal>
      <Modal title={`Peserta keluar: ${leaving?.studentName ?? ''}`} open={!!leaving} onCancel={() => setLeaving(null)} onOk={() => lf.submit()} confirmLoading={leave.isPending} okText="Catat keluar" destroyOnHidden>
        <Form form={lf} layout="vertical" onFinish={(v) => leave.mutate(v)} initialValues={{ leftOn: dayjs() }}>
          <Form.Item name="leftOn" label="Tanggal keluar" rules={[{ required: true }]}><DatePicker /></Form.Item>
          <Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5 }]}><Input maxLength={255} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
