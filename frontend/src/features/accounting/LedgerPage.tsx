import { JOURNAL_SOURCE_LABELS } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Card, Empty, Input, Select, Space, Table, Tag, Typography, Alert } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get, qs } from '@/api/client';
import { useAccounts } from '@/api/queries';
import type { LedgerReport } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import ExportButtons from '@/components/ExportButtons';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import { ledgerSheet } from '@/lib/xlsx/reports';

export default function LedgerPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const accountId = params.get('accountId') ?? undefined;
  const [from, setFrom] = useState(params.get('from') ?? dayjs().startOf('month').format('YYYY-MM-DD'));
  const [to, setTo] = useState(params.get('to') ?? today());
  const accounts = useAccounts();

  const { data, isFetching } = useQuery({
    queryKey: ['ledger', accountId, from, to],
    queryFn: () => get<LedgerReport>(`/accounting/reports/ledger${qs({ accountId, from, to })}`),
    enabled: !!accountId,
  });

  const title = data ? `Buku Besar ${data.account.code} ${data.account.name}` : 'Buku Besar';

  return (
    <>
      <PageHeader
        title="Buku Besar"
        extra={
          <Space wrap className="no-print">
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Pilih akun"
              style={{ width: 300 }}
              value={accountId}
              onChange={(v) => setParams({ accountId: v })}
              options={accounts.data?.filter((a) => a.isPostable).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))}
            />
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span>s/d</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <ExportButtons
              filename={`buku-besar-${data?.account.code ?? ''}-${from}-${to}`}
              title={title}
              sheets={() => (data ? ledgerSheet(data, from, to, me?.tenantName) : null)}
            />
          </Space>
        }
      />
      <Card className="print-area">
        <div className="print-only">
          <Typography.Title level={5}>{me?.tenantName}</Typography.Title>
          <Typography.Text>
            {title} · {fmtDate(from)} s/d {fmtDate(to)}
          </Typography.Text>
        </div>
        {!accountId ? (
          <Empty description="Pilih akun untuk melihat mutasi dan saldo berjalan" />
        ) : (
          <>
          {data?.truncated && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={`Menampilkan ${data.rows.length.toLocaleString('id-ID')} dari ${(data.totalRows ?? 0).toLocaleString('id-ID')} baris`}
              description="Total dan saldo akhir sudah mencakup seluruh baris. Persempit rentang tanggal untuk melihat semua mutasi."
            />
          )}
          <Table
            rowKey={(r) => `${r.journalId}-${r.balance}-${r.debit}-${r.credit}`}
            size="small"
            loading={isFetching}
            dataSource={data?.rows}
            pagination={false}
            scroll={{ x: 900 }}
            title={() =>
              data && (
                <Space size="large" wrap>
                  <span>
                    Saldo awal: <strong>{fmtMoney(data.opening)}</strong>
                  </span>
                  <span>
                    Saldo akhir: <strong>{fmtMoney(data.closing)}</strong>
                  </span>
                </Space>
              )
            }
            columns={[
              { title: 'Tanggal', dataIndex: 'date', render: fmtDate, width: 110 },
              { title: 'Nomor', dataIndex: 'number', width: 150, render: (n: string) => <Link to={`/journals?q=${encodeURIComponent(n)}`}>{n}</Link> },
              { title: 'Keterangan', dataIndex: 'description' },
              {
                title: 'Sumber',
                dataIndex: 'sourceType',
                render: (s: keyof typeof JOURNAL_SOURCE_LABELS, r) => (r.docRoute ? <Link to={r.docRoute}><Tag color="blue" style={{ cursor: 'pointer' }}>{JOURNAL_SOURCE_LABELS[s]} ↗</Tag></Link> : <Tag>{JOURNAL_SOURCE_LABELS[s]}</Tag>),
              },
              { title: 'Debit', dataIndex: 'debit', align: 'right', render: (v) => (Number(v) ? fmtMoney(v) : '') },
              { title: 'Kredit', dataIndex: 'credit', align: 'right', render: (v) => (Number(v) ? fmtMoney(v) : '') },
              { title: 'Saldo', dataIndex: 'balance', align: 'right', render: fmtMoney },
            ]}
            summary={() =>
              data && (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={4}>
                    <strong>Total mutasi</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right">
                    <strong>{fmtMoney(data.totalDebit)}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="right">
                    <strong>{fmtMoney(data.totalCredit)}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={6} align="right">
                    <strong>{fmtMoney(data.closing)}</strong>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              )
            }
          />
          </>
        )}
      </Card>
    </>
  );
}
