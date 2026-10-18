import { PrinterOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Space, Table, Tag, Select } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import { useCan } from '@/auth/useCan';
import { useAuth } from '@/auth/AuthContext';
import type { PurchaseInvoice, PurchaseOrder } from '@/api/types';
import PageHeader from '@/layout/PageHeader';
import { cell, DocHeader, head, PartyBlock, PrintSheet, Signatures, useLetterhead } from '@/components/print/Letterhead';
import { VARIANCE_REASONS } from './PriceVarianceReport';
import { printDoc } from '@/lib/print';
import { isForeignCurrency } from '@sansu/shared';
import { fmtCurrency, fmtDate, fmtMoney, fmtQty, fmtRate, today } from '@/lib/format';
import { ReceiptStatusTag } from './GoodsReceiptsPage';
import { PurchaseOrderStatusTag } from '../sales/status';
import { t } from '@/lib/terms';
import WorkflowBadge from '@/features/workflow/WorkflowBadge';

/** Lot dan tanggal kedaluwarsa per baris (opsional; dipantau di Persediaan › Kedaluwarsa bahan) */
interface LotPayload {
  orderLineId: string;
  lotNo?: string;
  expiryDate?: string;
}

export default function PurchaseOrderDetailPage() {
  const lh = useLetterhead();
  const can = useCan();
  const { me } = useAuth();
  const isApprover = !!me && ['OWNER', 'ADMIN'].includes(me.role);
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const { id } = useParams<{ id: string }>();
  /** both = terima dan faktur sekaligus (satu jurnal); receive = terima barang saja; bill = faktur atas barang yang sudah diterima */
  const [mode, setMode] = useState<'both' | 'receive' | 'bill' | null>(null);
  const [form] = Form.useForm<Record<string, string | number>>();
  const { data: o, isLoading } = useQuery({
    queryKey: ['purchase-orders', 'detail', id],
    queryFn: () => get<PurchaseOrder>(`/purchase-orders/${id}`),
  });
  const refresh = ['purchase-orders', 'purchase-invoices', 'stock', 'stock-moves', 'suppliers', ...LEDGER_KEYS];

  const confirm = useAction(() => post(`/purchase-orders/${id}/confirm`), { success: 'PO dikonfirmasi — siap dikirim ke supplier', invalidate: refresh });
  const cancel = useAction((reason?: string) => post(`/purchase-orders/${id}/cancel`, { reason }), { success: 'PO dibatalkan', invalidate: refresh, onSuccess: () => setCancelReason(null) });
  const refreshAll = [...refresh, 'goods-receipts', 'approvals'];
  const both = useAction(
    (v: { supplierInvoiceNo: string; date: string; fxRate?: string; prices: { orderLineId: string; price: string }[]; lots?: LotPayload[]; varianceReason?: string; varianceNote?: string }) =>
      post<PurchaseInvoice & { journalNumber: string }>('/purchase-invoices', { supplierInvoiceNo: v.supplierInvoiceNo, date: v.date, fxRate: v.fxRate, lots: v.lots?.length ? v.lots : undefined, prices: v.prices.length ? v.prices : undefined, varianceReason: v.prices.length ? v.varianceReason : undefined, varianceNote: v.prices.length ? v.varianceNote : undefined, purchaseOrderId: id }),
    { success: (r) => `Barang diterima · faktur ${r.number} · jurnal ${r.journalNumber}`, invalidate: refreshAll, onSuccess: () => setMode(null) },
  );
  const receive = useAction(
    (v: { date: string; supplierDeliveryNo?: string; lines: ({ orderLineId: string; qty: string } & Partial<LotPayload>)[] }) => post<{ number: string }>(`/purchase-orders/${id}/receipts`, v),
    { success: (r) => `Barang diterima · penerimaan ${r.number}`, invalidate: refreshAll, onSuccess: () => setMode(null) },
  );
  const bill = useAction(
    (v: { supplierInvoiceNo: string; date: string; fxRate?: string; lines: { orderLineId: string; qty: string }[]; prices: { orderLineId: string; price: string }[]; varianceReason?: string; varianceNote?: string }) =>
      post<PurchaseInvoice & { journalNumber: string }>('/purchase-invoices', { ...v, prices: v.prices.length ? v.prices : undefined, varianceReason: v.prices.length ? v.varianceReason : undefined, varianceNote: v.prices.length ? v.varianceNote : undefined, purchaseOrderId: id }),
    { success: (r) => `Faktur ${r.number} dicatat · jurnal ${r.journalNumber}`, invalidate: refreshAll, onSuccess: () => setMode(null) },
  );
  const left = (l: NonNullable<PurchaseOrder['lines']>[number]) => Math.max(0, Number(l.qty) - Number(l.receivedQty ?? 0));
  const open = (l: NonNullable<PurchaseOrder['lines']>[number]) => Math.max(0, Number(l.receivedQty ?? 0) - Number(l.billedQty ?? 0));
  const qtyFields = (pick: (l: NonNullable<PurchaseOrder['lines']>[number]) => number) => Object.fromEntries((o?.lines ?? []).map((l) => [`q_${l.id}`, pick(l)]));
  const linesPayload = (v: Record<string, string | number>) =>
    (o?.lines ?? []).map((l) => ({ orderLineId: l.id, qty: String(v[`q_${l.id}`] ?? 0) })).filter((l) => Number(l.qty) > 0);
  const lotOf = (v: Record<string, string | number>, id: string): Partial<LotPayload> => ({ lotNo: v[`lot_${id}`] ? String(v[`lot_${id}`]).trim() : undefined, expiryDate: v[`exp_${id}`] ? String(v[`exp_${id}`]) : undefined });
  const lotsPayload = (v: Record<string, string | number>, only?: { orderLineId: string }[]): LotPayload[] =>
    (o?.lines ?? []).filter((l) => !only || only.some((x) => x.orderLineId === l.id)).map((l) => ({ orderLineId: l.id, ...lotOf(v, l.id) })).filter((l) => l.lotNo || l.expiryDate);
  const foreign = isForeignCurrency(o?.currency);
  const cur = o?.currency ?? 'IDR';
  /** Harga PO per baris dalam mata uang PO (valas) atau Rupiah */
  const poPrice = (l: NonNullable<PurchaseOrder['lines']>[number]) => Number(foreign ? l.priceForeign : l.price);
  const money = (v: number | string | null | undefined) => (foreign ? fmtCurrency(v, cur) : fmtMoney(v));
  const priceFields = () => ({ ...Object.fromEntries((o?.lines ?? []).map((l) => [`p_${l.id}`, poPrice(l)])), ...(foreign ? { fxRate: Number(o?.fxRate) } : {}) });
  // Kurs faktur terisi dari kurs tersimpan pada tanggal faktur (kosong: kurs PO); boleh diketik sendiri
  const invDate = Form.useWatch('date', form);
  useEffect(() => {
    if (!mode || mode === 'receive' || !foreign) return;
    let cancelled = false;
    get<{ rate: string | null }>(`/fx/rate?currency=${cur}${invDate ? `&date=${invDate}` : ''}`)
      .then((r) => !cancelled && form.setFieldValue('fxRate', Number(r.rate ?? o?.fxRate)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mode, foreign, cur, invDate, form, o?.fxRate]);
  /** Hanya harga yang berbeda dari PO yang dikirim */
  const pricesPayload = (v: Record<string, string | number>, only?: { orderLineId: string }[]) =>
    (o?.lines ?? [])
      .filter((l) => v[`p_${l.id}`] != null && Number(v[`p_${l.id}`]) !== poPrice(l) && (!only || only.some((x) => x.orderLineId === l.id)))
      .map((l) => ({ orderLineId: l.id, price: String(v[`p_${l.id}`]) }));
  /** Penerimaan buta: jumlah pesanan disembunyikan dari Gudang; Gudang mengisi hasil hitungannya sendiri */
  const blind = !!o?.blindReceiving;
  const canReceive = !!o && o.status === 'CONFIRMED' && (blind ? o.receiptStatus !== 'FULL' : (o.lines ?? []).some((l) => left(l) > 0.00005));
  const canBill = !!o && o.status === 'CONFIRMED' && (o.lines ?? []).some((l) => open(l) > 0.00005);
  const untouched = !!o && o.receiptStatus === 'NONE';

  return (
    <>
      <PageHeader
        title={<Space wrap>{o ? `Purchase Order ${o.number}` : 'Purchase Order'}{o && <WorkflowBadge type="PURCHASE_ORDER" id={o.id} />}</Space>}
        extra={
          o && (
            <Space wrap>
              {o.status !== 'CANCELLED' && (
                <Button icon={<PrinterOutlined />} onClick={() => printDoc(`PO ${o.number}`)}>
                  Cetak PO / PDF
                </Button>
              )}
              {o.status === 'DRAFT' && can('POST', '/purchase-orders/:id/confirm') && (
                <Button type="primary" loading={confirm.isPending} onClick={() => confirm.mutate(undefined)}>
                  Konfirmasi
                </Button>
              )}
              {canReceive && can('POST', '/purchase-orders/:id/receipts') && (
                <Button
                  type="primary"
                  onClick={() => {
                    form.resetFields();
                    form.setFieldsValue({ supplierDeliveryNo: '', date: today(), ...(blind ? {} : qtyFields(left)) });
                    setMode('receive');
                  }}
                >
                  Terima barang
                </Button>
              )}
              {canBill && can('POST', '/purchase-invoices') && (
                <Button
                  type={canReceive ? 'default' : 'primary'}
                  onClick={() => {
                    form.resetFields();
                    form.setFieldsValue({ supplierInvoiceNo: '', date: today(), ...qtyFields(open), ...priceFields() });
                    setMode('bill');
                  }}
                >
                  Catat faktur supplier
                </Button>
              )}
              {o.status === 'CONFIRMED' && untouched && isApprover && can('POST', '/purchase-invoices') && (
                <Button
                  onClick={() => {
                    form.resetFields();
                    form.setFieldsValue({ supplierInvoiceNo: '', date: today(), ...priceFields() });
                    setMode('both');
                  }}
                >
                  Terima & faktur sekaligus
                </Button>
              )}
              {(o.status === 'DRAFT' || (o.status === 'CONFIRMED' && untouched)) && can('POST', '/purchase-orders/:id/cancel') &&
                (o.status === 'DRAFT' ? (
                  <Popconfirm title="Batalkan PO ini?" onConfirm={() => cancel.mutate(undefined)}>
                    <Button danger>Batalkan</Button>
                  </Popconfirm>
                ) : (
                  <Button danger onClick={() => setCancelReason('')}>
                    Batalkan
                  </Button>
                ))}
            </Space>
          )
        }
      />
      <Card loading={isLoading}>
        {o && (
          <>
            {o.priceEstimate && o.status !== 'BILLED' && o.status !== 'CANCELLED' && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="Harga di PO ini estimasi (dari penawaran supplier). Saat faktur tiba, isi “Harga faktur” — biaya perolehan persediaan mengikuti faktur."
              />
            )}
            <Descriptions bordered size="small" column={{ xs: 1, md: 2 }} style={{ marginBottom: 16 }}>
              <Descriptions.Item label={t('Supplier')}>
                {o.supplier.code} · {o.supplier.name}
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                <PurchaseOrderStatusTag status={o.status} />
              </Descriptions.Item>
              <Descriptions.Item label="Tanggal">{fmtDate(o.date)}</Descriptions.Item>
              <Descriptions.Item label={t('Gudang penerima')}>{o.warehouse?.name}</Descriptions.Item>
              {o.status === 'CONFIRMED' && (
                <Descriptions.Item label="Kemajuan">
                  <Space wrap>
                    <Tag color={o.receiptStatus === 'FULL' ? 'green' : o.receiptStatus === 'PARTIAL' ? 'gold' : 'default'}>
                      Barang: {o.receiptStatus === 'FULL' ? 'diterima semua' : o.receiptStatus === 'PARTIAL' ? 'diterima sebagian' : 'belum diterima'}
                    </Tag>
                    <Tag color={o.billingStatus === 'FULL' ? 'green' : o.billingStatus === 'PARTIAL' ? 'gold' : 'default'}>
                      Faktur: {o.billingStatus === 'FULL' ? 'lengkap' : o.billingStatus === 'PARTIAL' ? 'sebagian' : 'belum ada'}
                    </Tag>
                  </Space>
                </Descriptions.Item>
              )}
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
                { title: 'Dipesan', align: 'right', render: (_, l) => (blind ? '—' : `${fmtQty(l.qty)} ${l.uom}`) },
                { title: 'Diterima', align: 'right', className: 'no-print', render: (_, l) => fmtQty(l.receivedQty ?? '0') },
                { title: 'Ditagih', align: 'right', className: 'no-print', render: (_, l) => fmtQty(l.billedQty ?? '0') },
                { title: isForeignCurrency(o.currency) ? `Harga beli (${o.currency})` : 'Harga beli', dataIndex: 'price', align: 'right', render: (v, l) => (isForeignCurrency(o.currency) ? fmtCurrency(l.priceForeign, o.currency) : fmtMoney(v)) },
                { title: 'Diskon', dataIndex: 'discountPct', align: 'right', render: (v) => `${Number(v)}%` },
                { title: 'Jumlah', dataIndex: 'lineTotal', align: 'right', render: fmtMoney },
              ]}
            />
            <Descriptions column={1} size="small" style={{ maxWidth: 360, marginLeft: 'auto', marginTop: 16 }} bordered>
              <Descriptions.Item label="Subtotal (DPP)">{fmtMoney(o.subtotal)}</Descriptions.Item>
              <Descriptions.Item label="PPN masukan">{fmtMoney(o.taxAmount)}</Descriptions.Item>
              <Descriptions.Item label={isForeignCurrency(o.currency) ? 'Total (Rupiah)' : 'Total'}>
                <strong>{fmtMoney(o.total)}</strong>
              </Descriptions.Item>
              {isForeignCurrency(o.currency) && (
                <Descriptions.Item label={`Total (${o.currency})`}>
                  <strong>{fmtCurrency(o.totalForeign, o.currency)}</strong>
                </Descriptions.Item>
              )}
            </Descriptions>
            {(!!o.receipts?.length || !!o.invoices?.length) && (
              <Card size="small" title="Dokumen terkait" className="no-print" style={{ marginTop: 16 }}>
                <Space align="start" size={32} wrap>
                  <div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>Penerimaan barang</div>
                    {o.receipts?.length ? (
                      o.receipts.map((r) => (
                        <div key={r.id}>
                          <Link to={`/goods-receipts/${r.id}`}>{r.number}</Link> <span style={{ color: '#64748b' }}>{fmtDate(r.date)}</span> <ReceiptStatusTag r={r} />
                        </div>
                      ))
                    ) : (
                      <span style={{ color: '#94a3b8' }}>Belum ada</span>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>Faktur supplier</div>
                    {o.invoices?.length ? (
                      o.invoices.map((i) => (
                        <div key={i.id}>
                          <Link to="/purchase-invoices">{i.number}</Link> <span style={{ color: '#64748b' }}>{i.supplierInvoiceNo} · {fmtMoney(i.total)}</span>
                        </div>
                      ))
                    ) : (
                      <span style={{ color: '#94a3b8' }}>Belum ada</span>
                    )}
                  </div>
                </Space>
              </Card>
            )}
            <div className="doc-print-only">
              <PrintSheet>
                <DocHeader
                  title="PURCHASE ORDER"
                  meta={[
                    ['No.', o.number],
                    ['Tanggal', fmtDate(o.date)],
                  ]}
                />
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1 }}>
                    <PartyBlock label={t('Kepada (supplier)')} name={o.supplier.name} lines={[o.supplier.address, o.supplier.phone && `Telp. ${o.supplier.phone}`]} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <PartyBlock label="Kirim ke" name={o.warehouse?.name ?? ''} lines={[o.warehouse?.address]} />
                  </div>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ ...head, width: 36 }}>No</th>
                      <th style={head}>Barang</th>
                      <th style={{ ...head, textAlign: 'right' }}>Qty</th>
                      <th style={{ ...head, textAlign: 'right' }}>Harga</th>
                      <th style={{ ...head, textAlign: 'right' }}>Disk.</th>
                      <th style={{ ...head, textAlign: 'right' }}>Jumlah</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.lines?.map((l, i) => (
                      <tr key={l.id}>
                        <td style={cell}>{i + 1}</td>
                        <td style={cell}>
                          {l.product.name}
                          <div style={{ color: '#94a3b8', fontSize: 11 }}>{l.product.sku}</div>
                        </td>
                        <td style={{ ...cell, textAlign: 'right' }}>
                          {fmtQty(l.qty)} {l.uom}
                        </td>
                        <td style={{ ...cell, textAlign: 'right' }}>{fmtMoney(l.price)}</td>
                        <td style={{ ...cell, textAlign: 'right' }}>{Number(l.discountPct) ? `${Number(l.discountPct)}%` : '-'}</td>
                        <td style={{ ...cell, textAlign: 'right' }}>{fmtMoney(l.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <table style={{ marginLeft: 'auto', marginTop: 12, minWidth: 260, fontSize: 13 }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: 4 }}>Subtotal</td>
                      <td style={{ padding: 4, textAlign: 'right' }}>{fmtMoney(o.subtotal)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: 4 }}>PPN</td>
                      <td style={{ padding: 4, textAlign: 'right' }}>{fmtMoney(o.taxAmount)}</td>
                    </tr>
                    <tr style={{ fontWeight: 700, fontSize: 15 }}>
                      <td style={{ padding: 4, borderTop: '2px solid #333' }}>Total</td>
                      <td style={{ padding: 4, borderTop: '2px solid #333', textAlign: 'right' }}>{fmtMoney(o.total)}</td>
                    </tr>
                  </tbody>
                </table>
                {o.notes && <div style={{ marginTop: 12, fontSize: 13, whiteSpace: 'pre-line' }}>Catatan: {o.notes}</div>}
                <Signatures labels={[['Disetujui supplier,'], ['Hormat kami,', lh.data?.name]]} />
              </PrintSheet>
            </div>
          </>
        )}
      </Card>

      <Modal
        title={mode === 'receive' ? 'Terima barang' : mode === 'bill' ? t('Catat faktur supplier') : t('Terima barang & catat faktur supplier')}
        open={!!mode}
        onCancel={() => setMode(null)}
        onOk={() => form.submit()}
        confirmLoading={both.isPending || receive.isPending || bill.isPending}
        okText="Posting"
        width={900}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            mode === 'receive'
              ? 'Stok bertambah di gudang penerima. Nilainya ditampung di "Barang Diterima Belum Ditagih" sampai faktur supplier dicatat. Boleh menerima sebagian dulu.'
              : mode === 'bill'
                ? 'Faktur menagih barang yang sudah diterima. Boleh sebagian sesuai faktur supplier. Jurnal: Barang Diterima Belum Ditagih + PPN Masukan (debit) / Hutang Usaha (kredit).'
                : t('Stok bertambah di gudang penerima dan HPP rata-rata diperbarui. Jurnal: Persediaan + PPN Masukan (debit) / Hutang Usaha (kredit).')
          }
        />
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => {
            const fxRate = foreign && v.fxRate ? String(v.fxRate) : undefined;
            if (mode === 'both') both.mutate({ supplierInvoiceNo: String(v.supplierInvoiceNo), date: String(v.date), fxRate, prices: pricesPayload(v), lots: lotsPayload(v), varianceReason: v.varianceReason ? String(v.varianceReason) : undefined, varianceNote: v.varianceNote ? String(v.varianceNote) : undefined });
            else if (mode === 'receive') receive.mutate({ date: String(v.date), supplierDeliveryNo: v.supplierDeliveryNo ? String(v.supplierDeliveryNo) : undefined, lines: linesPayload(v).map((l) => ({ ...l, ...lotOf(v, l.orderLineId) })) });
            else if (mode === 'bill') bill.mutate({ supplierInvoiceNo: String(v.supplierInvoiceNo), date: String(v.date), fxRate, lines: linesPayload(v), prices: pricesPayload(v, linesPayload(v)), varianceReason: v.varianceReason ? String(v.varianceReason) : undefined, varianceNote: v.varianceNote ? String(v.varianceNote) : undefined });
          }}
        >
          {mode !== 'receive' && (
            <Form.Item name="supplierInvoiceNo" label={t('Nomor faktur dari supplier')} rules={[{ required: true }]}>
              <Input placeholder="INV/SPP/2026/0912" />
            </Form.Item>
          )}
          {mode === 'receive' && (
            <Form.Item name="supplierDeliveryNo" label="Nomor surat jalan supplier (opsional)">
              <Input />
            </Form.Item>
          )}
          <Form.Item name="date" label={mode === 'bill' ? 'Tanggal faktur' : 'Tanggal terima'} rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
          {foreign && mode !== 'receive' && (
            <Form.Item
              name="fxRate"
              label={`Kurs faktur (Rp per 1 ${cur})`}
              extra={`Kurs PO ${fmtRate(o?.fxRate)}. Terisi dari kurs tersimpan pada tanggal faktur; ubah bila faktur supplier memakai kurs lain. Selisih kurs terhadap PO menambah/mengurangi biaya perolehan.`}
              rules={[{ required: true, message: 'Isi kurs' }]}
            >
              <InputNumber min={0.000001} style={{ width: '100%' }} prefix="Rp" />
            </Form.Item>
          )}
          {mode && (
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              scroll={{ x: 'max-content' }}
              dataSource={o?.lines}
              columns={[
                { title: t('Produk'), render: (_, l) => `${l.product.sku} · ${l.product.name}` },
                ...(mode === 'both'
                  ? [{ title: 'Jumlah', align: 'right' as const, render: (_: unknown, l: NonNullable<PurchaseOrder['lines']>[number]) => `${fmtQty(String(l.qty))} ${l.uom}` }]
                  : [
                      { title: mode === 'receive' ? 'Sisa' : 'Siap ditagih', align: 'right' as const, render: (_: unknown, l: NonNullable<PurchaseOrder['lines']>[number]) => (blind && mode === 'receive' ? '—' : `${fmtQty(String(mode === 'receive' ? left(l) : open(l)))} ${l.uom}`) },
                      {
                        title: mode === 'receive' ? 'Diterima kali ini' : 'Ditagih kali ini',
                        align: 'right' as const,
                        width: 140,
                        render: (_: unknown, l: NonNullable<PurchaseOrder['lines']>[number]) => (
                          <Form.Item name={`q_${l.id}`} noStyle>
                            <InputNumber min={0} max={blind && mode === 'receive' ? undefined : mode === 'receive' ? left(l) : open(l)} disabled={!(blind && mode === 'receive') && (mode === 'receive' ? left(l) : open(l)) <= 0} style={{ width: 110 }} />
                          </Form.Item>
                        ),
                      },
                    ]),
                ...(mode !== 'bill'
                  ? [
                      {
                        title: 'Lot (opsional)',
                        width: 120,
                        render: (_: unknown, l: NonNullable<PurchaseOrder['lines']>[number]) => (
                          <Form.Item name={`lot_${l.id}`} noStyle>
                            <Input placeholder="No. lot" maxLength={40} style={{ width: 100 }} />
                          </Form.Item>
                        ),
                      },
                      {
                        title: 'Kedaluwarsa (opsional)',
                        width: 150,
                        render: (_: unknown, l: NonNullable<PurchaseOrder['lines']>[number]) => (
                          <Form.Item name={`exp_${l.id}`} noStyle>
                            <Input type="date" min={today()} style={{ width: 140 }} />
                          </Form.Item>
                        ),
                      },
                    ]
                  : []),
                ...(mode !== 'receive'
                  ? [
                      { title: foreign ? `Harga PO (${cur})` : 'Harga PO', align: 'right' as const, render: (_: unknown, l: NonNullable<PurchaseOrder['lines']>[number]) => money(foreign ? l.priceForeign : l.price) },
                      {
                        title: foreign ? `Harga faktur (${cur})` : 'Harga faktur',
                        align: 'right' as const,
                        width: 150,
                        render: (_: unknown, l: NonNullable<PurchaseOrder['lines']>[number]) => (
                          <Form.Item name={`p_${l.id}`} noStyle>
                            <InputNumber min={foreign ? 0.0001 : 1} precision={foreign ? 4 : undefined} style={{ width: 130 }} />
                          </Form.Item>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          )}
          {mode && mode !== 'receive' && (
            <Form.Item noStyle shouldUpdate>
              {() => {
                const v = form.getFieldsValue() as Record<string, number | string>;
                const diff = (o?.lines ?? []).reduce((a, l) => {
                  const q = mode === 'both' ? Number(l.qty) : Number(v[`q_${l.id}`] ?? 0);
                  return a + q * (Number(v[`p_${l.id}`] ?? poPrice(l)) - poPrice(l)) * (1 - Number(l.discountPct ?? 0) / 100);
                }, 0);
                // selisih kurs antara PO dan faktur atas nilai valas yang ditagih (Rupiah)
                const poRate = Number(o?.fxRate ?? 1);
                const rateDiff = foreign
                  ? (o?.lines ?? []).reduce((a, l) => a + (mode === 'both' ? Number(l.qty) : Number(v[`q_${l.id}`] ?? 0)) * Number(v[`p_${l.id}`] ?? poPrice(l)) * (1 - Number(l.discountPct ?? 0) / 100) * (Number(v.fxRate ?? poRate) - poRate), 0)
                  : 0;
                return Math.abs(diff) < 0.005 && Math.abs(rateDiff) < 0.5 ? (
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.65 }}>Ubah "Harga faktur"{foreign ? ' dan kurs' : ''} bila faktur supplier berbeda dari PO — biaya perolehan persediaan mengikuti faktur.</div>
                ) : (
                  <>
                    {Math.abs(rateDiff) >= 0.5 && (
                      <Alert style={{ marginTop: 12 }} type="info" showIcon message={`Selisih kurs terhadap PO: ${rateDiff > 0 ? '+' : '−'}${fmtMoney(Math.abs(rateDiff))} (sebelum PPN) — ${rateDiff > 0 ? 'menambah' : 'mengurangi'} biaya perolehan. Kurs faktur jauh di atas kurs pasar perlu persetujuan pemilik/admin.`} />
                    )}
                    {Math.abs(diff) >= 0.005 && <Alert style={{ marginTop: 12 }} type={diff > 0 ? 'warning' : 'success'} showIcon message={`Faktur ${diff > 0 ? 'lebih mahal' : 'lebih murah'} ${money(Math.abs(diff))} (sebelum PPN) dari PO. Nilai persediaan dan HPP disesuaikan otomatis.${diff > 0 ? ' Kenaikan di atas toleransi atau jauh di atas harga pasar perlu persetujuan pemilik/admin.' : ''}`} />}
                    {Math.abs(diff) >= 0.005 && (
                    <Form.Item name="varianceReason" label="Alasan selisih harga (tercatat untuk audit)" rules={[{ required: true, message: 'Pilih alasan' }]} style={{ marginTop: 12 }}>
                      <Select options={Object.entries(VARIANCE_REASONS).map(([value, label]) => ({ value, label }))} placeholder="Pilih alasan" />
                    </Form.Item>
                    )}
                    {Math.abs(diff) >= 0.005 && v.varianceReason === 'OTHER' && (
                      <Form.Item name="varianceNote" label="Jelaskan" rules={[{ required: true, min: 5, message: 'Jelaskan alasannya (min. 5 huruf)' }]}>
                        <Input.TextArea rows={2} maxLength={300} />
                      </Form.Item>
                    )}
                  </>
                );
              }}
            </Form.Item>
          )}
        </Form>
      </Modal>
      <Modal
        title="Batalkan PO yang sudah dikonfirmasi"
        open={cancelReason !== null}
        onCancel={() => setCancelReason(null)}
        onOk={() => cancel.mutate(cancelReason ?? '')}
        okButtonProps={{ danger: true, disabled: !isApprover && (cancelReason ?? '').trim().length < 5 }}
        confirmLoading={cancel.isPending}
        okText="Batalkan PO"
      >
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="PO yang sudah dikonfirmasi tidak dapat diubah. Pembatalan dicatat dan dikabarkan ke Pemilik, Admin, dan Gudang." />
        <Input.TextArea rows={3} placeholder="Alasan pembatalan (mis. pemasok kehabisan stok)" value={cancelReason ?? ''} onChange={(e) => setCancelReason(e.target.value)} maxLength={300} />
      </Modal>
    </>
  );
}
