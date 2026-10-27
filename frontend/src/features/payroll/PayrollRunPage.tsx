import { CalculatorOutlined, PrinterOutlined } from '@ant-design/icons';
import { PAYROLL_STATUS_LABELS, BRAND } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Form, Input, InputNumber, Modal, Popconfirm, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, patch, post } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import type { Payslip, PayrollRun } from '@/api/types';
import CashAccountSelect from '@/components/CashAccountSelect';
import ExportButtons from '@/components/ExportButtons';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';
import { printDoc } from '@/lib/print';
import { PAYROLL_COLOR } from './PayrollRunsPage';
import PayslipView from './PayslipView';
import { payrollSheets } from '@/lib/xlsx/reports';
import { useAuth } from '@/auth/AuthContext';

const n = (v: string | number) => Number(v);

export default function PayrollRunPage() {
  const { me } = useAuth();
  const canPostRun = me?.role === 'OWNER' || me?.role === 'ADMIN' || me?.role === 'ACCOUNTANT';
  const canPayRun = me?.role === 'OWNER' || me?.role === 'FINANCE';
  const canEditRun = me?.role === 'OWNER' || me?.role === 'HR';
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Payslip | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [form] = Form.useForm();
  const [payForm] = Form.useForm();
  const { data: run, isLoading } = useQuery({ queryKey: ['payroll', id], queryFn: () => get<PayrollRun>(`/payroll/runs/${id}`) });
  const slip = useQuery({ queryKey: ['payslip', viewing], queryFn: () => get<Payslip>(`/payroll/payslips/${viewing}`), enabled: !!viewing });
  const refresh = ['payroll', 'payslip', ...LEDGER_KEYS];

  const recompute = useAction(() => post(`/payroll/runs/${id}/recompute`), { success: 'Gaji dihitung ulang dari data terbaru', invalidate: refresh });
  const postRun = useAction(() => post(`/payroll/runs/${id}/post`), { success: 'Gaji diposting ke jurnal', invalidate: refresh });
  const remove = useAction(() => post(`/payroll/runs/${id}/delete`), { success: 'Draft dihapus', invalidate: ['payroll'], onSuccess: () => navigate('/payroll') });
  const pay = useAction((v: { cashAccountId?: string; date?: string }) => post<PayrollRun & { paymentJournalNumber: string }>(`/payroll/runs/${id}/pay`, v), {
    success: (r) => `Gaji dibayar · jurnal ${r.paymentJournalNumber}`,
    invalidate: refresh,
    onSuccess: () => setPaying(false),
  });
  const save = useAction(
    (v: { otherIncome?: number; otherDeduction?: number; notes?: string }) =>
      patch(`/payroll/payslips/${editing!.id}`, { otherIncome: String(v.otherIncome ?? 0), otherDeduction: String(v.otherDeduction ?? 0), notes: v.notes }),
    { success: 'Slip diperbarui', invalidate: ['payroll'], onSuccess: () => setEditing(null) },
  );

  const slips = run?.payslips ?? [];
  const sum = (k: keyof Payslip) => slips.reduce((a, p) => a + n(p[k] as string), 0);
  const employer = sum('bpjsKesCompany') + sum('jhtCompany') + sum('jpCompany') + sum('jkkCompany') + sum('jkmCompany');
  const isDraft = run?.status === 'DRAFT';
  const title = run ? `Gaji ${dayjs(`${run.period}-01`).format('MMMM YYYY')}` : 'Gaji';

  return (
    <>
      <PageHeader
        title={title}
        extra={
          run && (
            <Space wrap>
              <Tag color={PAYROLL_COLOR[run.status]}>{PAYROLL_STATUS_LABELS[run.status]}</Tag>
              <ExportButtons
                filename={`gaji-${run.period}`}
                title={title}
                sheets={() => payrollSheets(run, slips, me?.tenantName)}
              />
              {isDraft && (
                <>
                  {canEditRun && (
                    <Button icon={<CalculatorOutlined />} onClick={() => recompute.mutate(undefined)} loading={recompute.isPending}>
                      Hitung ulang
                    </Button>
                  )}
                  {canEditRun && (
                    <Popconfirm title="Hapus draft gaji ini?" onConfirm={() => remove.mutate(undefined)}>
                      <Button danger>Hapus draft</Button>
                    </Popconfirm>
                  )}
                  {canPostRun && (
                    <Popconfirm title="Posting gaji ke jurnal? Slip tidak bisa diubah lagi." onConfirm={() => postRun.mutate(undefined)}>
                      <Button type="primary" loading={postRun.isPending}>
                        Posting
                      </Button>
                    </Popconfirm>
                  )}
                </>
              )}
              {run.status === 'POSTED' && canPayRun && (
                <Button
                  type="primary"
                  onClick={() => {
                    payForm.setFieldsValue({ date: run.payDate, cashAccountId: undefined });
                    setPaying(true);
                  }}
                >
                  Bayar gaji
                </Button>
              )}
            </Space>
          )
        }
      />
      {run && (
        <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
          {[
            ['Karyawan', String(slips.length)],
            ['Total penghasilan (bruto tunai)', fmtMoney(sum('grossPay'))],
            ['BPJS ditanggung perusahaan', fmtMoney(employer)],
            ['PPh 21 dipotong', fmtMoney(sum('pph21'))],
            ['Total gaji bersih (transfer)', fmtMoney(sum('netPay'))],
          ].map(([t, v]) => (
            <Col key={t} xs={12} md={8} xl={4} flex="auto">
              <Card size="small">
                <Statistic title={t} value={v} valueStyle={{ fontSize: 20 }} />
              </Card>
            </Col>
          ))}
        </Row>
      )}
      {isDraft && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Draft: klik baris untuk menambah bonus/kasbon. Jika absensi atau data karyawan berubah, tekan Hitung ulang. Posting membuat jurnal Beban Gaji & BPJS ke Hutang Gaji, Hutang BPJS, dan Hutang PPh 21."
        />
      )}
      <Card loading={isLoading}>
        <Table
          rowKey="id"
          dataSource={slips}
          pagination={false}
          scroll={{ x: 1650 }}
          onRow={(p) => ({ onClick: () => (isDraft ? (form.setFieldsValue({ otherIncome: n(p.otherIncome), otherDeduction: n(p.otherDeduction), notes: p.notes }), setEditing(p)) : setViewing(p.id)), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Karyawan', fixed: 'left', width: 200, render: (_, p) => `${p.employee.code} · ${p.employee.name}` },
            { title: 'Hadir', align: 'right', render: (_, p) => `${p.presentDays}/${p.workDays}` },
            { title: 'Gaji pokok', dataIndex: 'baseSalary', align: 'right', width: 120, render: fmtMoney },
            { title: 'Tunjangan', dataIndex: 'fixedAllowance', align: 'right', width: 120, render: fmtMoney },
            { title: 'Uang makan', dataIndex: 'dailyAllowance', align: 'right', render: fmtMoney },
            { title: 'Lembur', dataIndex: 'overtimePay', align: 'right', render: fmtMoney },
            { title: 'Bonus', dataIndex: 'otherIncome', align: 'right', render: fmtMoney },
            ...(slips.some((p) => n(p.serviceIncome) > 0) ? [{ title: 'Upah jasa', dataIndex: 'serviceIncome', align: 'right' as const, render: fmtMoney }] : []),
            { title: 'Pot. absen', dataIndex: 'absenceDeduction', align: 'right', render: fmtMoney },
            { title: 'Bruto', dataIndex: 'grossPay', align: 'right', render: (v) => <strong>{fmtMoney(v)}</strong> },
            { title: 'BPJS pegawai', align: 'right', render: (_, p) => fmtMoney(n(p.bpjsKesEmployee) + n(p.jhtEmployee) + n(p.jpEmployee)) },
            {
              title: 'PPh 21',
              align: 'right',
              render: (_, p) => (
                <span title={p.terCategory.endsWith('*') ? 'Perhitungan tahunan' : `TER ${p.terCategory} ${Number(p.terRate)}%`}>{fmtMoney(p.pph21)}</span>
              ),
            },
            { title: 'Kasbon', dataIndex: 'otherDeduction', align: 'right', render: fmtMoney },
            { title: 'Gaji bersih', dataIndex: 'netPay', align: 'right', render: (v) => <Typography.Text strong style={{ color: BRAND.colors.primary }}>{fmtMoney(v)}</Typography.Text> },
            {
              fixed: 'right',
              render: (_, p) => (
                <Button
                  size="small"
                  icon={<PrinterOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewing(p.id);
                  }}
                >
                  Slip
                </Button>
              ),
            },
          ]}
        />
        {run && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
            {run.number} · tanggal gaji {fmtDate(run.payDate)}
            {run.cashAccount && ` · dibayar dari ${run.cashAccount.name}`}
          </Typography.Paragraph>
        )}
      </Card>

      <Modal title={editing && `${editing.employee.name} — tambahan & potongan`} open={!!editing} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={save.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Form.Item name="otherIncome" label="Bonus / insentif / THR bulan ini" extra="Ikut dihitung PPh 21">
            <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
          </Form.Item>
          <Form.Item name="otherDeduction" label="Potongan kasbon / lain-lain" extra="Mengurangi Piutang Karyawan">
            <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
          </Form.Item>
          <Form.Item name="notes" label="Catatan di slip">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={!!viewing}
        onCancel={() => setViewing(null)}
        width={760}
        title="Slip gaji"
        footer={
          <Button icon={<PrinterOutlined />} type="primary" onClick={() => printDoc(`Slip gaji ${slip.data?.employee.name} ${run?.period}`)}>
            Cetak / PDF
          </Button>
        }
      >
        {slip.data && <PayslipView p={slip.data} />}
      </Modal>

      <Modal title="Bayar gaji" open={paying} onCancel={() => setPaying(false)} onOk={() => payForm.submit()} confirmLoading={pay.isPending} okText="Posting pembayaran">
        <Typography.Paragraph>
          Total transfer gaji bersih <strong>{fmtMoney(run?.totalNet)}</strong> ke {slips.length} karyawan.
        </Typography.Paragraph>
        <Form form={payForm} layout="vertical" onFinish={(v) => pay.mutate({ ...v, date: v.date || undefined })}>
          <Form.Item name="cashAccountId" label="Dibayar dari" extra="Kosongkan = Bank utama">
            <CashAccountSelect allowClear />
          </Form.Item>
          <Form.Item name="date" label="Tanggal transfer">
            <Input type="date" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
