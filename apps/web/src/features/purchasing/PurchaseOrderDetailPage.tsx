import { PrinterOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Form, Input, Modal, Popconfirm, Space, Table } from 'antd';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post } from '@/api/client';
import { LEDGER_KEYS, useAction } from '@/api/queries';
import type { PurchaseInvoice, PurchaseOrder } from '@/api/types';
import PageHeader from '@/layout/PageHeader';
import { cell, DocHeader, head, PartyBlock, PrintSheet, Signatures, useLetterhead } from '@/components/print/Letterhead';
import { printDoc } from '@/lib/print';
import { fmtDate, fmtMoney, fmtQty, today } from '@/lib/format';
import { PurchaseOrderStatusTag } from '../sales/status';
import { t } from '@/lib/terms';

export default function PurchaseOrderDetailPage() {
  const lh = useLetterhead();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [receiving, setReceiving] = useState(false);
  const [form] = Form.useForm<{ supplierInvoiceNo: string; date: string }>();
  const { data: o, isLoading } = useQuery({
    queryKey: ['purchase-orders', 'detail', id],
    queryFn: () => get<PurchaseOrder>(`/purchase-orders/${id}`),
  });
  const refresh = ['purchase-orders', 'purchase-invoices', 'stock', 'stock-moves', 'suppliers', ...LEDGER_KEYS];

  const confirm = useAction(() => post(`/purchase-orders/${id}/confirm`), { success: 'PO dikonfirmasi — siap dikirim ke supplier', invalidate: refresh });
  const cancel = useAction(() => post(`/purchase-orders/${id}/cancel`), { success: 'PO dibatalkan', invalidate: refresh });
  const receive = useAction(
    (v: { supplierInvoiceNo: string; date: string }) =>
      post<PurchaseInvoice & { journalNumber: string }>('/purchase-invoices', { ...v, purchaseOrderId: id }),
    {
      success: (r) => `Barang diterima · faktur ${r.number} · jurnal ${r.journalNumber}`,
      invalidate: refresh,
      onSuccess: () => setReceiving(false),
    },
  );

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
              {o.status === 'CONFIRMED' && (
                <Button
                  type="primary"
                  onClick={() => {
                    form.setFieldsValue({ supplierInvoiceNo: '', date: today() });
                    setReceiving(true);
                  }}
                >
                  Terima barang & faktur
                </Button>
              )}
              {(o.status === 'DRAFT' || o.status === 'CONFIRMED') && (
                <Popconfirm title="Batalkan PO ini?" onConfirm={() => cancel.mutate(undefined)}>
                  <Button danger>Batalkan</Button>
                </Popconfirm>
              )}
              {o.invoice && <Button onClick={() => navigate('/purchase-invoices')}>Lihat faktur {o.invoice.number}</Button>}
            </Space>
          )
        }
      />
      <Card loading={isLoading}>
        {o && (
          <>
            <Descriptions bordered size="small" column={{ xs: 1, md: 2 }} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Supplier">
                {o.supplier.code} · {o.supplier.name}
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                <PurchaseOrderStatusTag status={o.status} />
              </Descriptions.Item>
              <Descriptions.Item label="Tanggal">{fmtDate(o.date)}</Descriptions.Item>
              <Descriptions.Item label="Gudang penerima">{o.warehouse?.name}</Descriptions.Item>
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
                    <PartyBlock label="Kepada (supplier)" name={o.supplier.name} lines={[o.supplier.address, o.supplier.phone && `Telp. ${o.supplier.phone}`]} />
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
        title="Terima barang & catat faktur supplier"
        open={receiving}
        onCancel={() => setReceiving(false)}
        onOk={() => form.submit()}
        confirmLoading={receive.isPending}
        okText="Posting"
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Stok bertambah di gudang penerima dan HPP rata-rata diperbarui. Jurnal: Persediaan + PPN Masukan (debit) / Hutang Usaha (kredit)."
        />
        <Form form={form} layout="vertical" onFinish={(v) => receive.mutate(v)}>
          <Form.Item name="supplierInvoiceNo" label="Nomor faktur dari supplier" rules={[{ required: true }]}>
            <Input placeholder="INV/SPP/2026/0912" />
          </Form.Item>
          <Form.Item name="date" label="Tanggal terima" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
