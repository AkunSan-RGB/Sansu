import type { ProjectCost } from '@sansu/shared';
import { Card, Space, Table, Tag, Typography } from 'antd';
import { fmtDate, fmtMoney } from '@/lib/format';
import { ProjectDetail } from './shared';

const COST_SOURCE: Record<ProjectCost['source'], { label: string; color: string }> = {
  BILL: { label: 'Tagihan biaya', color: 'blue' },
  CASH: { label: 'Kas keluar', color: 'gold' },
  PAYROLL: { label: 'Gaji', color: 'purple' },
  JOURNAL: { label: 'Jurnal umum', color: 'cyan' },
};

/** Biaya langsung & margin proyek */
export function CostsCard({ project: p }: { project: ProjectDetail }) {
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
