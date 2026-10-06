import { PrinterOutlined, SendOutlined, WhatsAppOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Popconfirm, Space } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import type { Quotation, SalesOrder } from '@/api/types';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, fmtQty } from '@/lib/format';
import { printDoc } from '@/lib/print';
import { DocHeader, PartyBlock, PrintSheet, Signatures } from '@/components/print/Letterhead';
import { waLink } from './LeadDrawer';
import { QuotationStatusTag } from './QuotationsPage';

export default function QuotationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: q, isLoading } = useQuery({ queryKey: ['quotations', 'detail', id], queryFn: () => get<Quotation>(`/crm/quotations/${id}`) });
  const refresh = ['quotations', 'crm-lead', 'crm-pipeline', 'crm-summary', 'sales-orders'];
  const send = useAction(() => post(`/crm/quotations/${id}/send`), { success: 'Penawaran ditandai terkirim', invalidate: refresh });
  const reject = useAction(() => post(`/crm/quotations/${id}/reject`), { success: 'Penawaran ditolak', invalidate: refresh });
  const convert = useAction(() => post<{ salesOrder: SalesOrder }>(`/crm/quotations/${id}/convert`), {
    success: (r) => `Sales Order ${r.salesOrder.number} dibuat`,
    invalidate: refresh,
    onSuccess: (r) => navigate(`/sales-orders/${r.salesOrder.id}`),
  });
  const open = q && (q.status === 'DRAFT' || q.status === 'SENT');
  const waText = q && encodeURIComponent(`Yth. ${q.customer.name}, berikut penawaran harga ${q.number} senilai ${fmtMoney(q.total)} (berlaku s/d ${fmtDate(q.validUntil)}). Terima kasih.`);

  return (
    <>
      <PageHeader
        title={q ? `Penawaran ${q.number}` : 'Penawaran'}
        extra={
          q && (
            <Space wrap className="no-print">
              <QuotationStatusTag q={q} />
              <Button icon={<PrinterOutlined />} onClick={() => printDoc(`Penawaran ${q.number}`)}>
                Cetak / PDF
              </Button>
              {q.customer.phone && (
                <Button icon={<WhatsAppOutlined />} href={`${waLink(q.customer.phone)}?text=${waText}`} target="_blank">
                  Kirim via WA
                </Button>
              )}
              {q.status === 'DRAFT' && (
                <Button icon={<SendOutlined />} onClick={() => send.mutate(undefined)} loading={send.isPending}>
                  Tandai terkirim
                </Button>
              )}
              {open && (
                <>
                  <Popconfirm title="Pelanggan setuju? Sales Order draft akan dibuat dengan harga yang sama." onConfirm={() => convert.mutate(undefined)}>
                    <Button type="primary" loading={convert.isPending}>
                      Disetujui → buat Sales Order
                    </Button>
                  </Popconfirm>
                  <Popconfirm title="Tandai penawaran ditolak?" onConfirm={() => reject.mutate(undefined)}>
                    <Button danger>Ditolak</Button>
                  </Popconfirm>
                </>
              )}
              {q.salesOrder && <Button onClick={() => navigate(`/sales-orders/${q.salesOrder!.id}`)}>Lihat {q.salesOrder.number}</Button>}
            </Space>
          )
        }
      />
      <Card loading={isLoading}>
        {q && (
          <PrintSheet>
            <DocHeader
              title="PENAWARAN HARGA"
              meta={[
                ['No.', q.number],
                ['Tanggal', fmtDate(q.date)],
                ['Berlaku s/d', fmtDate(q.validUntil)],
              ]}
            />
            <PartyBlock label="Kepada Yth." name={q.customer.name} lines={[q.customer.address, q.customer.phone && `Telp. ${q.customer.phone}`]} />
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f3f5f9' }}>
                  {['No', 'Produk', 'Qty', 'Harga', 'Diskon', 'Jumlah'].map((h, i) => (
                    <th key={h} style={{ padding: 8, textAlign: i >= 2 ? 'right' : 'left', borderBottom: '1px solid #ddd' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.lines?.map((l, i) => (
                  <tr key={l.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{i + 1}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>
                      {l.product.name}
                      <div style={{ color: '#888', fontSize: 11 }}>{l.product.sku}</div>
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #eee', textAlign: 'right' }}>
                      {fmtQty(l.qty)} {l.uom}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #eee', textAlign: 'right' }}>{fmtMoney(l.price)}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid #eee', textAlign: 'right' }}>{Number(l.discountPct) ? `${Number(l.discountPct)}%` : '-'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid #eee', textAlign: 'right' }}>{fmtMoney(l.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <table style={{ minWidth: 300, fontSize: 13 }}>
                <tbody>
                  <tr>
                    <td style={{ padding: 4 }}>Subtotal (DPP)</td>
                    <td style={{ padding: 4, textAlign: 'right' }}>{fmtMoney(q.subtotal)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: 4 }}>PPN</td>
                    <td style={{ padding: 4, textAlign: 'right' }}>{fmtMoney(q.taxAmount)}</td>
                  </tr>
                  <tr style={{ fontWeight: 700, fontSize: 15 }}>
                    <td style={{ padding: 4, borderTop: '2px solid #333' }}>Total</td>
                    <td style={{ padding: 4, borderTop: '2px solid #333', textAlign: 'right' }}>{fmtMoney(q.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {q.terms && (
              <div style={{ marginTop: 20 }}>
                <strong>Syarat & ketentuan</strong>
                <div style={{ whiteSpace: 'pre-line' }}>{q.terms}</div>
              </div>
            )}
            <Signatures labels={[['Hormat kami,', q.company?.name]]} />
          </PrintSheet>
        )}
      </Card>
    </>
  );
}
