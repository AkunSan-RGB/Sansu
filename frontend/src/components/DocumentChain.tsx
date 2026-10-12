import { CheckCircleFilled, ClockCircleOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Card, Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { get } from '@/api/client';
import { fmtDate, fmtMoney } from '@/lib/format';
import { t } from '@/lib/terms';

interface Chain {
  quotation: { id: string; number: string; status: string } | null;
  order: { id: string; number: string; status: string; total: string; date: string } | null;
  deliveries: { id: string; number: string; status: string; date: string; journal_id: string | null; cogs_amount: string }[];
  invoice: { id: string; number: string; status: string; total: string; paid_amount: string; date: string } | null;
  payments: { id: string; number: string; date: string; amount: string; method: string }[];
  returns: { id: string; number: string; date: string; total: string }[];
  journals: { id: string; number: string; date: string; description: string; source_type: string }[];
}

function Step({ done, label, children }: { done: boolean; label: string; children?: React.ReactNode }) {
  return (
    <div style={{ minWidth: 150, flex: '1 1 150px' }}>
      <Space size={6} align="start">
        {done ? <CheckCircleFilled style={{ color: '#2e9d5b', marginTop: 4 }} /> : <ClockCircleOutlined style={{ color: '#aaa', marginTop: 4 }} />}
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {label}
          </Typography.Text>
          <div style={{ fontSize: 13 }}>{children ?? <Typography.Text type="secondary">Belum ada</Typography.Text>}</div>
        </div>
      </Space>
    </div>
  );
}

/**
 * Jejak dokumen penjualan: penawaran → pesanan → surat jalan → faktur → pembayaran / retur → jurnal.
 * Setiap nomor bisa diklik; jurnal membuka Jurnal Umum yang sudah tersaring.
 */
export default function DocumentChain({ orderId, invoiceId }: { orderId?: string; invoiceId?: string }) {
  const url = orderId ? `/sales-orders/${orderId}/chain` : `/invoices/${invoiceId}/chain`;
  const q = useQuery({ queryKey: ['doc-chain', orderId ?? invoiceId], queryFn: () => get<Chain>(url), enabled: !!(orderId || invoiceId) });
  const c = q.data;
  if (!c) return null;
  const sj = c.deliveries.filter((d) => d.status === 'DELIVERED');
  return (
    <Card size="small" title="Jejak dokumen" loading={q.isLoading} style={{ marginTop: 16 }} className="no-print">
      <Space align="start" size={16} wrap style={{ width: '100%' }}>
        <Step done={!!c.quotation} label={t('Penawaran')}>
          {c.quotation && <Link to={`/quotations/${c.quotation.id}`}>{c.quotation.number}</Link>}
        </Step>
        <Step done={!!c.order} label={t('Sales Order')}>
          {c.order && <Link to={`/sales-orders/${c.order.id}`}>{c.order.number}</Link>}
        </Step>
        <Step done={sj.length > 0} label="Surat jalan">
          {sj.map((d) => (
            <div key={d.id}>
              <Link to={`/deliveries/${d.id}`}>{d.number}</Link> <Typography.Text type="secondary">{fmtDate(d.date)}</Typography.Text>
            </div>
          ))}
        </Step>
        <Step done={!!c.invoice} label={t('Faktur')}>
          {c.invoice && (
            <>
              <Link to={`/invoices/${c.invoice.id}`}>{c.invoice.number}</Link>
              <div>
                <Typography.Text type="secondary">
                  {fmtMoney(c.invoice.total)} · {c.invoice.status === 'PAID' ? 'lunas' : c.invoice.status === 'PARTIAL' ? 'bayar sebagian' : 'belum bayar'}
                </Typography.Text>
              </div>
            </>
          )}
        </Step>
        <Step done={c.payments.length > 0} label="Pembayaran">
          {c.payments.map((p) => (
            <div key={p.id}>
              {p.number} <Typography.Text type="secondary">{fmtMoney(p.amount)}</Typography.Text>
            </div>
          ))}
        </Step>
        {c.returns.length > 0 && (
          <Step done label={t('Retur penjualan')}>
            {c.returns.map((r) => (
              <div key={r.id}>
                {r.number} <Typography.Text type="secondary">{fmtMoney(r.total)}</Typography.Text>
              </div>
            ))}
          </Step>
        )}
      </Space>
      {c.journals.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Jurnal yang terbentuk:{' '}
          </Typography.Text>
          {c.journals.map((j) => (
            <Link key={j.id} to={`/journals?q=${encodeURIComponent(j.number)}`}>
              <Tag color="blue" style={{ cursor: 'pointer' }}>
                {j.number}
              </Tag>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
