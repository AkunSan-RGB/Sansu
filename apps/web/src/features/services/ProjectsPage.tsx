/** Proyek / kontrak jasa: nilai kontrak, penagihan per termin, uang muka, dan sisa piutang */
import { ArrowLeftOutlined, FileAddOutlined, PlusOutlined } from '@ant-design/icons';
import type { CustomerDeposit, Invoice, Project, ProjectCost, ProjectProgress } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, patch, post } from '@/api/client';
import { LEDGER_KEYS, useAction, useCustomers } from '@/api/queries';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import { InvoiceStatusTag } from '../sales/status';
import { t } from '@/lib/terms';

const STATUS: Record<Project['status'], { label: string; color: string }> = {
  ACTIVE: { label: 'Berjalan', color: 'blue' },
  DONE: { label: 'Selesai', color: 'green' },
  CANCELLED: { label: 'Dibatalkan', color: 'default' },
};

export default function ProjectsPage() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['projects'], queryFn: () => get<Project[]>('/services/projects') });
  return (
    <>
      <PageHeader
        title="Proyek & termin"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            Proyek baru
          </Button>
        }
      />
      <Card>
        <Table<Project>
          rowKey="id"
          size="small"
          loading={q.isLoading}
          dataSource={q.data}
          onRow={(r) => ({ onClick: () => navigate(`/projects/${r.id}`), style: { cursor: 'pointer' } })}
          locale={{ emptyText: 'Belum ada proyek. Buat proyek untuk kontrak yang ditagih bertahap (termin).' }}
          columns={[
            { title: 'Kode', dataIndex: 'code' },
            { title: 'Proyek', dataIndex: 'name' },
            { title: t('Pelanggan'), render: (_, r) => r.customer.name },
            { title: 'Nilai kontrak', dataIndex: 'contractValue', align: 'right', render: fmtMoney },
            {
              title: 'Ditagih',
              width: 180,
              render: (_, r) => <Progress percent={r.billedPct} size="small" format={() => fmtMoney(r.billed)} />,
            },
            { title: 'Uang muka tersisa', dataIndex: 'depositsRemaining', align: 'right', render: fmtMoney },
            { title: 'Piutang', dataIndex: 'outstanding', align: 'right', render: fmtMoney },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (s: Project['status']) => <Tag color={STATUS[s].color}>{STATUS[s].label}</Tag>,
            },
          ]}
        />
      </Card>
      <ProjectModal open={open} onClose={() => setOpen(false)} onDone={(p) => navigate(`/projects/${p.id}`)} />
    </>
  );
}

function ProjectModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (p: Project) => void }) {
  const [form] = Form.useForm();
  const { data: customers } = useCustomers();
  const save = useAction(
    (v: {
      name: string;
      customerId: string;
      contractValue: number;
      code?: string;
      startDate?: string;
      endDate?: string;
      notes?: string;
    }) =>
      post<Project>('/services/projects', {
        ...v,
        contractValue: String(v.contractValue),
        startDate: v.startDate || undefined,
        endDate: v.endDate || undefined,
      }),
    {
      success: (p) => `Proyek ${p.code} dibuat`,
      invalidate: ['projects'],
      onSuccess: (p) => {
        onClose();
        onDone(p);
      },
    },
  );
  return (
    <Modal
      title="Proyek / kontrak baru"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={save.isPending}
      okText="Simpan"
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)} preserve={false}>
        <Form.Item name="name" label="Nama proyek / pekerjaan" rules={[{ required: true, min: 3 }]}>
          <Input placeholder="Mis. Renovasi gudang PT Maju Jaya" />
        </Form.Item>
        <Form.Item name="customerId" label="Pelanggan (pemberi kerja)" rules={[{ required: true }]}>
          <Select
            showSearch
            optionFilterProp="label"
            options={customers?.filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
          />
        </Form.Item>
        <Form.Item name="contractValue" label="Nilai kontrak (DPP, belum PPN)" rules={[{ required: true }]}>
          <InputNumber min={0} style={{ width: '100%' }} prefix="Rp" />
        </Form.Item>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="startDate" label="Mulai">
              <Input type="date" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="endDate" label="Target selesai">
              <Input type="date" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="code" label="Kode" extra="Kosong = nomor otomatis">
          <Input placeholder="Mis. SPK-012" />
        </Form.Item>
        <Form.Item name="notes" label="Catatan">
          <Input.TextArea rows={2} placeholder="No. SPK / kontrak, termin pembayaran yang disepakati" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

type ProjectDetail = Project & {
  invoices: Invoice[];
  depositList: CustomerDeposit[];
  progress: ProjectProgress[];
  costs: ProjectCost[];
};

export function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['projects', id], queryFn: () => get<ProjectDetail>(`/services/projects/${id}`) });
  const [edit, setEdit] = useState(false);
  const [form] = Form.useForm();
  const save = useAction(
    (v: { contractValue: number; status: Project['status']; endDate?: string; notes?: string }) =>
      patch(`/services/projects/${id}`, {
        ...v,
        contractValue: String(v.contractValue),
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
              <Button
                onClick={() => {
                  form.setFieldsValue({
                    contractValue: Number(p.contractValue),
                    status: p.status,
                    endDate: p.endDate ?? undefined,
                    notes: p.notes ?? undefined,
                  });
                  setEdit(true);
                }}
              >
                Ubah / addendum
              </Button>
              <Button onClick={() => navigate(`/customer-deposits?customerId=${p.customerId}&projectId=${p.id}`)}>
                Terima uang muka
              </Button>
              <Button
                type="primary"
                icon={<FileAddOutlined />}
                disabled={p.status !== 'ACTIVE'}
                onClick={() => navigate(`/invoices/services/new?projectId=${p.id}`)}
              >
                Tagih termin
              </Button>
            </Space>
          )
        }
      />
      {p && (
        <>
          <Card style={{ marginBottom: 16 }}>
            <Descriptions column={{ xs: 1, md: 3 }} size="small">
              <Descriptions.Item label="Pelanggan">{p.customer.name}</Descriptions.Item>
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

/** Kemajuan pekerjaan → pendapatan diakui sesuai % selesai (SAK EP Bab 23) */
function ProgressCard({ project: p }: { project: ProjectDetail }) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ date: string; percent: number; notes?: string }>();
  const pct = Form.useWatch('percent', form);
  const date = Form.useWatch('date', form);
  const billed = p.invoices.filter((i) => !date || i.date <= date).reduce((a, i) => a + Number(i.subtotal), 0);
  const earned = pct != null ? Math.round(Number(p.contractValue) * pct) / 100 : null;
  const target = earned != null ? earned - billed : null;
  const save = useAction(
    (v: { date: string; percent: number; notes?: string }) =>
      post<ProjectProgress & { journalNumber: string | null }>(`/services/projects/${p.id}/progress`, {
        ...v,
        percent: String(v.percent),
      }),
    {
      success: (r) =>
        r.journalNumber
          ? `Kemajuan ${Number(r.percent)}% dicatat · jurnal ${r.journalNumber}`
          : `Kemajuan ${Number(r.percent)}% dicatat (tidak ada selisih)`,
      invalidate: ['projects', ...LEDGER_KEYS],
      onSuccess: () => setOpen(false),
    },
  );
  return (
    <Card
      title="Kemajuan pekerjaan & pengakuan pendapatan"
      style={{ marginBottom: 16 }}
      extra={
        p.status !== 'CANCELLED' && (
          <Button
            onClick={() => {
              form.setFieldsValue({ date: today(), percent: p.progressPct ?? undefined, notes: undefined });
              setOpen(true);
            }}
          >
            Catat kemajuan
          </Button>
        )
      }
    >
      <Typography.Paragraph type="secondary">
        Pendapatan jasa diakui sesuai persentase pekerjaan yang sudah selesai (SAK EP Bab 23), bukan sekadar saat
        ditagih. Catat % selesai tiap akhir bulan dari berita acara / opname lapangan: bila pekerjaan lebih maju dari
        tagihan, selisihnya dicatat sebagai Pendapatan Belum Ditagih; bila tagihan lebih dulu, sebagai Pendapatan
        Diterima Dimuka.
      </Typography.Paragraph>
      <Table<ProjectProgress>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={p.progress}
        locale={{ emptyText: 'Belum ada catatan kemajuan' }}
        columns={[
          { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
          { title: '% selesai', dataIndex: 'percent', align: 'right', render: (v) => `${Number(v)}%` },
          { title: 'Pendapatan dihasilkan', dataIndex: 'earned', align: 'right', render: fmtMoney },
          { title: 'Sudah ditagih', dataIndex: 'billed', align: 'right', render: fmtMoney },
          {
            title: 'Posisi',
            dataIndex: 'accrualAfter',
            align: 'right',
            render: (v: string) =>
              Number(v) >= 0 ? `Belum ditagih ${fmtMoney(v)}` : `Diterima dimuka ${fmtMoney(-Number(v))}`,
          },
          { title: 'Jurnal penyesuaian', dataIndex: 'adjustment', align: 'right', render: fmtMoney },
          { title: 'Dasar', dataIndex: 'notes' },
        ]}
      />
      <Modal
        title="Catat kemajuan pekerjaan"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
        okText="Posting"
      >
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Form.Item name="date" label="Per tanggal" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="percent" label="Pekerjaan selesai" rules={[{ required: true }]}>
            <InputNumber min={0} max={100} suffix="%" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="notes" label="Dasar penilaian">
            <Input placeholder="Mis. BA kemajuan No. 03 / opname lapangan 31 Okt" />
          </Form.Item>
          {earned != null && target != null && (
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Pendapatan dihasilkan">{fmtMoney(earned)}</Descriptions.Item>
              <Descriptions.Item label="Sudah ditagih (DPP)">{fmtMoney(billed)}</Descriptions.Item>
              <Descriptions.Item label={target >= 0 ? 'Pendapatan belum ditagih' : 'Pendapatan diterima dimuka'}>
                {fmtMoney(Math.abs(target))}
              </Descriptions.Item>
              <Descriptions.Item label="Jurnal penyesuaian">{fmtMoney(target - Number(p.accrual))}</Descriptions.Item>
            </Descriptions>
          )}
        </Form>
      </Modal>
    </Card>
  );
}

const COST_SOURCE: Record<ProjectCost['source'], { label: string; color: string }> = {
  BILL: { label: 'Tagihan biaya', color: 'blue' },
  CASH: { label: 'Kas keluar', color: 'gold' },
  PAYROLL: { label: 'Gaji', color: 'purple' },
  JOURNAL: { label: 'Jurnal umum', color: 'cyan' },
};

/** Biaya langsung & margin proyek */
function CostsCard({ project: p }: { project: ProjectDetail }) {
  const last = p.progress[p.progress.length - 1];
  const revenue = last
    ? Number(last.earned) + p.invoices.filter((i) => i.date > last.date).reduce((a, i) => a + Number(i.subtotal), 0)
    : Number(p.billed);
  const cost = Number(p.directCost);
  const margin = revenue - cost;
  return (
    <Card
      title="Biaya langsung & margin proyek"
      style={{ marginBottom: 16 }}
      extra={
        <Space size="large">
          <span>Pendapatan diakui {fmtMoney(revenue)}</span>
          <span>Biaya {fmtMoney(cost)}</span>
          <b style={{ color: margin < 0 ? '#dc2626' : undefined }}>
            Margin {fmtMoney(margin)}
            {revenue > 0 && ` (${Math.round((margin / revenue) * 1000) / 10}%)`}
          </b>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">
        Dari tagihan biaya, kas keluar, jurnal umum, dan gaji karyawan yang ditempatkan di proyek ini. Pilih proyeknya saat mencatat
        biaya agar laba proyek dan koreksi pajak (pendapatan PPh final) tepat.
      </Typography.Paragraph>
      <Table<ProjectCost>
        rowKey={(r) => `${r.source}-${r.docId}-${r.account}-${r.description}-${r.amount}`}
        size="small"
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        dataSource={p.costs}
        locale={{ emptyText: 'Belum ada biaya yang ditandai untuk proyek ini' }}
        columns={[
          { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
          {
            title: 'Sumber',
            dataIndex: 'source',
            render: (s: ProjectCost['source']) => <Tag color={COST_SOURCE[s].color}>{COST_SOURCE[s].label}</Tag>,
          },
          { title: 'No.', dataIndex: 'number' },
          { title: 'Uraian', dataIndex: 'description' },
          { title: 'Akun', dataIndex: 'account' },
          { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: fmtMoney },
        ]}
      />
    </Card>
  );
}
