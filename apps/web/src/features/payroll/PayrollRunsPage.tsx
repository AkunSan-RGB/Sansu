import { PlusOutlined } from '@ant-design/icons';
import { PAYROLL_STATUS_LABELS, type PayrollStatus } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Modal, Table, Tag } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import type { PayrollRun } from '@/api/types';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';

export const PAYROLL_COLOR: Record<PayrollStatus, string> = { DRAFT: 'default', POSTED: 'blue', PAID: 'green' };

export default function PayrollRunsPage() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const { data, isLoading } = useQuery({ queryKey: ['payroll'], queryFn: () => get<PayrollRun[]>('/payroll/runs') });
  const create = useAction((v: { period: string; payDate?: string }) => post<PayrollRun>('/payroll/runs', { ...v, payDate: v.payDate || undefined }), {
    success: (r) => `Draft gaji ${r.number} dibuat untuk ${r.payslips?.length ?? 0} karyawan`,
    invalidate: ['payroll'],
    onSuccess: (r) => navigate(`/payroll/${r.id}`),
  });

  return (
    <>
      <PageHeader
        title="Penggajian"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              const period = dayjs().format('YYYY-MM');
              form.setFieldsValue({ period, payDate: dayjs().endOf('month').format('YYYY-MM-DD') });
              setOpen(true);
            }}
          >
            Proses gaji bulan ini
          </Button>
        }
      />
      <Card>
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={data}
          scroll={{ x: 800 }}
          onRow={(r) => ({ onClick: () => navigate(`/payroll/${r.id}`), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Nomor', dataIndex: 'number' },
            { title: 'Periode', dataIndex: 'period', render: (p) => dayjs(`${p}-01`).format('MMMM YYYY') },
            { title: 'Tanggal bayar', dataIndex: 'payDate', render: fmtDate },
            { title: 'Karyawan', render: (_, r) => r.payslips?.length ?? 0, align: 'right' },
            { title: 'Total bruto', dataIndex: 'totalGross', align: 'right', render: (v, r) => (r.status === 'DRAFT' ? '-' : fmtMoney(v)) },
            { title: 'PPh 21', dataIndex: 'totalPph21', align: 'right', render: (v, r) => (r.status === 'DRAFT' ? '-' : fmtMoney(v)) },
            { title: 'Gaji bersih', dataIndex: 'totalNet', align: 'right', render: (v, r) => (r.status === 'DRAFT' ? '-' : fmtMoney(v)) },
            { title: 'Status', dataIndex: 'status', render: (s: PayrollStatus) => <Tag color={PAYROLL_COLOR[s]}>{PAYROLL_STATUS_LABELS[s]}</Tag> },
          ]}
        />
      </Card>
      <Modal title="Proses gaji" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={create.isPending} okText="Hitung gaji">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Gaji dihitung dari data karyawan & absensi: BPJS, lembur, potongan tidak hadir, dan PPh 21 metode TER (Desember: perhitungan setahun). Hasilnya draft yang masih bisa diubah."
        />
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Form.Item name="period" label="Periode" rules={[{ required: true }]}>
            <Input type="month" />
          </Form.Item>
          <Form.Item name="payDate" label="Tanggal gaji (tanggal jurnal)">
            <Input type="date" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
