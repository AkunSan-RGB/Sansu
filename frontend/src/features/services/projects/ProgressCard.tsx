import type { ProjectProgress } from '@sansu/shared';
import { Alert, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Table, Typography } from 'antd';
import { useState } from 'react';
import { post } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { useCan } from '@/auth/useCan';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import { ProjectDetail } from './shared';

/** Kemajuan pekerjaan → pendapatan diakui sesuai % selesai (SAK EP Bab 23) */
export function ProgressCard({ project: p }: { project: ProjectDetail }) {
  const emkm = useAuth().me?.framework === 'SAK_EMKM';
  const can = useCan();
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
        p.status !== 'CANCELLED' && !emkm && can('POST', '/services/projects/:id/progress') && (
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
      {emkm && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="SAK EMKM: pendapatan diakui sebesar tagihan"
          description="Standar EMKM tidak mengenal pengakuan berdasarkan persentase penyelesaian. Tagih pekerjaan per termin lewat faktur proyek; pendapatan tercatat saat ditagih."
        />
      )}
      <Typography.Paragraph type="secondary" hidden={emkm}>
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
