import { Table, Typography } from 'antd';
import type { AgingRow } from '@/api/types';
import { fmtMoney } from '@/lib/format';

/** Tabel umur piutang / hutang per pihak */
export default function AgingTable({ rows, loading, partyLabel }: { rows?: AgingRow[]; loading?: boolean; partyLabel: string }) {
  const party = (r: AgingRow) => r.customer ?? r.supplier!;
  return (
    <Table
      rowKey={(r) => party(r).id}
      loading={loading}
      dataSource={rows}
      scroll={{ x: 900 }}
      pagination={false}
      columns={[
        { title: partyLabel, render: (_, r) => `${party(r).code} · ${party(r).name}` },
        { title: 'Belum jatuh tempo', dataIndex: 'current', align: 'right', render: fmtMoney },
        { title: '1–30 hari', dataIndex: 'd1_30', align: 'right', render: fmtMoney },
        { title: '31–60 hari', dataIndex: 'd31_60', align: 'right', render: fmtMoney },
        { title: '61–90 hari', dataIndex: 'd61_90', align: 'right', render: fmtMoney },
        {
          title: '> 90 hari',
          dataIndex: 'd90_plus',
          align: 'right',
          render: (v) => <Typography.Text type={Number(v) > 0 ? 'danger' : undefined}>{fmtMoney(v)}</Typography.Text>,
        },
        { title: 'Total', dataIndex: 'total', align: 'right', render: (v) => <strong>{fmtMoney(v)}</strong> },
      ]}
      summary={(data) =>
        data.length > 1 && (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}>
              <strong>Total</strong>
            </Table.Summary.Cell>
            {(['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus', 'total'] as const).map((k, i) => (
              <Table.Summary.Cell key={k} index={i + 1} align="right">
                <strong>{fmtMoney(data.reduce((a, r) => a + Number(r[k]), 0))}</strong>
              </Table.Summary.Cell>
            ))}
          </Table.Summary.Row>
        )
      }
    />
  );
}
