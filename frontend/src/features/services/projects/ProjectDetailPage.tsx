import { ArrowLeftOutlined, FileAddOutlined } from '@ant-design/icons';
import type { CustomerDeposit, Invoice, Project } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Descriptions, Form, Input, InputNumber, Modal, Progress, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, patch } from '@/api/client';
import { useCan } from '@/auth/useCan';
import { useAction } from '@/api/queries';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney } from '@/lib/format';
import { InvoiceStatusTag } from '../../sales/status';
import { t } from '@/lib/terms';
import { ProjectDetail, STATUS } from './shared';
import { ProgressCard } from './ProgressCard';
import { CostsCard } from './CostsCard';

export function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['projects', id], queryFn: () => get<ProjectDetail>(`/services/projects/${id}`) });
  const can = useCan();
  const [edit, setEdit] = useState(false);
  const [form] = Form.useForm();
  const save = useAction(
    (v: { contractValue: number; costBudget?: number; status: Project['status']; endDate?: string; notes?: string }) =>
      patch(`/services/projects/${id}`, {
        ...v,
        contractValue: String(v.contractValue),
        costBudget: String(v.costBudget ?? 0),
        endDate: v.endDate || undefined,
      }),
    {
      success: 'Proyek diperbarui',
      invalidate: ['projects'],
      onSuccess: () => setEdit(false),
    },
  );
  const p = q.data;
  return (
    <>
      <PageHeader
        title={
          <Space>
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate('/projects')}
              aria-label="Kembali"
            />
            {p ? `${p.code} · ${p.name}` : 'Proyek'}
            {p && <Tag color={STATUS[p.status].color}>{STATUS[p.status].label}</Tag>}
          </Space>
        }
        extra={
          p && (
            <Space wrap>
              {can('PATCH', '/services/projects/:id') && (
              <Button
                onClick={() => {
                  form.setFieldsValue({
                    contractValue: Number(p.contractValue),
                    costBudget: Number(p.costBudget),
                    status: p.status,
                    endDate: p.endDate ?? undefined,
                    notes: p.notes ?? undefined,
                  });
                  setEdit(true);
                }}
              >
                Ubah / addendum
              </Button>
              )}
              {can('POST', '/services/deposits') && (
              <Button onClick={() => navigate(`/customer-deposits?customerId=${p.customerId}&projectId=${p.id}`)}>
                Terima uang muka
              </Button>
              )}
              {can('POST', '/services/invoices') && (
              <Button
                type="primary"
                icon={<FileAddOutlined />}
                disabled={p.status !== 'ACTIVE'}
                onClick={() => navigate(`/invoices/services/new?projectId=${p.id}`)}
              >
                Tagih termin
              </Button>
              )}
            </Space>
          )
        }
      />
      {p && (
        <>
          <Card style={{ marginBottom: 16 }}>
            <Descriptions column={{ xs: 1, md: 3 }} size="small">
              <Descriptions.Item label={t('Pelanggan')}>{p.customer.name}</Descriptions.Item>
              <Descriptions.Item label="Nilai kontrak (DPP)">{fmtMoney(p.contractValue)}</Descriptions.Item>
              <Descriptions.Item label="Periode">
                {fmtDate(p.startDate)} – {fmtDate(p.endDate)}
              </Descriptions.Item>
              <Descriptions.Item label="Sudah ditagih">
                {fmtMoney(p.billed)} ({p.billedPct}%)
              </Descriptions.Item>
              <Descriptions.Item label="Sisa kontrak">
                {fmtMoney(Number(p.contractValue) - Number(p.billed))}
              </Descriptions.Item>
              <Descriptions.Item label="Piutang belum dibayar">{fmtMoney(p.outstanding)}</Descriptions.Item>
              <Descriptions.Item label="Uang muka diterima">{fmtMoney(p.deposits)}</Descriptions.Item>
              <Descriptions.Item label="Uang muka belum dipakai">{fmtMoney(p.depositsRemaining)}</Descriptions.Item>
              <Descriptions.Item label="Kemajuan pekerjaan">
                {p.progressPct == null ? 'belum dicatat' : `${p.progressPct}% (${fmtDate(p.progressDate)})`}
              </Descriptions.Item>
              <Descriptions.Item
                label={Number(p.accrual) >= 0 ? 'Pendapatan belum ditagih' : 'Pendapatan diterima dimuka'}
              >
                {fmtMoney(Math.abs(Number(p.accrual)))}
              </Descriptions.Item>
              <Descriptions.Item label="Biaya langsung proyek">{fmtMoney(p.directCost)}</Descriptions.Item>
              <Descriptions.Item label="Anggaran biaya">
                {p.budget.status === 'NONE' ? (
                  <Typography.Text type="secondary">belum diatur</Typography.Text>
                ) : (
                  <Space>
                    {fmtMoney(p.costBudget)}
                    <Tag color={p.budget.status === 'OVER' ? 'red' : p.budget.status === 'WARN' ? 'orange' : 'green'}>
                      {p.budget.status === 'OVER' ? 'Melampaui' : `Terpakai ${p.budget.usedPct}%`}
                    </Tag>
                  </Space>
                )}
              </Descriptions.Item>
              {p.notes && <Descriptions.Item label="Catatan">{p.notes}</Descriptions.Item>}
            </Descriptions>
            <Progress percent={p.billedPct} style={{ marginTop: 8 }} />
          </Card>
          <ProgressCard project={p} />
          <CostsCard project={p} />
          <Card title="Tagihan termin" style={{ marginBottom: 16 }}>
            <Table<Invoice>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={p.invoices}
              onRow={(r) => ({ onClick: () => navigate(`/invoices/${r.id}`), style: { cursor: 'pointer' } })}
              columns={[
                { title: t('Faktur'), dataIndex: 'number' },
                { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
                { title: 'Termin', dataIndex: 'termLabel' },
                { title: 'DPP', dataIndex: 'subtotal', align: 'right', render: fmtMoney },
                { title: 'Total', dataIndex: 'total', align: 'right', render: fmtMoney },
                { title: 'Dipotong PPh', dataIndex: 'withholdingAmount', align: 'right', render: fmtMoney },
                {
                  title: 'Sisa',
                  align: 'right',
                  render: (_, r) => fmtMoney(Number(r.total) - Number(r.paidAmount) - Number(r.returnedAmount)),
                },
                { title: 'Status', dataIndex: 'status', render: (s) => <InvoiceStatusTag status={s} /> },
              ]}
            />
          </Card>
          <Card title="Uang muka">
            <Table<CustomerDeposit>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={p.depositList}
              columns={[
                { title: 'No.', dataIndex: 'number' },
                { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
                { title: 'Diterima', dataIndex: 'amount', align: 'right', render: fmtMoney },
                { title: 'Sudah dipakai', dataIndex: 'appliedAmount', align: 'right', render: fmtMoney },
                { title: 'Sisa', dataIndex: 'remaining', align: 'right', render: fmtMoney },
              ]}
            />
          </Card>
        </>
      )}
      <Modal
        title="Ubah proyek"
        open={edit}
        onCancel={() => setEdit(false)}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Form.Item
            name="contractValue"
            label="Nilai kontrak (DPP)"
            extra="Ubah bila ada addendum (pekerjaan tambah/kurang)"
            rules={[{ required: true }]}
          >
            <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
          </Form.Item>
          <Form.Item name="costBudget" label="Anggaran biaya langsung" extra="Biaya langsung proyek dipantau terhadap angka ini (peringatan di 80%, merah bila melampaui). 0 = tidak dipantau.">
            <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
          </Form.Item>
          <Form.Item name="status" label="Status">
            <Select options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))} />
          </Form.Item>
          <Form.Item name="endDate" label="Target selesai">
            <Input type="date" />
          </Form.Item>
          <Form.Item name="notes" label="Catatan">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
