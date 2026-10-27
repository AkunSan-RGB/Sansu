import { useQuery } from '@tanstack/react-query';
import { Alert, Collapse, Table, Tag, Typography } from 'antd';
import { get } from '@/api/client';
import { fmtMoney } from '@/lib/format';

interface IncomeRow { key: string; label: string; group: 'SALES' | 'NONSALES' | 'OTHER'; category: 'SALES' | 'CAPITAL' | 'LOAN' | 'OTHER'; amount: number; count: number; suspect?: string }
interface IncomeSourcesData { from: string; to: string; rows: IncomeRow[]; totals: { sales: number; nonSales: number; other: number }; categories: { sales: number; capital: number; loan: number; other: number } }

const GROUP = { SALES: { c: 'green', t: 'Penjualan' }, NONSALES: { c: 'default', t: 'Bukan penjualan' }, OTHER: { c: 'default', t: 'Lainnya' } } as const;

/**
 * Dari mana uang masuk 30 hari terakhir: satu panel ringkas (tertutup bawaan). Judulnya sudah memuat empat angka utama,
 * rinciannya (per sumber, yang perlu diperiksa) dibuka bila diperlukan.
 */
export default function IncomeSources() {
  const { data } = useQuery({ queryKey: ['cash', 'income-sources'], queryFn: () => get<IncomeSourcesData>('/cash/income-sources') });
  if (!data || !data.rows.length) return null;
  const suspects = data.rows.filter((r) => r.suspect);
  const parts: [string, number][] = [['Penjualan', data.categories.sales], ['Modal dari pemilik', data.categories.capital], ['Pinjaman', data.categories.loan], ['Lainnya', data.categories.other]];
  return (
    <Collapse
      style={{ marginBottom: 12 }}
      items={[
        {
          key: 'src',
          label: (
            <div>
              <strong>Dari mana uang masuk (30 hari terakhir)</strong>
              {suspects.length > 0 && <Tag color="orange" style={{ marginLeft: 8 }}>{suspects.length} perlu diperiksa</Tag>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 20px', marginTop: 4 }}>
                {parts.map(([t, v]) => (
                  <span key={t}>
                    <Typography.Text type="secondary">{t}: </Typography.Text>
                    <strong>{fmtMoney(v)}</strong>
                  </span>
                ))}
              </div>
            </div>
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
  );
}
