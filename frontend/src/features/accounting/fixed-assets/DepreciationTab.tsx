import { PlayCircleOutlined } from '@ant-design/icons';
import { canBookkeep } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Col, Input, InputNumber, Row, Space, Table, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { fmtMoney } from '@/lib/format';
import { Amount } from '../statements/format';
import { useAuth } from '@/auth/AuthContext';
import { KEYS } from './shared';

export function DepreciationTab() {
  const bookkeeper = canBookkeep(useAuth().me?.role);
  const [period, setPeriod] = useState(dayjs().subtract(dayjs().date() < 25 ? 1 : 0, 'month').format('YYYY-MM'));
  const [year, setYear] = useState(dayjs().year());
  const runs = useQuery({ queryKey: ['asset-runs'], queryFn: () => get<{ period: string; total: string; n: number; number: string }[]>('/assets/depreciation/runs') });
  const roll = useQuery({
    queryKey: ['asset-roll', year],
    queryFn: () =>
      get<
        {
          category: string;
          cost: Record<'opening' | 'additions' | 'disposals' | 'closing', string>;
          accumulated: Record<'opening' | 'additions' | 'disposals' | 'closing', string>;
          bookValue: { opening: string; closing: string };
        }[]
      >(`/assets/reports/roll-forward?year=${year}`),
  });
  const run = useAction(() => post<{ journals: { period: string; number: string; amount: string; assets: number }[] }>('/assets/depreciation/run', { period }), {
    success: (r) => (r.journals.length ? `${r.journals.length} jurnal penyusutan diposting (${r.journals.map((j) => j.period).join(', ')})` : 'Semua sudah disusutkan sampai periode ini'),
    invalidate: KEYS,
  });
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={10}>
        <Card title="Posting penyusutan">
          <Typography.Paragraph type="secondary">
            Satu klik menyusutkan semua aset sampai periode yang dipilih. Bulan yang terlewat ikut dikejar otomatis — satu jurnal per bulan, tanggal akhir bulan.
          </Typography.Paragraph>
          <Space wrap>
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 180 }} />
            {bookkeeper && (
              <Button type="primary" icon={<PlayCircleOutlined />} loading={run.isPending} onClick={() => run.mutate(undefined)}>
                Susutkan sampai {period}
              </Button>
            )}
          </Space>
          <Table
            style={{ marginTop: 16 }}
            size="small"
            rowKey="period"
            loading={runs.isLoading}
            dataSource={runs.data}
            pagination={{ pageSize: 12, hideOnSinglePage: true }}
            columns={[
              { title: 'Periode', dataIndex: 'period' },
              { title: 'Jurnal', dataIndex: 'number' },
              { title: 'Aset', dataIndex: 'n' },
              { title: 'Jumlah', dataIndex: 'total', align: 'right', render: fmtMoney },
            ]}
          />
        </Card>
      </Col>
      <Col xs={24}>
        <Card
          title="Mutasi aset tetap (bahan CALK)"
          extra={<InputNumber value={year} onChange={(v) => v && setYear(v)} min={2000} max={2100} style={{ width: 100 }} />}
        >
          <Table
            size="small"
            rowKey="category"
            pagination={false}
            bordered
            scroll={{ x: 1250 }}
            dataSource={roll.data}
            columns={[
              { title: 'Kategori', dataIndex: 'category', fixed: 'left', width: 170 },
              {
                title: 'Harga perolehan',
                children: (['opening', 'additions', 'disposals', 'closing'] as const).map((k) => ({
                  title: { opening: 'Awal', additions: 'Tambah', disposals: 'Kurang', closing: 'Akhir' }[k],
                  align: 'right' as const,
                  width: 120,
                  render: (_: unknown, r: { cost: Record<string, string> }) => <Amount v={r.cost[k]} />,
                })),
              },
              {
                title: 'Akumulasi penyusutan',
                children: (['opening', 'additions', 'disposals', 'closing'] as const).map((k) => ({
                  title: { opening: 'Awal', additions: 'Tambah', disposals: 'Kurang', closing: 'Akhir' }[k],
                  align: 'right' as const,
                  width: 120,
                  render: (_: unknown, r: { accumulated: Record<string, string> }) => <Amount v={r.accumulated[k]} />,
                })),
              },
              { title: 'Nilai buku akhir', align: 'right', width: 140, render: (_, r) => <Amount v={r.bookValue.closing} strong /> },
            ]}
          />
        </Card>
      </Col>
    </Row>
  );
}
