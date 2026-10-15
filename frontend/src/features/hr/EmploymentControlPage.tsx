import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Form, Input, Modal, Popconfirm, Space, Tabs, Tag } from 'antd';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import type { Employee } from '@/api/types';
import { useCan } from '@/auth/useCan';
import ResponsiveTable from '@/components/ResponsiveTable';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';
import { EMP_TYPES } from './EmployeesPage';

interface Change { id: string; employeeCode: string; employeeName: string; changes: Record<string, { from: unknown; to: unknown }>; reason: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'; requestedByName: string | null; decidedByName: string | null; decisionNote: string | null; createdAt: string }
interface Warn { kind: string; severity: 'warn' | 'info'; message: string }
const FIELD: Record<string, string> = {
  baseSalary: 'Gaji pokok', fixedAllowance: 'Tunjangan tetap', dailyAllowance: 'Uang makan / hari', dailyWage: 'Upah harian', bankName: 'Bank', bankAccount: 'No. rekening',
  employmentType: 'Status', contractStart: 'Kontrak mulai', contractEnd: 'Kontrak berakhir', bpjsKes: 'BPJS Kesehatan', bpjsTk: 'BPJS TK', bpjsJp: 'Jaminan Pensiun',
  ptkp: 'PTKP', nik: 'NIK', npwp: 'NPWP', isActive: 'Aktif', resignDate: 'Tanggal keluar',
};
const MONEYF = new Set(['baseSalary', 'fixedAllowance', 'dailyAllowance', 'dailyWage']);
const show = (k: string, v: unknown) => {
  if (v === null || v === undefined || v === '') return '—';
  if (MONEYF.has(k)) return fmtMoney(String(v));
  if (k === 'employmentType') return EMP_TYPES[String(v)]?.label ?? String(v);
  if (typeof v === 'boolean') return v ? 'Ya' : 'Tidak';
  if (k.startsWith('contract') || k === 'resignDate') return fmtDate(String(v));
  return String(v);
};

/** Usaha jasa: persetujuan perubahan data sensitif karyawan, verifikasi karyawan baru, dan peringatan SDM */
export default function EmploymentControlPage() {
  return (
    <>
      <PageHeader title="Persetujuan & peringatan karyawan" />
      <Tabs items={[
        { key: 'changes', label: 'Perubahan data', children: <ChangesTab /> },
        { key: 'new', label: 'Karyawan baru', children: <NewTab /> },
        { key: 'warn', label: 'Peringatan', children: <WarnTab /> },
      ]} />
    </>
  );
}

function ChangesTab() {
  const can = useCan();
  const [status, setStatus] = useState<'PENDING' | 'ALL'>('PENDING');
  const { data, isLoading } = useQuery({ queryKey: ['emp-changes', status], queryFn: () => get<Change[]>(`/hr/employment/changes${status === 'PENDING' ? '?status=PENDING' : ''}`) });
  const [rejecting, setRejecting] = useState<Change | null>(null);
  const [form] = Form.useForm<{ reason: string }>();
  const approve = useAction((id: string) => post(`/hr/employment/changes/${id}/approve`, {}), { success: 'Disetujui — data karyawan diperbarui', invalidate: ['emp-changes', 'employees', 'payroll'] });
  const reject = useAction((v: { id: string; reason: string }) => post(`/hr/employment/changes/${v.id}/reject`, { reason: v.reason }), { success: 'Ditolak', invalidate: ['emp-changes'], onSuccess: () => setRejecting(null) });
  const cancel = useAction((id: string) => post(`/hr/employment/changes/${id}/cancel`, {}), { success: 'Permintaan ditarik', invalidate: ['emp-changes'] });
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Gaji, tunjangan, rekening bank, status, kontrak, BPJS, PTKP, dan NIK/NPWP yang diubah HR baru berlaku setelah disetujui orang lain. Periksa nilai lama → baru dan alasannya; rekening yang diganti diam-diam adalah modus penggelapan gaji yang umum." />
      <Space style={{ marginBottom: 8 }}>
        <Button type={status === 'PENDING' ? 'primary' : 'default'} onClick={() => setStatus('PENDING')}>Menunggu</Button>
        <Button type={status === 'ALL' ? 'primary' : 'default'} onClick={() => setStatus('ALL')}>Semua</Button>
      </Space>
      <ResponsiveTable<Change> rowKey="id" size="small" loading={isLoading} dataSource={data} pagination={{ pageSize: 15 }} scroll={{ x: 820 }} locale={{ emptyText: 'Tidak ada permintaan' }}
        columns={[
          { title: 'Karyawan', render: (_: unknown, c: Change) => `${c.employeeCode} · ${c.employeeName}` },
          { title: 'Perubahan', render: (_: unknown, c: Change) => <div>{Object.entries(c.changes).map(([k, v]) => <div key={k}><strong>{FIELD[k] ?? k}</strong>: {show(k, v.from)} → <strong>{show(k, v.to)}</strong></div>)}{c.reason && <div style={{ color: '#64748b', fontSize: 12 }}>Alasan: {c.reason}</div>}</div> },
          { title: 'Diajukan', render: (_: unknown, c: Change) => `${c.requestedByName ?? '-'} · ${fmtDate(c.createdAt)}` },
          { title: 'Status', render: (_: unknown, c: Change) => <span><Tag color={{ PENDING: 'gold', APPROVED: 'green', REJECTED: 'red', CANCELLED: 'default' }[c.status]}>{{ PENDING: 'Menunggu', APPROVED: 'Disetujui', REJECTED: 'Ditolak', CANCELLED: 'Ditarik' }[c.status]}</Tag>{c.decidedByName && <div style={{ fontSize: 12 }}>{c.decidedByName}{c.decisionNote ? `: ${c.decisionNote}` : ''}</div>}</span> },
          {
            render: (_: unknown, c: Change) => c.status === 'PENDING' && (
              <Space wrap>
                {can('POST', '/hr/employment/changes/:id/approve') && <Popconfirm title="Setujui perubahan ini?" onConfirm={() => approve.mutate(c.id)}><Button size="small" type="primary">Setujui</Button></Popconfirm>}
                {can('POST', '/hr/employment/changes/:id/reject') && <Button size="small" danger onClick={() => { form.resetFields(); setRejecting(c); }}>Tolak</Button>}
                {can('POST', '/hr/employment/changes/:id/cancel') && <Button size="small" onClick={() => cancel.mutate(c.id)}>Tarik</Button>}
              </Space>
            ),
          },
        ]}
      />
      <Modal title="Tolak perubahan" open={!!rejecting} onCancel={() => setRejecting(null)} onOk={() => form.submit()} confirmLoading={reject.isPending} okText="Tolak" okButtonProps={{ danger: true }} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => reject.mutate({ id: rejecting!.id, reason: v.reason })}>
          <Form.Item name="reason" label="Alasan" rules={[{ required: true, min: 5, message: 'Minimal 5 huruf' }]}><Input.TextArea rows={3} maxLength={255} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function NewTab() {
  const can = useCan();
  const { data, isLoading } = useQuery({ queryKey: ['employees'], queryFn: () => get<Employee[]>('/hr/employees') });
  const rows = (data ?? []).filter((e) => e.isActive && e.verified === false);
  const verify = useAction((id: string) => post(`/hr/employment/employees/${id}/verify`, {}), { success: 'Karyawan diverifikasi — ikut penggajian', invalidate: ['employees', 'payroll'] });
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Karyawan baru dari HR belum ikut penggajian dan belum bisa dicatat upah jasanya sampai diverifikasi orang lain. Periksa bahwa orangnya benar-benar ada, statusnya sesuai, dan rekening miliknya sendiri." />
      <ResponsiveTable<Employee> rowKey="id" size="small" loading={isLoading} dataSource={rows} pagination={false} locale={{ emptyText: 'Semua karyawan sudah diverifikasi' }}
        columns={[
          { title: 'Karyawan', render: (_: unknown, e: Employee) => `${e.code} · ${e.name}` },
          { title: 'Status', render: (_: unknown, e: Employee) => <Tag color={EMP_TYPES[e.employmentType ?? 'TETAP']?.color}>{EMP_TYPES[e.employmentType ?? 'TETAP']?.label}</Tag> },
          { title: 'Mulai kerja', render: (_: unknown, e: Employee) => fmtDate(e.joinDate) },
          { title: 'Gaji / upah', align: 'right' as const, render: (_: unknown, e: Employee) => (e.employmentType === 'HARIAN' ? `${fmtMoney(e.dailyWage ?? 0)} / hari` : e.employmentType === 'TENAGA_LEPAS' || e.employmentType === 'MITRA' ? 'per catatan kerja' : fmtMoney(e.baseSalary)) },
          { title: 'Rekening', render: (_: unknown, e: Employee) => (e.bankAccount ? `${e.bankName ?? ''} ${e.bankAccount}` : '—') },
          { render: (_: unknown, e: Employee) => can('POST', '/hr/employment/employees/:id/verify') && <Popconfirm title="Verifikasi karyawan ini?" onConfirm={() => verify.mutate(e.id)}><Button size="small" type="primary">Verifikasi</Button></Popconfirm> },
        ]}
      />
    </>
  );
}

function WarnTab() {
  const { data, isLoading } = useQuery({ queryKey: ['emp-alerts'], queryFn: () => get<Warn[]>('/hr/employment/alerts') });
  return (
    <>
      {!isLoading && !data?.length && <Alert type="success" showIcon message="Tidak ada hal yang perlu diperiksa." />}
      <Space direction="vertical" style={{ width: '100%' }}>
        {(data ?? []).map((w, i) => <Alert key={i} type={w.severity === 'warn' ? 'warning' : 'info'} showIcon message={w.message} />)}
      </Space>
      <p style={{ marginTop: 12, color: '#64748b', fontSize: 12 }}>Diperiksa: karyawan belum diverifikasi, kontrak berakhir / segera berakhir, NIK atau rekening ganda, data identitas dan rekening yang belum lengkap, serta permintaan yang menunggu terlalu lama.</p>
    </>
  );
}
