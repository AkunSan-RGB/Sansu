import { Alert, Button, Card, Form, Input, Modal, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import { ProjectDetail } from './shared';

interface RetentionView {
  retentionPct: string;
  retentionDays: number;
  held: string;
  invoices: { invoiceId: string; number: string; parentNumber: string | null; date: string; dueDate: string; total: string; outstanding: string }[];
}

/** Retensi kontraktor: bagian tiap termin yang ditahan pelanggan sampai masa pemeliharaan selesai (tagihan terpisah, jatuh tempo kemudian) */
export function RetentionCard({ project: p }: { project: ProjectDetail }) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ dueDate: string; reason: string }>();
  const enabled = Number(p.retentionPct) > 0;
  const q = useQuery({ queryKey: ['projects', p.id, 'retention'], queryFn: () => get<RetentionView>(`/services/projects/${p.id}/retention`), enabled });
  const release = useAction((v: { dueDate: string; reason: string }) => post(`/services/projects/${p.id}/retention/release`, v), {
    success: 'Retensi dicairkan: jatuh tempo diubah',
    invalidate: ['projects', 'invoices'],
    onSuccess: () => setOpen(false),
  });
  if (!enabled && !(q.data?.invoices.length ?? 0)) return null;
  const held = Number(q.data?.held ?? p.retentionHeld);
  return (
    <Card
      title={`Retensi ${Number(p.retentionPct)}%`}
      style={{ marginBottom: 16 }}
      extra={can('POST', '/services/projects/:id/retention/release') && held > 0 && <Button onClick={() => { form.setFieldsValue({ dueDate: today(), reason: '' }); setOpen(true); }}>Cairkan retensi</Button>}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={`Ditahan pelanggan: ${fmtMoney(held)}`}
        description={`Tiap tagihan termin dipecah: bagian ${Number(p.retentionPct)}% menjadi tagihan retensi tersendiri yang jatuh tempo ${p.retentionDays} hari kemudian. Setelah serah terima akhir, klik Cairkan retensi untuk memajukan jatuh tempo, lalu tagih seperti faktur biasa. Pendapatan dan PPN tetap diakui saat termin ditagih.`}
      />
      <Table
        rowKey="invoiceId"
        size="small"
        pagination={false}
        loading={q.isLoading}
        dataSource={q.data?.invoices ?? []}
        locale={{ emptyText: 'Belum ada tagihan retensi (terbentuk otomatis saat menagih termin)' }}
        columns={[
          { title: 'Faktur retensi', dataIndex: 'number' },
          { title: 'Dari termin', dataIndex: 'parentNumber', render: (v: string | null) => v ?? '-' },
          { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
          { title: 'Jatuh tempo', dataIndex: 'dueDate', render: (v: string) => <span>{fmtDate(v)} {v < today() && <Tag color="red">lewat</Tag>}</span> },
          { title: 'Jumlah', dataIndex: 'total', align: 'right', render: fmtMoney },
          { title: 'Sisa', dataIndex: 'outstanding', align: 'right', render: (v: string) => (Number(v) > 0 ? <b>{fmtMoney(v)}</b> : <Tag color="green">lunas</Tag>) },
        ]}
      />
      <Modal title="Cairkan retensi" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={release.isPending} okText="Cairkan" destroyOnHidden>
        <Typography.Paragraph type="secondary">Jatuh tempo semua tagihan retensi yang belum lunas diubah ke tanggal di bawah. Dasarnya tercatat di jejak audit.</Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={(v) => release.mutate(v)}>
          <Form.Item name="dueDate" label="Jatuh tempo baru" rules={[{ required: true }]}><Input type="date" /></Form.Item>
          <Form.Item name="reason" label="Dasar pencairan" rules={[{ required: true, min: 5 }]} extra="Mis. nomor BA serah terima akhir (FHO)"><Input maxLength={255} /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
