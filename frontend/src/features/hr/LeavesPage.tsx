import { PlusOutlined } from '@ant-design/icons';
import { LEAVE_STATUS_LABELS, LEAVE_TYPE_LABELS, type LeaveStatus, toOptions } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Tag } from 'antd';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import type { Employee, LeaveRequest } from '@/api/types';
import ListPage from '@/components/ListPage';
import dayjs from 'dayjs';
import { fmtDate } from '@/lib/format';

/** Hari kerja berikutnya (lewati Minggu) */
const nextWorkDay = () => {
  let d = dayjs();
  while (d.day() === 0) d = d.add(1, 'day');
  return d.format('YYYY-MM-DD');
};

const COLOR: Record<LeaveStatus, string> = { PENDING: 'orange', APPROVED: 'green', REJECTED: 'red' };

export default function LeavesPage() {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const { data, isLoading } = useQuery({ queryKey: ['leaves', 'all'], queryFn: () => get<LeaveRequest[]>('/hr/leaves') });
  const emps = useQuery({ queryKey: ['employees'], queryFn: () => get<Employee[]>('/hr/employees') });
  const create = useAction((v: object) => post('/hr/leaves', v), { success: 'Pengajuan cuti dibuat', invalidate: ['leaves'], onSuccess: () => setOpen(false) });
  const decide = useAction((v: { id: string; decision: 'APPROVED' | 'REJECTED' }) => post(`/hr/leaves/${v.id}/decide`, { decision: v.decision }), {
    success: 'Keputusan disimpan',
    invalidate: ['leaves', 'attendance', 'attendance-month', 'employees'],
  });

  return (
    <>
      <ListPage<LeaveRequest>
        title="Cuti"
        actions={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields();
              form.setFieldsValue({ type: 'ANNUAL', startDate: nextWorkDay(), endDate: nextWorkDay() });
              setOpen(true);
            }}
          >
            Ajukan cuti
          </Button>
        }
        rows={data}
        loading={isLoading}
        summary={(rows) => {
          const pending = rows.filter((l) => l.status === 'PENDING');
          const approved = rows.filter((l) => l.status === 'APPROVED');
          const days = (xs: LeaveRequest[]) => xs.reduce((a, l) => a + Number(l.days ?? 0), 0);
          return [
            { label: 'Menunggu keputusan', value: String(pending.length), hint: `${days(pending)} hari kerja`, tone: pending.length ? 'warn' : 'neutral' },
            { label: 'Disetujui', value: String(approved.length), hint: `${days(approved)} hari kerja`, tone: 'good' },
            { label: 'Ditolak', value: String(rows.filter((l) => l.status === 'REJECTED').length), hint: 'pengajuan' },
          ];
        }}
        views={[
          { value: 'PENDING', label: 'Menunggu', test: (l) => l.status === 'PENDING' },
          { value: 'APPROVED', label: 'Disetujui', test: (l) => l.status === 'APPROVED' },
          { value: 'REJECTED', label: 'Ditolak', test: (l) => l.status === 'REJECTED' },
          { value: 'ALL', label: 'Semua', test: () => true },
        ]}
        searchText={(l) => `${l.employee.code} ${l.employee.name} ${l.reason ?? ''}`}
        searchPlaceholder="Cari nama karyawan"
        emptyText="Belum ada pengajuan cuti"
        scrollX={900}
        columns={[
          { title: 'Karyawan', render: (_, l) => `${l.employee.code} · ${l.employee.name}` },
          { title: 'Jenis', dataIndex: 'type', render: (t: keyof typeof LEAVE_TYPE_LABELS) => LEAVE_TYPE_LABELS[t] },
          { title: 'Tanggal', render: (_, l) => (l.startDate === l.endDate ? fmtDate(l.startDate) : `${fmtDate(l.startDate)} – ${fmtDate(l.endDate)}`) },
          { title: 'Hari kerja', dataIndex: 'days', align: 'right' },
          { title: 'Alasan', dataIndex: 'reason' },
          { title: 'Status', dataIndex: 'status', render: (s: LeaveStatus) => <Tag color={COLOR[s]}>{LEAVE_STATUS_LABELS[s]}</Tag> },
          {
            render: (_, l) =>
              l.status === 'PENDING' && (
                <Space>
                  <Popconfirm title="Setujui cuti? Absensi terisi otomatis." onConfirm={() => decide.mutate({ id: l.id, decision: 'APPROVED' })}>
                    <Button size="small" type="primary">
                      Setujui
                    </Button>
                  </Popconfirm>
                  <Button size="small" danger onClick={() => decide.mutate({ id: l.id, decision: 'REJECTED' })}>
                    Tolak
                  </Button>
                </Space>
              ),
          },
        ]}
      />
      <Modal title="Ajukan cuti" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={create.isPending} okText="Ajukan">
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Form.Item name="employeeId" label="Karyawan" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={emps.data?.filter((e) => e.isActive).map((e) => ({ value: e.id, label: `${e.code} · ${e.name}` }))}
            />
          </Form.Item>
          <Form.Item name="type" label="Jenis cuti">
            <Select options={toOptions(LEAVE_TYPE_LABELS)} />
          </Form.Item>
          <Space wrap>
            <Form.Item name="startDate" label="Mulai" rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="endDate" label="Sampai" rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
          </Space>
          <Form.Item name="reason" label="Alasan">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
