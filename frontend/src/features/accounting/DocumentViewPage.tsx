import { ArrowLeftOutlined } from '@ant-design/icons';
import type { JournalEntry } from '@sansu/shared';
import { JOURNAL_SOURCE_LABELS } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Descriptions, Empty, Space, Table, Tag, Typography } from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get } from '@/api/client';
import QueryState from '@/components/QueryState';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, fmtQty } from '@/lib/format';

interface DocField {
  label: string;
  value: string;
  money?: boolean;
}
interface DocTable {
  columns: { key: string; title: string; align?: 'right'; money?: boolean; qty?: boolean }[];
  rows: Record<string, string | null>[];
}
interface SourceDocument {
  title: string;
  number: string | null;
  date: string | null;
  fields: DocField[];
  table: DocTable | null;
  related: { label: string; route: string }[];
}

/** Dokumen asal sebuah jurnal: faktur / pembayaran / retur pembelian, mutasi stok, kas, kasir, setoran pajak, dst. */
export default function DocumentViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['journal-document', id], queryFn: () => get<{ journal: JournalEntry; document: SourceDocument | null }>(`/accounting/journals/${id}/document`) });
  return (
    <>
      <PageHeader
        title={q.data?.document ? `${q.data.document.title} ${q.data.document.number ?? ''}` : 'Dokumen asal jurnal'}
        extra={
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
            Kembali
          </Button>
        }
      />
      <QueryState q={q}>
        {({ journal, document: d }) => (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {d ? (
              <Card title={`${d.title}${d.date ? ` · ${fmtDate(d.date)}` : ''}`}>
                <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
                  {d.fields.map((f) => (
                    <Descriptions.Item key={f.label} label={f.label}>
                      {f.money && f.value !== '-' ? fmtMoney(f.value) : f.value}
                    </Descriptions.Item>
                  ))}
                </Descriptions>
                {d.table && (
                  <Table
                    style={{ marginTop: 16 }}
                    size="small"
                    rowKey={(_, i) => String(i)}
                    pagination={false}
                    dataSource={d.table.rows}
                    scroll={{ x: 600 }}
                    columns={d.table.columns.map((c) => ({
                      title: c.title,
                      dataIndex: c.key,
                      align: c.align,
                      render: (v: string | null) => (v === null ? '-' : c.money ? fmtMoney(v) : c.qty ? fmtQty(v) : v),
                    }))}
                  />
                )}
                {d.related.length > 0 && (
                  <Space style={{ marginTop: 12 }} wrap>
                    {d.related.map((r) => (
                      <Link key={r.route} to={r.route}>
                        <Button size="small">{r.label}</Button>
                      </Link>
                    ))}
                  </Space>
                )}
              </Card>
            ) : (
              <Card>
                <Empty description="Jurnal ini tidak punya dokumen terpisah (dibuat langsung di jurnal)." />
              </Card>
            )}
            <Card
              title={
                <Space>
                  Jurnal {journal.number}
                  <Tag>{JOURNAL_SOURCE_LABELS[journal.sourceType] ?? journal.sourceType}</Tag>
                </Space>
              }
              extra={<Typography.Text type="secondary">{fmtDate(journal.date)}</Typography.Text>}
            >
              <Typography.Paragraph>{journal.description}</Typography.Paragraph>
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={journal.lines}
                columns={[
                  { title: 'Akun', render: (_, l) => `${l.account.code} · ${l.account.name}` },
                  { title: 'Debit', dataIndex: 'debit', align: 'right', render: (v: string) => (Number(v) ? fmtMoney(v) : '') },
                  { title: 'Kredit', dataIndex: 'credit', align: 'right', render: (v: string) => (Number(v) ? fmtMoney(v) : '') },
                ]}
              />
            </Card>
          </Space>
        )}
      </QueryState>
    </>
  );
}
