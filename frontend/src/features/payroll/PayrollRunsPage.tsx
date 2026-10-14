import { PlusOutlined } from '@ant-design/icons';
import { PAYROLL_STATUS_LABELS, type PayrollStatus } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Form, Input, Modal, Tag } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import type { PayrollRun } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import ListPage from '@/components/ListPage';
import { fmtDate, fmtMoney } from '@/lib/format';

export const PAYROLL_COLOR: Record<PayrollStatus, string> = { DRAFT: 'default', POSTED: 'blue', PAID: 'green' };

export default function PayrollRunsPage() {
  const navigate = useNavigate();
  const { me } = useAuth();
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
      <ListPage<PayrollRun>
        title="Penggajian"
        actions={
          (me?.role === 'OWNER' || me?.role === 'HR') && (
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
          )
        }
        rows={data}
        loading={isLoading}
        summary={(rows) => {
          const done = rows.filter((r) => r.status !== 'DRAFT');
          const total = (k: 'totalGross' | 'totalNet') => done.reduce((a, r) => a + Number(r[k] ?? 0), 0);
          return [
            { label: 'Total gaji kotor (sudah diproses)', value: fmtMoney(total('totalGross')), hint: `${done.length} penggajian` },
            { label: 'Total gaji bersih', value: fmtMoney(total('totalNet')), hint: 'yang diterima karyawan' },
            { label: 'Masih draf', value: String(rows.filter((r) => r.status === 'DRAFT').length), hint: 'belum diproses', tone: rows.some((r) => r.status === 'DRAFT') ? 'warn' : 'neutral' },
          ];
        }}
        views={[
          { value: 'ALL', label: 'Semua', test: () => true },
          { value: 'DRAFT', label: 'Draf', test: (r) => r.status === 'DRAFT' },
          { value: 'POSTED', label: 'Belum dibayar', test: (r) => r.status === 'POSTED' },
          { value: 'PAID', label: 'Sudah dibayar', test: (r) => r.status === 'PAID' },
        ]}
        searchText={(r) => `${r.number} ${r.period}`}
        searchPlaceholder="Cari nomor atau bulan"
        emptyText="Belum ada penggajian"
        onRowClick={(r) => navigate(`/payroll/${r.id}`)}
        scrollX={800}
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
