import { PlusOutlined } from '@ant-design/icons';
import { LEAVE_STATUS_LABELS, LEAVE_TYPE_LABELS, type LeaveStatus, toOptions } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag } from 'antd';
import { useState } from 'react';
import { get, post, qs } from '@/api/client';
import { useAction } from '@/api/queries';
import type { Employee, LeaveRequest } from '@/api/types';
import PageHeader from '@/layout/PageHeader';
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
  const [status, setStatus] = useState<string | undefined>('PENDING');
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const { data, isLoading } = useQuery({ queryKey: ['leaves', status], queryFn: () => get<LeaveRequest[]>(`/hr/leaves${qs({ status })}`) });
  const emps = useQuery({ queryKey: ['employees'], queryFn: () => get<Employee[]>('/hr/employees') });
  const create = useAction((v: object) => post('/hr/leaves', v), { success: 'Pengajuan cuti dibuat', invalidate: ['leaves'], onSuccess: () => setOpen(false) });
  const decide = useAction((v: { id: string; decision: 'APPROVED' | 'REJECTED' }) => post(`/hr/leaves/${v.id}/decide`, { decision: v.decision }), {
    success: 'Keputusan disimpan',
    invalidate: ['leaves', 'attendance', 'attendance-month', 'employees'],
  });

  return (
    <>
      <PageHeader
        title="Cuti"
        extra={
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
      />
      <Card>
        <Select allowClear placeholder="Semua status" value={status} onChange={setStatus} style={{ width: 200, marginBottom: 12 }} options={toOptions(LEAVE_STATUS_LABELS)} />
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={data}
          scroll={{ x: 900 }}
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
      </Card>
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
