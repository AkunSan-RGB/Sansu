import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Col, Collapse, Row, Statistic, Table, Tag, Typography } from 'antd';
import { get } from '@/api/client';
import { fmtMoney } from '@/lib/format';

interface IncomeRow { key: string; label: string; group: 'SALES' | 'NONSALES' | 'OTHER'; category: 'SALES' | 'CAPITAL' | 'LOAN' | 'OTHER'; amount: number; count: number; suspect?: string }

/** Uang masuk 30 hari terakhir per sumber: penjualan vs bukan penjualan; penjualan yang dicatat lewat kas masuk ditandai */
export default function IncomeSources() {
  const { data } = useQuery({ queryKey: ['cash', 'income-sources'], queryFn: () => get<{ from: string; to: string; rows: IncomeRow[]; totals: { sales: number; nonSales: number; other: number }; categories: { sales: number; capital: number; loan: number; other: number } }>('/cash/income-sources'), retry: false });
  if (!data || !data.rows.length) return null;
  const suspects = data.rows.filter((r) => r.suspect);
  const GROUP = { SALES: { c: 'green', t: 'Penjualan' }, NONSALES: { c: 'blue', t: 'Bukan penjualan' }, OTHER: { c: 'default', t: 'Lainnya' } } as const;
  return (
    <>
    <Card size="small" title="Uang masuk berdasarkan sumber (30 hari)" style={{ marginBottom: 12 }}>
      <Row gutter={[12, 12]}>
        {([['Penjualan', data.categories.sales, '#389e0d'], ['Modal dari pemilik', data.categories.capital, '#111111'], ['Pinjaman', data.categories.loan, '#d46b08'], ['Lainnya', data.categories.other, '#8c8c8c']] as const).map(([t, v, c]) => (
          <Col key={t} xs={12} md={6}>
            <Statistic title={t} value={v} formatter={(x) => fmtMoney(Number(x))} valueStyle={{ color: c, fontSize: 18 }} />
          </Col>
        ))}
      </Row>
    </Card>
    <Collapse
      style={{ marginBottom: 16 }}
      items={[
        {
          key: 'src',
          label: (
            <span>
              <strong>Uang masuk per sumber</strong> (30 hari) · Penjualan {fmtMoney(data.totals.sales)} · Bukan penjualan {fmtMoney(data.totals.nonSales)}
              {suspects.length > 0 && <Tag color="orange" style={{ marginLeft: 8 }}>{suspects.length} perlu diperiksa</Tag>}
            </span>
          ),
          children: (
            <>
              {suspects.map((s) => <Alert key={s.key} type="warning" showIcon style={{ marginBottom: 8 }} message={`${s.label}: ${fmtMoney(s.amount)}`} description={s.suspect} />)}
              <Table<IncomeRow>
                size="small"
                rowKey="key"
                pagination={false}
                dataSource={data.rows}
                columns={[
                  { title: 'Sumber', dataIndex: 'label' },
                  { title: 'Jenis', dataIndex: 'group', render: (g: IncomeRow['group']) => <Tag color={GROUP[g].c}>{GROUP[g].t}</Tag> },
                  { title: 'Transaksi', dataIndex: 'count', align: 'right' as const },
                  { title: 'Jumlah', dataIndex: 'amount', align: 'right' as const, render: (v: number) => fmtMoney(v) },
                ]}
              />
              <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                Pembayaran pelanggan dicatat lewat Faktur & piutang (atau kasir). Uang masuk lain dicatat sebagai Kas masuk dengan memilih sumbernya; sistem membuat jurnalnya.
              </Typography.Paragraph>
            </>
          ),
        },
      ]}
    />
    </>
  );
}
