import { ArrowLeftOutlined, PrinterOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Popconfirm, Space, Tag } from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, post } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import type { GoodsReceipt } from '@/api/types';
import { cell, DocHeader, head, PartyBlock, PrintSheet, Signatures, useLetterhead } from '@/components/print/Letterhead';
import QueryState from '@/components/QueryState';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, fmtQty } from '@/lib/format';
import { printDoc } from '@/lib/print';
import { t } from '@/lib/terms';

/** Penerimaan barang: tanda terima gudang atas pesanan pembelian, siap cetak / simpan PDF */
export default function GoodsReceiptDetailPage() {
  const lh = useLetterhead();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['goods-receipts', 'detail', id], queryFn: () => get<GoodsReceipt>(`/goods-receipts/${id}`) });
  const cancel = useAction(() => post(`/goods-receipts/${id}/cancel`, {}), {
    success: 'Penerimaan dibatalkan, stok dan jurnal dikembalikan',
    invalidate: ['goods-receipts', 'purchase-orders', 'stock', 'stock-moves', 'dashboard', ...LEDGER_KEYS],
  });
  return (
    <>
      <PageHeader
        title={q.data ? `Penerimaan barang ${q.data.number}` : 'Penerimaan barang'}
        extra={
          <Space wrap className="no-print">
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/goods-receipts')}>
              Daftar
            </Button>
            {q.data && (
              <Button icon={<PrinterOutlined />} onClick={() => printDoc(`Penerimaan Barang ${q.data!.number}`)}>
                Cetak / PDF
              </Button>
            )}
            {q.data && q.data.status === 'RECEIVED' && !q.data.autoInvoiceId && !q.data.lines?.some((l) => Number(l.billedQty) > 0) && (
              <Popconfirm title="Batalkan penerimaan? Stok keluar kembali dan jurnal dibalik." onConfirm={() => cancel.mutate(undefined)}>
                <Button danger loading={cancel.isPending}>
                  Batalkan penerimaan
                </Button>
              </Popconfirm>
            )}
          </Space>
        }
      />
      <QueryState q={q}>
        {(d) => (
          <>
            {d.status === 'RECEIVED' && !d.autoInvoiceId && (
              <Alert
                className="no-print"
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message={
                  d.lines?.every((l) => Number(l.billedQty) + 0.00005 >= Number(l.qty))
                    ? 'Seluruh barang pada penerimaan ini sudah difakturkan.'
                    : 'Barang sudah masuk stok. Nilainya ditampung di "Barang Diterima Belum Ditagih" sampai faktur supplier dicatat dari pesanan.'
                }
              />
            )}
            <Card>
              <PrintSheet>
                <DocHeader
                  title="PENERIMAAN BARANG"
                  meta={[
                    ['No.', d.number],
                    ['Tanggal', fmtDate(d.date)],
                    [t('Purchase Order'), d.order.number],
                    ...(d.supplierDeliveryNo ? ([['SJ supplier', d.supplierDeliveryNo]] as [string, string][]) : []),
                    ...(d.warehouse ? ([['Gudang', d.warehouse.name]] as [string, string][]) : []),
                  ]}
                />
                {d.status === 'CANCELLED' && <Tag color="red">DIBATALKAN</Tag>}
                <PartyBlock label={t('Diterima dari (supplier)')} name={d.supplier.name} lines={[d.supplier.address, d.supplier.phone && `Telp. ${d.supplier.phone}`]} />
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ ...head, width: 36 }}>No</th>
                      <th style={head}>{t('Produk')}</th>
                      <th style={{ ...head, textAlign: 'right' }}>Diterima</th>
                      <th style={head}>Satuan</th>
                      <th style={{ ...head, textAlign: 'right' }} className="no-print">
                        Ditagih
                      </th>
                      <th style={{ ...head, textAlign: 'right' }} className="no-print">
                        Nilai
                      </th>
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
                        <td style={{ ...cell, textAlign: 'right' }} className="no-print">
                          {fmtQty(l.billedQty)}
                        </td>
                        <td style={{ ...cell, textAlign: 'right' }} className="no-print">
                          {fmtMoney(l.value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {d.notes && <p style={{ fontSize: 12, color: '#475569' }}>Catatan: {d.notes}</p>}
                <Signatures labels={[['Pengirim'], ['Penerima / gudang', lh.data?.name]]} />
              </PrintSheet>
            </Card>
            <Card size="small" title="Dokumen terkait" className="no-print" style={{ marginTop: 16 }}>
              <Link to={`/purchase-orders/${d.order.id}`}>
                {t('Purchase Order')} {d.order.number}
              </Link>
            </Card>
          </>
        )}
      </QueryState>
    </>
  );
}
