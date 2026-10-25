import { UTILITY_CONNECTION_LABELS, UTILITY_READING_LABELS } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Descriptions, Drawer, Empty, Table, Tag, Typography } from 'antd';
import { get } from '@/api/client';
import { fmtDate, fmtMoney } from '@/lib/format';
import { Connection, READ_COLOR, Reading, STATUS_COLOR } from './shared';

export function ConnectionDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['utility', 'connection', id],
    queryFn: () => get<Connection & { readings: Reading[]; bills: { id: string; period: string; usage: string | null; total: string; paidAmount: string; invoiceNumber: string | null; status: string | null; dueDate: string | null; lateFee: string }[] }>(`/utility/connections/${id}`),
    enabled: !!id,
  });
  return (
    <Drawer open={!!id} onClose={onClose} width={Math.min(720, window.innerWidth)} title={data ? `Sambungan ${data.number}` : 'Sambungan'}>
      {!data ? null : (
        <>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="Pelanggan">{data.customerName}</Descriptions.Item>
            <Descriptions.Item label="Alamat">{data.address}</Descriptions.Item>
            <Descriptions.Item label="Layanan">{data.tariffName}{data.meterNo ? ` · meter ${data.meterNo}` : ''}</Descriptions.Item>
            <Descriptions.Item label="Dipasang">{fmtDate(data.installedAt)}</Descriptions.Item>
            <Descriptions.Item label="Status"><Tag color={STATUS_COLOR[data.status]}>{UTILITY_CONNECTION_LABELS[data.status]}</Tag>{data.statusNote}</Descriptions.Item>
          </Descriptions>
          <Typography.Title level={5} style={{ marginTop: 16 }}>Tagihan</Typography.Title>
          <Table size="small" rowKey="id" pagination={false} dataSource={data.bills} locale={{ emptyText: <Empty description="Belum ada tagihan" /> }}
            columns={[
              { title: 'Periode', dataIndex: 'period' },
              { title: 'Pemakaian', dataIndex: 'usage', render: (v: string | null) => (v == null ? '-' : Number(v)) },
              { title: 'Faktur', dataIndex: 'invoiceNumber', render: (v: string | null) => v ?? 'tertahan' },
              { title: 'Total', align: 'right', dataIndex: 'total', render: (v: string | null) => fmtMoney(v) },
              { title: 'Sisa', align: 'right', render: (_: unknown, b: { total: string; paidAmount: string }) => fmtMoney(Number(b.total) - Number(b.paidAmount)) },
              { title: 'Jatuh tempo', dataIndex: 'dueDate', render: (v: string | null) => fmtDate(v) },
            ]}
          />
          <Typography.Title level={5} style={{ marginTop: 16 }}>Riwayat meter</Typography.Title>
          <Table size="small" rowKey="id" pagination={false} dataSource={data.readings}
            columns={[
              { title: 'Periode', dataIndex: 'period' },
              { title: 'Awal → akhir', render: (_: unknown, r: Reading) => `${Number(r.previous)} → ${Number(r.current)}` },
              { title: 'Pakai', dataIndex: 'usage', render: (v: string) => Number(v) },
              { title: 'Status', render: (_: unknown, r: Reading) => <Tag color={READ_COLOR[r.status]}>{UTILITY_READING_LABELS[r.status]}</Tag> },
              { title: 'Dicatat → diverifikasi', render: (_: unknown, r: Reading) => `${r.enteredByName ?? '-'}${r.verifiedByName ? ` → ${r.verifiedByName}` : ''}` },
            ]}
          />
        </>
      )}
    </Drawer>
  );
}
