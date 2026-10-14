import { PhoneOutlined, PlusOutlined, WhatsAppOutlined } from '@ant-design/icons';
import { ACTIVITY_TYPE_LABELS, BRAND, LEAD_STATUS_LABELS } from '@sansu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Empty, Form, Modal, Segmented, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, patch, post, qs } from '@/api/client';
import { useAction } from '@/api/queries';
import type { CrmActivity, CrmStage, Lead } from '@/api/types';
import SummaryCards from '@/components/SummaryCards';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import LeadDrawer, { LEAD_STATUS_COLOR, LeadForm, waLink } from './LeadDrawer';
import { t } from '@/lib/terms';

interface Summary {
  stages: { id: string; name: string; count: number; value: string; weighted: string }[];
  won90: number;
  lost90: number;
  wonValue90: string;
  winRate90: number;
}

function LeadCard({ lead, onOpen }: { lead: Lead; onOpen: () => void }) {
  const next = lead.activities?.[0];
  return (
    <Card
      size="small"
      hoverable
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/lead', lead.id)}
      onClick={onOpen}
      style={{ marginBottom: 8, cursor: 'grab' }}
      styles={{ body: { padding: 10 } }}
    >
      <Typography.Text strong style={{ display: 'block' }}>
        {lead.title}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {lead.customer?.name ?? lead.companyName ?? lead.contactName ?? '-'}
      </Typography.Text>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
        <Typography.Text style={{ color: BRAND.colors.primary, fontWeight: 600 }}>{fmtMoney(lead.expectedRevenue)}</Typography.Text>
        <Space size={4}>
          {lead.phone && (
            <a href={waLink(lead.phone)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} aria-label="WhatsApp">
              <WhatsAppOutlined />
            </a>
          )}
          <Tag style={{ marginInlineEnd: 0 }}>{lead.probability}%</Tag>
        </Space>
      </div>
      {next && (
        <Typography.Text type={next.dueDate < today() ? 'danger' : 'secondary'} style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
          {ACTIVITY_TYPE_LABELS[next.type]}: {next.summary} · {fmtDate(next.dueDate)}
        </Typography.Text>
      )}
      {lead.owner && (
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {lead.owner.name}
        </Typography.Text>
      )}
    </Card>
  );
}

export default function PipelinePage() {
  const qc = useQueryClient();
  const [mine, setMine] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('OPEN');
  const [form] = Form.useForm();

  const pipeline = useQuery({ queryKey: ['crm-pipeline', mine], queryFn: () => get<{ stages: CrmStage[]; leads: Lead[] }>(`/crm/pipeline${qs({ mine: mine ? '1' : undefined })}`) });
  const summary = useQuery({ queryKey: ['crm-summary'], queryFn: () => get<Summary>('/crm/summary') });
  const agenda = useQuery({ queryKey: ['crm-agenda'], queryFn: () => get<CrmActivity[]>('/crm/agenda') });
  const leads = useQuery({ queryKey: ['crm-leads', status], queryFn: () => get<Lead[]>(`/crm/leads${qs({ status })}`) });
  const stages = pipeline.data?.stages ?? [];

  const move = useAction((v: { id: string; stageId: string }) => patch(`/crm/leads/${v.id}`, { stageId: v.stageId }), {
    invalidate: ['crm-pipeline', 'crm-summary'],
  });
  const create = useAction(
    (v: Record<string, unknown>) =>
      post<Lead>('/crm/leads', { ...v, expectedRevenue: v.expectedRevenue != null ? String(v.expectedRevenue) : undefined, expectedCloseDate: v.expectedCloseDate || undefined }),
    { success: 'Prospek ditambahkan', invalidate: ['crm-pipeline', 'crm-summary', 'crm-leads'], onSuccess: () => setCreating(null) },
  );
  const done = useAction((id: string) => post(`/crm/activities/${id}/done`, {}), { invalidate: ['crm-agenda', 'crm-pipeline'] });

  const totalOpen = summary.data?.stages.reduce((a, s) => a + Number(s.value), 0) ?? 0;
  const weighted = summary.data?.stages.reduce((a, s) => a + Number(s.weighted), 0) ?? 0;
  const overdue = agenda.data?.filter((a) => a.dueDate < today()).length ?? 0;

  const newLead = (stageId?: string) => {
    form.resetFields();
    form.setFieldsValue({ stageId: stageId ?? stages[0]?.id });
    setCreating(stageId ?? stages[0]?.id ?? 'new');
  };

  return (
    <>
      <PageHeader
        title="CRM"
        extra={
          <Space wrap>
            <Segmented
              value={mine ? 'mine' : 'all'}
              onChange={(v) => setMine(v === 'mine')}
              options={[
                { value: 'all', label: 'Semua' },
                { value: 'mine', label: 'Milik saya' },
              ]}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => newLead()}>
              Prospek baru
            </Button>
          </Space>
        }
      />
      <SummaryCards
        items={[
          { label: 'Nilai pipeline', value: fmtMoney(totalOpen), hint: 'semua peluang yang masih berjalan' },
          { label: 'Perkiraan yang akan masuk', value: fmtMoney(weighted), hint: 'sudah dikalikan peluang berhasil' },
          { label: 'Menang 90 hari terakhir', value: fmtMoney(summary.data?.wonValue90), hint: `${summary.data?.won90 ?? 0} kesepakatan`, tone: 'good' },
          { label: 'Rasio menang 90 hari', value: `${summary.data?.winRate90 ?? 0}%`, hint: `${summary.data?.lost90 ?? 0} gagal` },
        ]}
      />

      <Tabs
        items={[
          {
            key: 'kanban',
            label: 'Pipeline',
            children: (
              <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
                {stages.map((s) => {
                  const cards = pipeline.data?.leads.filter((l) => l.stageId === s.id) ?? [];
                  const sum = cards.reduce((a, l) => a + Number(l.expectedRevenue), 0);
                  return (
                    <div
                      key={s.id}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setOver(s.id);
                      }}
                      onDragLeave={() => setOver(null)}
                      onDrop={(e) => {
                        const id = e.dataTransfer.getData('text/lead');
                        setOver(null);
                        const lead = pipeline.data?.leads.find((l) => l.id === id);
                        if (lead && lead.stageId !== s.id) {
                          // geser langsung di layar, simpan di belakang
                          qc.setQueryData(['crm-pipeline', mine], (d: { stages: CrmStage[]; leads: Lead[] } | undefined) =>
                            d && { ...d, leads: d.leads.map((l) => (l.id === id ? { ...l, stageId: s.id, probability: s.probability } : l)) },
                          );
                          move.mutate({ id, stageId: s.id });
                        }
                      }}
                      style={{
                        flex: '0 0 280px',
                        background: over === s.id ? '#e6ecf7' : '#f3f5f9',
                        borderRadius: 10,
                        padding: 10,
                        minHeight: 300,
                        transition: 'background .15s',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <Space size={6}>
                          <Typography.Text strong>{s.name}</Typography.Text>
                          <Badge count={cards.length} showZero color="#94a3b8" />
                        </Space>
                        <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => newLead(s.id)} aria-label="Tambah prospek" />
                      </div>
                      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                        {fmtMoney(sum)} · peluang {s.probability}%
                      </Typography.Text>
                      {cards.map((l) => (
                        <LeadCard key={l.id} lead={l} onOpen={() => setOpenId(l.id)} />
                      ))}
                      {!cards.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Seret prospek ke sini" />}
                    </div>
                  );
                })}
              </div>
            ),
          },
          {
            key: 'agenda',
            label: (
              <Badge count={overdue} size="small" offset={[8, -2]}>
                Agenda follow-up
              </Badge>
            ),
            children: (
              <Card>
                <Table
                  rowKey="id"
                  loading={agenda.isLoading}
                  dataSource={agenda.data}
                  pagination={false}
                  scroll={{ x: 800 }}
                  locale={{ emptyText: 'Tidak ada aktivitas 7 hari ke depan' }}
                  columns={[
                    { title: 'Tanggal', dataIndex: 'dueDate', render: (d) => <Typography.Text type={d < today() ? 'danger' : undefined}>{fmtDate(d)}</Typography.Text> },
                    { title: 'Jenis', dataIndex: 'type', render: (t: keyof typeof ACTIVITY_TYPE_LABELS) => <Tag>{ACTIVITY_TYPE_LABELS[t]}</Tag> },
                    { title: 'Rencana', dataIndex: 'summary' },
                    { title: 'Prospek', render: (_, a) => <a onClick={() => setOpenId(a.lead!.id)}>{a.lead?.title}</a> },
                    {
                      title: 'Kontak',
                      render: (_, a) =>
                        a.lead?.phone && (
                          <Space>
                            <a href={`tel:${a.lead.phone}`} aria-label="Telepon">
                              <PhoneOutlined />
                            </a>
                            <a href={waLink(a.lead.phone)} target="_blank" rel="noreferrer" aria-label="WhatsApp">
                              <WhatsAppOutlined />
                            </a>
                            {a.lead.contactName}
                          </Space>
                        ),
                    },
                    { title: 'Sales', render: (_, a) => a.user?.name },
                    { render: (_, a) => <Button size="small" onClick={() => done.mutate(a.id)}>Selesai</Button> },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'list',
            label: 'Semua prospek',
            children: (
              <Card>
                <Select
                  value={status}
                  onChange={setStatus}
                  style={{ width: 180, marginBottom: 12 }}
                  options={Object.entries(LEAD_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
                />
                <Table
                  rowKey="id"
                  loading={leads.isLoading}
                  dataSource={leads.data}
                  scroll={{ x: 900 }}
                  onRow={(l) => ({ onClick: () => setOpenId(l.id), style: { cursor: 'pointer' } })}
                  columns={[
                    { title: 'Prospek', dataIndex: 'title' },
                    { title: t('Pelanggan'), render: (_, l) => l.customer?.name ?? l.companyName ?? '-' },
                    { title: 'Tahap', render: (_, l) => l.stage?.name },
                    { title: 'Nilai', dataIndex: 'expectedRevenue', align: 'right', render: fmtMoney },
                    { title: 'Status', dataIndex: 'status', render: (s: Lead['status']) => <Tag color={LEAD_STATUS_COLOR[s]}>{LEAD_STATUS_LABELS[s]}</Tag> },
                    { title: 'Alasan kalah', dataIndex: 'lostReason' },
                    { title: 'Sales', render: (_, l) => l.owner?.name },
                    { title: 'Dibuat', dataIndex: 'createdAt', render: fmtDate },
                  ]}
                />
              </Card>
            ),
          },
        ]}
      />

      <LeadDrawer leadId={openId} stages={stages} onClose={() => setOpenId(null)} />
      <Modal title="Prospek baru" open={!!creating} onCancel={() => setCreating(null)} onOk={() => form.submit()} confirmLoading={create.isPending} okText="Simpan" width={640}>
        <LeadForm form={form} stages={stages} onFinish={(v) => create.mutate(v)} />
      </Modal>
    </>
  );
}
