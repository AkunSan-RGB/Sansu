import { CheckCircleTwoTone } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Col, Descriptions, Empty, Input, Row, Space, Table } from 'antd';
import { useState } from 'react';
import { get } from '@/api/client';
import type { BankReconciliation } from '@/api/types';
import { fmtDate, today } from '@/lib/format';
import { bankMoney } from './shared';

export function ReconciliationTab({ cashAccountId }: { cashAccountId?: string }) {
  const [asOf, setAsOf] = useState(today());
  const rec = useQuery({
    queryKey: ['bank', 'rec', cashAccountId, asOf],
    queryFn: () => get<BankReconciliation>(`/bank/reconciliation?cashAccountId=${cashAccountId}&asOf=${asOf}`),
    enabled: !!cashAccountId,
  });
  const d = rec.data;
  if (!cashAccountId) return <Empty description="Pilih rekening bank" />;
  const list = (title: string, rows: { date: string; number?: string; description: string; amount: string }[], total: string, sign: string) => (
    <Table
      size="small"
      rowKey="_k"
      dataSource={rows.map((r, i) => ({ ...r, _k: `${r.number ?? r.date}-${i}` }))}
      pagination={{ pageSize: 10, hideOnSinglePage: true }}
      title={() => <strong>{title}</strong>}
      locale={{ emptyText: 'Tidak ada' }}
      columns={[
        { title: 'Tanggal', dataIndex: 'date', render: fmtDate, width: 110 },
        { title: 'Nomor', dataIndex: 'number', width: 150 },
        { title: 'Keterangan', dataIndex: 'description', ellipsis: true },
        { title: 'Jumlah', dataIndex: 'amount', align: 'right', render: bankMoney },
      ]}
      summary={() => (
        <Table.Summary.Row>
          <Table.Summary.Cell index={0} colSpan={3}>
            <strong>Jumlah ({sign})</strong>
          </Table.Summary.Cell>
          <Table.Summary.Cell index={3} align="right">
            <strong>{bankMoney(total)}</strong>
          </Table.Summary.Cell>
        </Table.Summary.Row>
      )}
      style={{ marginBottom: 16 }}
    />
  );
  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value || today())} prefix="Per" />
      </Space>
      {d && (
        <>
          {d.bankBalance === null ? (
            <Alert type="info" showIcon message="Belum ada mutasi bersaldo yang diimpor untuk rekening ini sampai tanggal tersebut." style={{ marginBottom: 12 }} />
          ) : d.reconciled ? (
            <Alert type="success" showIcon icon={<CheckCircleTwoTone twoToneColor="#52c41a" />} message="Saldo bank dan saldo buku cocok setelah penyesuaian." style={{ marginBottom: 12 }} />
          ) : (
            <Alert type="warning" showIcon message={`Masih ada selisih ${bankMoney(d.difference)} — periksa mutasi yang belum dicocokkan.`} style={{ marginBottom: 12 }} />
          )}
          <Row gutter={16}>
            <Col xs={24} lg={12}>
              <Card size="small" title="Menurut rekening koran bank">
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label={`Saldo bank ${d.bankBalanceDate ? `(${fmtDate(d.bankBalanceDate)})` : ''}`}>{d.bankBalance ? bankMoney(d.bankBalance) : '—'}</Descriptions.Item>
                  <Descriptions.Item label="+ Setoran dalam perjalanan">{bankMoney(d.totals.depositsInTransit)}</Descriptions.Item>
                  <Descriptions.Item label="− Pembayaran belum dicairkan">{bankMoney(d.totals.outstandingPayments)}</Descriptions.Item>
                  <Descriptions.Item label="Saldo bank disesuaikan">
                    <strong>{d.adjustedBank ? bankMoney(d.adjustedBank) : '—'}</strong>
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card size="small" title="Menurut buku (SANSU)">
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="Saldo buku">{bankMoney(d.bookBalance)}</Descriptions.Item>
                  <Descriptions.Item label="± Mutasi bank belum dicatat">{bankMoney(d.totals.unrecorded)}</Descriptions.Item>
                  <Descriptions.Item label="Saldo buku disesuaikan">
                    <strong>{bankMoney(d.adjustedBook)}</strong>
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
          </Row>
          <div style={{ marginTop: 16 }}>
            {list('Setoran dalam perjalanan (di buku, belum di bank)', d.depositsInTransit, d.totals.depositsInTransit, '+')}
            {list('Pembayaran belum dicairkan (di buku, belum di bank)', d.outstandingPayments, d.totals.outstandingPayments, '−')}
            {list('Mutasi bank belum dicatat di buku', d.unrecorded, d.totals.unrecorded, '±')}
          </div>
        </>
      )}
    </>
  );
}
