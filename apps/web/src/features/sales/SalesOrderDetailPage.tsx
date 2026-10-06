import { useQuery } from '@tanstack/react-query';
import { Button, Card, Descriptions, Popconfirm, Space, Table } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import type { Invoice, SalesOrder } from '@/api/types';
import PageHeader from '@/layout/PageHeader';
import { fmtDate, fmtMoney, fmtQty } from '@/lib/format';
import DocumentChain from '@/components/DocumentChain';
import { SalesOrderStatusTag } from './status';
import { t } from '@/lib/terms';

export default function SalesOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: o, isLoading } = useQuery({ queryKey: ['sales-orders', 'detail', id], queryFn: () => get<SalesOrder>(`/sales-orders/${id}`) });
  const refresh = ['sales-orders', 'invoices', 'stock', 'stock-moves', 'dashboard', 'journals', 'deliveries', 'doc-chain'];

  const confirm = useAction(() => post(`/sales-orders/${id}/confirm`), { success: 'Order dikonfirmasi', invalidate: refresh });
  const cancel = useAction(() => post(`/sales-orders/${id}/cancel`), { success: 'Order dibatalkan', invalidate: refresh });
  const deliver = useAction(() => post<{ id: string; number: string }>(`/sales-orders/${id}/deliver`), {
    success: (r) => `Surat jalan ${r.number} dibuat · stok keluar`,
    invalidate: refresh,
    // langsung ke surat jalan agar bisa dicetak
    onSuccess: (r) => navigate(`/deliveries/${r.id}`),
  });
  const invoice = useAction(() => post<Invoice & { journalNumber: string }>('/invoices', { salesOrderId: id }), {
    success: (r) => `Faktur ${r.number} dibuat · jurnal ${r.journalNumber}`,
    invalidate: refresh,
    // langsung ke faktur agar bisa dicetak / dikirim via WhatsApp
    onSuccess: (r) => navigate(`/invoices/${r.id}`),
  });

  return (
    <>
      <PageHeader
        title={o ? `Sales Order ${o.number}` : 'Sales Order'}
        extra={
          o && (
            <Space wrap>
              {o.status === 'DRAFT' && (
                <Button type="primary" loading={confirm.isPending} onClick={() => confirm.mutate(undefined)}>
                  Konfirmasi
                </Button>
              )}
              {o.status === 'CONFIRMED' && (
                <Popconfirm title="Kirim barang? Surat jalan dibuat, stok dikurangi, dan HPP dijurnal. Faktur bisa dibuat sesudahnya." onConfirm={() => deliver.mutate(undefined)}>
                  <Button type="primary" loading={deliver.isPending}>
                    Kirim barang (surat jalan)
                  </Button>
                </Popconfirm>
              )}
              {(o.status === 'CONFIRMED' || o.status === 'DELIVERED') && (
                <Popconfirm
                  title={o.status === 'DELIVERED' ? 'Buat faktur dari surat jalan? Piutang, penjualan, dan PPN dijurnal.' : t('Buat faktur? Stok akan dikurangi dan jurnal diposting.')}
                  onConfirm={() => invoice.mutate(undefined)}
                >
                  <Button type={o.status === 'DELIVERED' ? 'primary' : 'default'} loading={invoice.isPending}>
                    {o.status === 'CONFIRMED' ? 'Langsung buat faktur' : 'Buat faktur'}
                  </Button>
                </Popconfirm>
              )}
              {(o.status === 'DRAFT' || o.status === 'CONFIRMED') && (
                <Popconfirm title="Batalkan order ini?" onConfirm={() => cancel.mutate(undefined)}>
                  <Button danger>Batalkan</Button>
                </Popconfirm>
              )}
              {o.invoice && <Button onClick={() => navigate(`/invoices/${o.invoice!.id}`)}>Lihat faktur {o.invoice.number}</Button>}
            </Space>
          )
        }
      />
      <Card loading={isLoading}>
        {o && (
          <>
            <Descriptions bordered size="small" column={{ xs: 1, md: 2 }} style={{ marginBottom: 16 }}>
              <Descriptions.Item label={t('Pelanggan')}>
                {o.customer.code} · {o.customer.name}
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                <SalesOrderStatusTag status={o.status} />
              </Descriptions.Item>
              <Descriptions.Item label="Tanggal">{fmtDate(o.date)}</Descriptions.Item>
              <Descriptions.Item label={t('Gudang')}>{o.warehouse?.name}</Descriptions.Item>
              {o.notes && <Descriptions.Item label="Catatan">{o.notes}</Descriptions.Item>}
            </Descriptions>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={o.lines}
              scroll={{ x: 700 }}
              columns={[
                { title: t('Produk'), render: (_, l) => `${l.product.sku} · ${l.product.name}` },
                { title: 'Qty', align: 'right', render: (_, l) => `${fmtQty(l.qty)} ${l.uom}` },
                { title: 'Harga', dataIndex: 'price', align: 'right', render: fmtMoney },
                { title: 'Diskon', dataIndex: 'discountPct', align: 'right', render: (v) => `${Number(v)}%` },
                { title: 'Jumlah', dataIndex: 'lineTotal', align: 'right', render: fmtMoney },
              ]}
            />
            <Descriptions column={1} size="small" style={{ maxWidth: 360, marginLeft: 'auto', marginTop: 16 }} bordered>
              <Descriptions.Item label="Subtotal (DPP)">{fmtMoney(o.subtotal)}</Descriptions.Item>
              <Descriptions.Item label="PPN">{fmtMoney(o.taxAmount)}</Descriptions.Item>
              <Descriptions.Item label="Total">
                <strong>{fmtMoney(o.total)}</strong>
              </Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Card>
      {id && <DocumentChain orderId={id} />}
    </>
  );
}
