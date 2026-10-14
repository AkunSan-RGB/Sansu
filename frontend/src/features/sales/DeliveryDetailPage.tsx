import { ArrowLeftOutlined, PrinterOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Popconfirm, Space, Tag } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import DocumentChain from '@/components/DocumentChain';
import { DocHeader, PartyBlock, PrintSheet, Signatures, cell, head } from '@/components/print/Letterhead';
import QueryState from '@/components/QueryState';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtQty } from '@/lib/format';
import { printDoc } from '@/lib/print';
import { t } from '@/lib/terms';
import type { Delivery } from './DeliveriesPage';

/** Surat jalan: dokumen pengiriman tanpa harga, siap cetak / simpan PDF */
export default function DeliveryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['deliveries', 'detail', id], queryFn: () => get<Delivery>(`/deliveries/${id}`) });
  const can = useCan();
  const cancel = useAction(() => post(`/deliveries/${id}/cancel`), {
    success: 'Surat jalan dibatalkan, stok dikembalikan',
    invalidate: ['deliveries', 'sales-orders', 'stock', 'stock-moves', 'dashboard', 'journals', 'doc-chain'],
  });
  return (
    <>
      <PageHeader
        title={q.data ? `Surat jalan ${q.data.number}` : 'Surat jalan'}
        extra={
          <Space wrap className="no-print">
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/deliveries')}>
              Daftar
            </Button>
            {q.data && (
              <Button icon={<PrinterOutlined />} onClick={() => printDoc(`Surat Jalan ${q.data!.number}`)}>
                Cetak / PDF
              </Button>
            )}
            {q.data && q.data.status === 'DELIVERED' && !q.data.invoice && can('POST', '/deliveries/:id/cancel') && (
              <Popconfirm title="Batalkan surat jalan? Stok dikembalikan dan jurnal HPP dibalik." onConfirm={() => cancel.mutate(undefined)}>
                <Button danger loading={cancel.isPending}>
                  Batalkan surat jalan
                </Button>
              </Popconfirm>
            )}
          </Space>
        }
      />
      <QueryState q={q}>
        {(d) => (
          <>
            <Card>
              <PrintSheet>
                <DocHeader
                  title="SURAT JALAN"
                  meta={[
                    ['No.', d.number],
                    ['Tanggal', fmtDate(d.date)],
                    [t('Sales Order'), d.salesOrder.number],
                    ...(d.invoice ? ([[t('Faktur'), d.invoice.number]] as [string, string][]) : []),
                    ...(d.warehouse ? ([['Dari', d.warehouse.name]] as [string, string][]) : []),
                  ]}
                />
                {d.status === 'CANCELLED' && <Tag color="red">DIBATALKAN</Tag>}
                <PartyBlock label="Dikirim kepada" name={d.customer.name} lines={[d.customer.address, d.customer.phone && `Telp. ${d.customer.phone}`]} />
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ ...head, width: 36 }}>No</th>
                      <th style={head}>{t('Produk')}</th>
                      <th style={{ ...head, textAlign: 'right' }}>Jumlah</th>
                      <th style={head}>Satuan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.lines?.map((l, i) => (
                      <tr key={l.id}>
                        <td style={cell}>{i + 1}</td>
                        <td style={cell}>
                          {l.product.sku} · {l.product.name}
                        </td>
                        <td style={{ ...cell, textAlign: 'right' }}>{fmtQty(l.qty)}</td>
                        <td style={cell}>{l.uom}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {d.notes && <p style={{ fontSize: 12, color: '#475569' }}>Catatan: {d.notes}</p>}
                <Signatures labels={[['Pengirim'], ['Penerima'], ['Hormat kami']]} />
              </PrintSheet>
            </Card>
            <DocumentChain orderId={d.salesOrder.id} />
          </>
        )}
      </QueryState>
    </>
  );
}
