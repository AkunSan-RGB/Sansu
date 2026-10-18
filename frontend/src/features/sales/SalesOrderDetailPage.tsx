import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Input, InputNumber, Modal, Popconfirm, Space, Table } from 'antd';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import type { Invoice, SalesOrder } from '@/api/types';
import PageHeader from '@/layout/PageHeader';
import { isForeignCurrency } from '@sansu/shared';
import { fmtCurrency, fmtDate, fmtMoney, fmtQty, fmtRate } from '@/lib/format';
import DocumentChain from '@/components/DocumentChain';
import { useAuth } from '@/auth/AuthContext';
import { useCan } from '@/auth/useCan';
import { SalesOrderStatusTag } from './status';
import { t } from '@/lib/terms';
import WorkflowBadge from '@/features/workflow/WorkflowBadge';

export default function SalesOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: o, isLoading } = useQuery({ queryKey: ['sales-orders', 'detail', id], queryFn: () => get<SalesOrder>(`/sales-orders/${id}`) });
  const refresh = ['sales-orders', 'invoices', 'stock', 'stock-moves', 'dashboard', 'journals', 'deliveries', 'doc-chain'];

  const confirm = useAction(() => post(`/sales-orders/${id}/confirm`), { success: 'Order dikonfirmasi', invalidate: refresh });
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const [packing, setPacking] = useState<Record<string, number | null> | null>(null);
  const cancel = useAction((reason?: string) => post(`/sales-orders/${id}/cancel`, { reason }), { success: 'Order dibatalkan', invalidate: refresh, onSuccess: () => setCancelReason(null) });
  const { me } = useAuth();
  const isApprover = ['OWNER', 'ADMIN'].includes(me?.role ?? '');
  const can = useCan();
  const deliver = useAction((lines?: { orderLineId: string; qty: string }[]) => post<{ id: string; number: string }>(`/sales-orders/${id}/deliver`, lines ? { lines } : {}), {
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
        title={<Space wrap>{o ? `Sales Order ${o.number}` : 'Sales Order'}{o && <WorkflowBadge type="SALES_ORDER" id={o.id} />}</Space>}
        extra={
          o && (
            <Space wrap>
              {o.status === 'DRAFT' && can('POST', '/sales-orders/:id/confirm') && (
                <Button type="primary" loading={confirm.isPending} onClick={() => confirm.mutate(undefined)}>
                  Konfirmasi
                </Button>
              )}
              {o.status === 'CONFIRMED' && ['OWNER', 'ADMIN', 'WAREHOUSE'].includes(me?.role ?? '') && can('POST', '/sales-orders/:id/deliver') && (
                o.blindDelivery ? (
                  <Button type="primary" loading={deliver.isPending} onClick={() => setPacking({})}>
                    Kirim barang (surat jalan)
                  </Button>
                ) : (
                  <>
                    <Popconfirm title={`Kirim ${o.lines?.some((l) => Number(l.deliveredQty ?? 0) > 0) ? 'sisa ' : ''}barang? Surat jalan dibuat, stok dikurangi, dan HPP dijurnal. Faktur bisa dibuat setelah semua terkirim.`} onConfirm={() => deliver.mutate(undefined)}>
                      <Button type="primary" loading={deliver.isPending}>
                        {o.lines?.some((l) => Number(l.deliveredQty ?? 0) > 0) ? 'Kirim semua sisa' : 'Kirim barang (surat jalan)'}
                      </Button>
                    </Popconfirm>
                    <Button onClick={() => setPacking({})}>Kirim sebagian</Button>
                  </>
                )
              )}
              {(o.status === 'DELIVERED' || (o.status === 'CONFIRMED' && isApprover && !o.lines?.some((l) => Number(l.deliveredQty ?? 0) > 0))) && can('POST', '/invoices') && (
                <Popconfirm
                  title={o.status === 'DELIVERED' ? 'Buat faktur dari surat jalan? Piutang, penjualan, dan PPN dijurnal.' : t('Buat faktur? Stok akan dikurangi dan jurnal diposting.')}
                  onConfirm={() => invoice.mutate(undefined)}
                >
                  <Button type={o.status === 'DELIVERED' ? 'primary' : 'default'} loading={invoice.isPending}>
                    {o.status === 'CONFIRMED' ? 'Langsung buat faktur' : 'Buat faktur'}
                  </Button>
                </Popconfirm>
              )}
              {(o.status === 'DRAFT' || o.status === 'CONFIRMED') && can('POST', '/sales-orders/:id/cancel') &&
                (o.status === 'DRAFT' ? (
                  <Popconfirm title="Batalkan order ini?" onConfirm={() => cancel.mutate(undefined)}>
                    <Button danger>Batalkan</Button>
                  </Popconfirm>
                ) : (
                  <Button danger onClick={() => setCancelReason('')}>
                    Batalkan
                  </Button>
                ))}
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
              {isForeignCurrency(o.currency) && (
                <Descriptions.Item label="Mata uang">
                  {o.currency} · kurs Rp {fmtRate(o.fxRate)} · total {fmtCurrency(o.totalForeign, o.currency)}
                </Descriptions.Item>
              )}
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
                { title: 'Qty', align: 'right', render: (_, l) => (o.blindDelivery ? '—' : `${fmtQty(l.qty)} ${l.uom}`) },
                { title: isForeignCurrency(o.currency) ? `Harga (${o.currency})` : 'Harga', dataIndex: 'price', align: 'right', render: (v, l) => (isForeignCurrency(o.currency) ? fmtCurrency(l.priceForeign, o.currency) : fmtMoney(v)) },
                { title: 'Diskon', dataIndex: 'discountPct', align: 'right', render: (v) => `${Number(v)}%` },
                { title: 'Jumlah', dataIndex: 'lineTotal', align: 'right', render: fmtMoney },
              ]}
            />
            <Descriptions column={1} size="small" style={{ maxWidth: 360, marginLeft: 'auto', marginTop: 16 }} bordered>
              <Descriptions.Item label="Subtotal (DPP)">{fmtMoney(o.subtotal)}</Descriptions.Item>
              <Descriptions.Item label="PPN">{fmtMoney(o.taxAmount)}</Descriptions.Item>
              <Descriptions.Item label={isForeignCurrency(o.currency) ? 'Total (Rupiah)' : 'Total'}>
                <strong>{fmtMoney(o.total)}</strong>
              </Descriptions.Item>
              {isForeignCurrency(o.currency) && (
                <Descriptions.Item label={`Total (${o.currency})`}>
                  <strong>{fmtCurrency(o.totalForeign, o.currency)}</strong>
                </Descriptions.Item>
              )}
            </Descriptions>
          </>
        )}
      </Card>
      {id && <DocumentChain orderId={id} />}
      <Modal
        title="Batalkan pesanan yang sudah dikonfirmasi"
        open={cancelReason !== null}
        onCancel={() => setCancelReason(null)}
        onOk={() => cancel.mutate(cancelReason ?? '')}
        okButtonProps={{ danger: true, disabled: !isApprover && (cancelReason ?? '').trim().length < 5 }}
        confirmLoading={cancel.isPending}
        okText="Batalkan pesanan"
      >
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Pembatalan dicatat dan dikabarkan ke Pemilik, Admin, dan Gudang." />
        <Input.TextArea rows={3} placeholder="Alasan pembatalan (mis. pelanggan membatalkan)" value={cancelReason ?? ''} onChange={(e) => setCancelReason(e.target.value)} maxLength={300} />
      </Modal>
      <Modal
        title={o?.blindDelivery ? 'Kirim barang — isi jumlah yang Anda kemas' : 'Kirim sebagian — isi jumlah yang dikirim sekarang'}
        open={packing !== null}
        onCancel={() => setPacking(null)}
        onOk={() => o && deliver.mutate((o.lines ?? []).map((l) => ({ orderLineId: l.id, qty: String(packing?.[l.id] ?? 0) })), { onSuccess: () => setPacking(null) })}
        confirmLoading={deliver.isPending}
        okText="Kirim"
      >
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={o?.blindDelivery ? 'Hitung barang yang benar-benar Anda kemas. Bila tidak sama dengan sisa pesanan, pengiriman ditahan dan Penjualan diberi tahu.' : 'Pesanan tetap berstatus Dikonfirmasi sampai semua barang terkirim; faktur dibuat setelah semuanya terkirim.'} />
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={o?.lines}
          columns={[
            { title: t('Produk'), render: (_, l) => `${l.product.sku} · ${l.product.name}` },
            ...(o?.blindDelivery ? [] : [
              { title: 'Dipesan', align: 'right' as const, width: 90, render: (_: unknown, l: { qty: string }) => fmtQty(l.qty) },
              { title: 'Terkirim', align: 'right' as const, width: 90, render: (_: unknown, l: { deliveredQty?: string }) => fmtQty(l.deliveredQty ?? '0') },
            ]),
            { title: o?.blindDelivery ? 'Dikemas' : 'Kirim sekarang', align: 'right', width: 140, render: (_, l) => <InputNumber min={0} value={packing?.[l.id] ?? null} onChange={(v) => setPacking({ ...(packing ?? {}), [l.id]: v })} style={{ width: 110 }} /> },
          ]}
        />
      </Modal>
    </>
  );
}
