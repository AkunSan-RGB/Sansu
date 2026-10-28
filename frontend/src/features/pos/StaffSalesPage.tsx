import { useQuery } from '@tanstack/react-query';
import { Card, DatePicker, Space, Table, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, qs } from '@/api/client';
import SummaryCards from '@/components/SummaryCards';
import PageHeader from '@/layout/PageHeader';
import { fmtMoney, fmtQty } from '@/lib/format';

interface Row { staffId: string; name: string; lines: number; qty: string; revenue: string }

/** Kinerja petugas layanan (Jasa): jumlah dan nilai layanan yang dikerjakan per petugas pada rentang tanggal; retur dikurangkan */
export default function StaffSalesPage() {
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('month'), dayjs()]);
  const from = range[0].format('YYYY-MM-DD');
  const to = range[1].format('YYYY-MM-DD');
  const q = useQuery({ queryKey: ['pos-staff-sales', from, to], queryFn: () => get<Row[]>(`/pos/staff-sales${qs({ from, to })}`) });
  const rows = q.data ?? [];
  const total = rows.reduce((a, r) => a + Number(r.revenue), 0);
  return (
    <>
      <PageHeader title="Kinerja petugas" />
      <Typography.Paragraph type="secondary">
        Layanan di Kasir yang diberi petugas. Nilai sudah dikurangi retur; barang bonus tidak dihitung. Dasar yang adil untuk komisi atau penilaian, bukan pengganti slip gaji.
      </Typography.Paragraph>
      <SummaryCards
        items={[
          { label: 'Petugas', value: String(rows.length), hint: 'yang mengerjakan layanan pada rentang ini' },
          { label: 'Nilai layanan', value: fmtMoney(total), hint: 'sebelum pajak dan setelah retur', tone: total > 0 ? 'good' : 'neutral' },
        ]}
      />
      <Card>
        <Space style={{ marginBottom: 12 }} wrap>
          <DatePicker.RangePicker value={range} allowClear={false} onChange={(v) => v?.[0] && v[1] && setRange([v[0], v[1]])} />
        </Space>
        <Table<Row>
          rowKey="staffId"
          size="small"
          loading={q.isLoading}
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: 'Belum ada layanan dengan petugas pada rentang ini' }}
          columns={[
            { title: 'Petugas', dataIndex: 'name' },
            { title: 'Transaksi', dataIndex: 'lines', align: 'right' },
            { title: 'Jumlah layanan', dataIndex: 'qty', align: 'right', render: (v: string) => fmtQty(v) },
            { title: 'Nilai', dataIndex: 'revenue', align: 'right', render: (v: string) => <b>{fmtMoney(v)}</b> },
            { title: 'Porsi', align: 'right', render: (_, r) => (total > 0 ? `${Math.round((Number(r.revenue) / total) * 100)}%` : '-') },
          ]}
        />
      </Card>
    </>
  );
}
