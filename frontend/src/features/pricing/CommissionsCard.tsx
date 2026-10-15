import ResponsiveTable from '@/components/ResponsiveTable';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Space, Tag } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import { fmtDate, fmtMoney } from '@/lib/format';

interface Commission {
  id: string;
  number: string;
  userName: string;
  period: string;
  netSales: string;
  commissionPct: string;
  amount: string;
  status: 'ACCRUED' | 'PAID' | 'VOID';
  pph21Withheld: string;
  paidAt: string | null;
  voidReason: string | null;
}
const STATUS = { ACCRUED: { color: 'gold', text: 'Utang komisi' }, PAID: { color: 'green', text: 'Dibayar' }, VOID: { color: 'default', text: 'Batal' } };

/** Jurnal komisi: tutup bulan (pembukuan) → bayar (Keuangan) / batalkan sebelum dibayar (Admin) */
export default function CommissionsCard() {
  const can = useCan();
  const { data, isLoading } = useQuery({ queryKey: ['sales-commissions'], queryFn: () => get<Commission[]>('/sales-commissions') });
  const [paying, setPaying] = useState<Commission | null>(null);
  const [voiding, setVoiding] = useState<Commission | null>(null);
  const [month, setMonth] = useState(dayjs().subtract(1, 'month').format('YYYY-MM'));
  const [form] = Form.useForm<{ pph21?: number }>();
  const [voidForm] = Form.useForm<{ reason: string }>();
  const close = useAction(() => post<{ created: number; total: string }>('/sales-commissions/close', { period: month }), {
    success: (r) => (r.created ? `${r.created} komisi ditutup (${fmtMoney(r.total)})` : 'Tidak ada komisi baru untuk ditutup'),
    invalidate: ['sales-commissions', 'sales-targets', 'journals', 'reports'],
  });
  const pay = useAction((v: { id: string; pph21?: number }) => post(`/sales-commissions/${v.id}/pay`, { pph21: v.pph21 ? String(v.pph21) : undefined }), {
    success: 'Komisi dibayar',
    invalidate: ['sales-commissions', 'journals', 'reports', 'cash-accounts', 'cash-tx'],
    onSuccess: () => setPaying(null),
  });
  const voidIt = useAction((v: { id: string; reason: string }) => post(`/sales-commissions/${v.id}/void`, { reason: v.reason }), {
    success: 'Komisi dibatalkan dengan jurnal balik',
    invalidate: ['sales-commissions', 'sales-targets', 'journals', 'reports'],
    onSuccess: () => setVoiding(null),
  });
  return (
    <>
      <Card style={{ marginTop: 16 }} title="Jurnal komisi"
        extra={can('POST', '/sales-commissions/close') && (
          <Space>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 150 }} />
            <Popconfirm title={`Tutup komisi ${month}?`} description="Angka dibekukan dan dijurnal sebagai utang komisi. Target bulan itu terkunci." okText="Tutup" cancelText="Batal" onConfirm={() => close.mutate(undefined)}>
              <Button type="primary" loading={close.isPending}>Tutup komisi bulan</Button>
            </Popconfirm>
          </Space>
        )}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Yang menutup (pembukuan) dan yang membayar (Keuangan) harus orang berbeda. Komisi pegawai tetap adalah penghasilan kena PPh 21: isi PPh 21 yang dipotong saat membayar, atau masukkan komisi ke penggajian." />
        <ResponsiveTable<Commission> rowKey="id" size="small" loading={isLoading} dataSource={data} pagination={{ pageSize: 10 }} scroll={{ x: 760 }} locale={{ emptyText: 'Belum ada komisi yang ditutup' }}
          columns={[
            { title: 'Nomor', dataIndex: 'number' },
            { title: 'Sales', dataIndex: 'userName' },
            { title: 'Bulan', dataIndex: 'period' },
            { title: 'Omzet neto', align: 'right' as const, render: (_: unknown, c: Commission) => fmtMoney(c.netSales) },
            { title: 'Komisi', align: 'right' as const, render: (_: unknown, c: Commission) => <span>{fmtMoney(c.amount)} <span style={{ color: '#64748b', fontSize: 12 }}>({Number(c.commissionPct)}%)</span></span> },
            { title: 'Status', render: (_: unknown, c: Commission) => <Tag color={STATUS[c.status].color}>{STATUS[c.status].text}</Tag> },
            { title: '', render: (_: unknown, c: Commission) => c.status === 'ACCRUED' ? (
              <Space>
                {can('POST', '/sales-commissions/:id/pay') && <Button size="small" type="primary" onClick={() => { form.resetFields(); setPaying(c); }}>Bayar</Button>}
                {can('POST', '/sales-commissions/:id/void') && <Button size="small" danger onClick={() => { voidForm.resetFields(); setVoiding(c); }}>Batalkan</Button>}
              </Space>
            ) : c.status === 'PAID' ? <span style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(c.paidAt)}{Number(c.pph21Withheld) > 0 ? ` · PPh 21 ${fmtMoney(c.pph21Withheld)}` : ''}</span> : <span style={{ fontSize: 12, color: '#64748b' }}>{c.voidReason}</span> },
          ]} />
      </Card>
      <Modal title={`Bayar komisi ${paying?.number ?? ''}`} open={!!paying} onCancel={() => setPaying(null)} onOk={() => form.submit()} confirmLoading={pay.isPending} okText="Bayar" destroyOnHidden>
        <p>{paying?.userName} — {fmtMoney(paying?.amount)}. Dibayar dari rekening Bank utama.</p>
        <Form form={form} layout="vertical" onFinish={(v) => pay.mutate({ id: paying!.id, pph21: v.pph21 })}>
          <Form.Item name="pph21" label="PPh 21 yang dipotong (opsional)"><InputNumber min={0} prefix="Rp" style={{ width: 220 }} /></Form.Item>
        </Form>
      </Modal>
      <Modal title="Batalkan komisi" open={!!voiding} onCancel={() => setVoiding(null)} onOk={() => voidForm.submit()} confirmLoading={voidIt.isPending} okText="Batalkan" okButtonProps={{ danger: true }} destroyOnHidden>
        <Form form={voidForm} layout="vertical" onFinish={(v) => voidIt.mutate({ id: voiding!.id, reason: v.reason })}>
          <Form.Item name="reason" label="Alasan (tercatat di jejak audit)" rules={[{ required: true, min: 5 }]}><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
