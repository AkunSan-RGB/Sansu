import { PrinterOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Space, Table, Tag } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import type { PurchaseInvoice, PurchaseOrder } from '@/api/types';
import PageHeader from '@/layout/PageHeader';
import { cell, DocHeader, head, PartyBlock, PrintSheet, Signatures, useLetterhead } from '@/components/print/Letterhead';
import { printDoc } from '@/lib/print';
import { fmtDate, fmtMoney, fmtQty, today } from '@/lib/format';
import { ReceiptStatusTag } from './GoodsReceiptsPage';
import { PurchaseOrderStatusTag } from '../sales/status';
import { t } from '@/lib/terms';

export default function PurchaseOrderDetailPage() {
  const lh = useLetterhead();
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
  const cancel = useAction(() => post(`/purchase-orders/${id}/cancel`), { success: 'PO dibatalkan', invalidate: refresh });
  const refreshAll = [...refresh, 'goods-receipts'];
  const both = useAction(
    (v: { supplierInvoiceNo: string; date: string; prices: { orderLineId: string; price: string }[] }) =>
      post<PurchaseInvoice & { journalNumber: string }>('/purchase-invoices', { supplierInvoiceNo: v.supplierInvoiceNo, date: v.date, prices: v.prices.length ? v.prices : undefined, purchaseOrderId: id }),
    { success: (r) => `Barang diterima · faktur ${r.number} · jurnal ${r.journalNumber}`, invalidate: refreshAll, onSuccess: () => setMode(null) },
  );
  const receive = useAction(
    (v: { date: string; supplierDeliveryNo?: string; lines: { orderLineId: string; qty: string }[] }) => post<{ number: string }>(`/purchase-orders/${id}/receipts`, v),
    { success: (r) => `Barang diterima · penerimaan ${r.number}`, invalidate: refreshAll, onSuccess: () => setMode(null) },
  );
  const bill = useAction(
    (v: { supplierInvoiceNo: string; date: string; lines: { orderLineId: string; qty: string }[]; prices: { orderLineId: string; price: string }[] }) =>
      post<PurchaseInvoice & { journalNumber: string }>('/purchase-invoices', { ...v, prices: v.prices.length ? v.prices : undefined, purchaseOrderId: id }),
    { success: (r) => `Faktur ${r.number} dicatat · jurnal ${r.journalNumber}`, invalidate: refreshAll, onSuccess: () => setMode(null) },
  );
  const left = (l: NonNullable<PurchaseOrder['lines']>[number]) => Math.max(0, Number(l.qty) - Number(l.receivedQty ?? 0));
  const open = (l: NonNullable<PurchaseOrder['lines']>[number]) => Math.max(0, Number(l.receivedQty ?? 0) - Number(l.billedQty ?? 0));
  const qtyFields = (pick: (l: NonNullable<PurchaseOrder['lines']>[number]) => number) => Object.fromEntries((o?.lines ?? []).map((l) => [`q_${l.id}`, pick(l)]));
  const linesPayload = (v: Record<string, string | number>) =>
    (o?.lines ?? []).map((l) => ({ orderLineId: l.id, qty: String(v[`q_${l.id}`] ?? 0) })).filter((l) => Number(l.qty) > 0);
  const priceFields = () => Object.fromEntries((o?.lines ?? []).map((l) => [`p_${l.id}`, Number(l.price)]));
  /** Hanya harga yang berbeda dari PO yang dikirim */
  const pricesPayload = (v: Record<string, string | number>, only?: { orderLineId: string }[]) =>
    (o?.lines ?? [])
      .filter((l) => v[`p_${l.id}`] != null && Number(v[`p_${l.id}`]) !== Number(l.price) && (!only || only.some((x) => x.orderLineId === l.id)))
      .map((l) => ({ orderLineId: l.id, price: String(v[`p_${l.id}`]) }));
  const canReceive = !!o && o.status === 'CONFIRMED' && (o.lines ?? []).some((l) => left(l) > 0.00005);
  const canBill = !!o && o.status === 'CONFIRMED' && (o.lines ?? []).some((l) => open(l) > 0.00005);
  const untouched = !!o && o.receiptStatus === 'NONE';

  return (
    <>
      <PageHeader
        title={o ? `Purchase Order ${o.number}` : 'Purchase Order'}
        extra={
          o && (
            <Space wrap>
              {o.status !== 'CANCELLED' && (
                <Button icon={<PrinterOutlined />} onClick={() => printDoc(`PO ${o.number}`)}>
                  Cetak PO / PDF
                </Button>
              )}
              {o.status === 'DRAFT' && (
                <Button type="primary" loading={confirm.isPending} onClick={() => confirm.mutate(undefined)}>
                  Konfirmasi
                </Button>
              )}
              {canReceive && (
                <Button
                  type="primary"
                  onClick={() => {
                    form.resetFields();
                    form.setFieldsValue({ supplierDeliveryNo: '', date: today(), ...qtyFields(left) });
                    setMode('receive');
                  }}
                >
                  Terima barang
                </Button>
              )}
              {canBill && (
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
              {o.status === 'CONFIRMED' && untouched && (
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
              {(o.status === 'DRAFT' || (o.status === 'CONFIRMED' && untouched)) && (
                <Popconfirm title="Batalkan PO ini?" onConfirm={() => cancel.mutate(undefined)}>
                  <Button danger>Batalkan</Button>
                </Popconfirm>
              )}
            </Space>
          )
        }
      />
      <Card loading={isLoading}>
        {o && (
          <>
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
                { title: 'Dipesan', align: 'right', render: (_, l) => `${fmtQty(l.qty)} ${l.uom}` },
                { title: 'Diterima', align: 'right', className: 'no-print', render: (_, l) => fmtQty(l.receivedQty ?? '0') },
                { title: 'Ditagih', align: 'right', className: 'no-print', render: (_, l) => fmtQty(l.billedQty ?? '0') },
                { title: 'Harga beli', dataIndex: 'price', align: 'right', render: fmtMoney },
                { title: 'Diskon', dataIndex: 'discountPct', align: 'right', render: (v) => `${Number(v)}%` },
                { title: 'Jumlah', dataIndex: 'lineTotal', align: 'right', render: fmtMoney },
              ]}
            />
            <Descriptions column={1} size="small" style={{ maxWidth: 360, marginLeft: 'auto', marginTop: 16 }} bordered>
              <Descriptions.Item label="Subtotal (DPP)">{fmtMoney(o.subtotal)}</Descriptions.Item>
              <Descriptions.Item label="PPN masukan">{fmtMoney(o.taxAmount)}</Descriptions.Item>
              <Descriptions.Item label="Total">
                <strong>{fmtMoney(o.total)}</strong>
              </Descriptions.Item>
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
        width={700}
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
            if (mode === 'both') both.mutate({ supplierInvoiceNo: String(v.supplierInvoiceNo), date: String(v.date), prices: pricesPayload(v) });
            else if (mode === 'receive') receive.mutate({ date: String(v.date), supplierDeliveryNo: v.supplierDeliveryNo ? String(v.supplierDeliveryNo) : undefined, lines: linesPayload(v) });
            else if (mode === 'bill') bill.mutate({ supplierInvoiceNo: String(v.supplierInvoiceNo), date: String(v.date), lines: linesPayload(v), prices: pricesPayload(v, linesPayload(v)) });
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
          {mode && (
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={o?.lines}
              columns={[
                { title: t('Produk'), render: (_, l) => `${l.product.sku} · ${l.product.name}` },
                ...(mode === 'both'
                  ? [{ title: 'Jumlah', align: 'right' as const, render: (_: unknown, l: NonNullable<PurchaseOrder['lines']>[number]) => `${fmtQty(String(l.qty))} ${l.uom}` }]
                  : [
                      { title: mode === 'receive' ? 'Sisa' : 'Siap ditagih', align: 'right' as const, render: (_: unknown, l: NonNullable<PurchaseOrder['lines']>[number]) => `${fmtQty(String(mode === 'receive' ? left(l) : open(l)))} ${l.uom}` },
                      {
                        title: mode === 'receive' ? 'Diterima kali ini' : 'Ditagih kali ini',
                        align: 'right' as const,
                        width: 140,
                        render: (_: unknown, l: NonNullable<PurchaseOrder['lines']>[number]) => (
                          <Form.Item name={`q_${l.id}`} noStyle>
                            <InputNumber min={0} max={mode === 'receive' ? left(l) : open(l)} disabled={(mode === 'receive' ? left(l) : open(l)) <= 0} style={{ width: 110 }} />
                          </Form.Item>
                        ),
                      },
                    ]),
                ...(mode !== 'receive'
                  ? [
                      { title: 'Harga PO', align: 'right' as const, render: (_: unknown, l: NonNullable<PurchaseOrder['lines']>[number]) => fmtMoney(l.price) },
                      {
                        title: 'Harga faktur',
                        align: 'right' as const,
                        width: 150,
                        render: (_: unknown, l: NonNullable<PurchaseOrder['lines']>[number]) => (
                          <Form.Item name={`p_${l.id}`} noStyle>
                            <InputNumber min={1} style={{ width: 130 }} />
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
                const v = form.getFieldsValue() as Record<string, number>;
                const diff = (o?.lines ?? []).reduce((a, l) => {
                  const q = mode === 'both' ? Number(l.qty) : Number(v[`q_${l.id}`] ?? 0);
                  return a + q * (Number(v[`p_${l.id}`] ?? l.price) - Number(l.price)) * (1 - Number(l.discountPct ?? 0) / 100);
                }, 0);
                return Math.abs(diff) < 0.005 ? (
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.65 }}>Ubah "Harga faktur" bila harga di faktur supplier berbeda dari PO — biaya perolehan persediaan mengikuti harga faktur.</div>
                ) : (
                  <Alert style={{ marginTop: 12 }} type={diff > 0 ? 'warning' : 'success'} showIcon message={`Faktur ${diff > 0 ? 'lebih mahal' : 'lebih murah'} ${fmtMoney(Math.abs(diff))} (sebelum PPN) dari PO. Nilai persediaan dan HPP disesuaikan otomatis.`} />
                );
              }}
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
