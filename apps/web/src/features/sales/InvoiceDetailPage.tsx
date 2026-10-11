import { ArrowLeftOutlined, DollarOutlined, MailOutlined, PrinterOutlined, WhatsAppOutlined } from '@ant-design/icons';
import { isForeignCurrency, PAYMENT_METHOD_LABELS, type InvoiceDetail } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Segmented, Space, Table, Tag, Tooltip } from 'antd';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import { cell, DocHeader, head, PartyBlock, PrintSheet, Signatures, useLetterhead } from '@/components/print/Letterhead';
import QueryState from '@/components/QueryState';
import PageHeader from '@/layout/PageHeader';
import { fmtCurrency, fmtDate, fmtMoney, fmtQty, fmtRate, today } from '@/lib/format';
import DocumentChain from '@/components/DocumentChain';
import { printDoc } from '@/lib/print';
import { terbilang } from '@/lib/terbilang';
import { hasPhone, invoiceMessage, waLink } from '@/lib/wa';
import PaymentModal, { outstanding } from './PaymentModal';
import { ApplyDepositModal } from '../services/DepositsPage';
import { InvoiceStatusTag } from './status';
import { t } from '@/lib/terms';

type Detail = InvoiceDetail & {
  customerId: string;
  customer: { code: string; name: string; address: string | null; phone: string | null; npwp: string | null };
  salesOrder: { number: string } | null;
  payments: { id: string; number: string; date: string; amount: string; method: string; notes: string | null; currency?: string; amountForeign?: string | null; cashAmount?: string | null; fxRate?: string | null; fxGainLoss?: string }[];
};

const right = { ...cell, textAlign: 'right' as const };

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const lh = useLetterhead();
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => get<Detail>(`/invoices/${id}`) });
  const [doc, setDoc] = useState<'invoice' | 'delivery'>('invoice');
  const [paying, setPaying] = useState(false);
  const [applying, setApplying] = useState(false);
  const inv = q.data;
  const emailReminder = useAction(() => post<{ to: string }>(`/reminders/invoices/${id}/customer`), { success: (r) => `Pengingat dikirim ke ${r.to}` });
  const service = inv?.kind === 'SERVICE';
  const wh = Number(inv?.withholdingAmount ?? 0);
  const dep = Number(inv?.depositApplied ?? 0);
  const rest = inv ? outstanding(inv) : 0;
  const overdue = !!inv && inv.status !== 'PAID' && inv.dueDate < today();
  const disc = inv?.lines.some((l) => Number(l.discountPct)) ?? false;
  // Faktur valas: tampilan/cetak memakai mata uang faktur; nilai Rupiah ditampilkan sebagai setara pada kurs faktur
  const cur = inv?.currency ?? 'IDR';
  const foreign = isForeignCurrency(cur);
  const fc = (v: string | number | null | undefined) => fmtCurrency(v, cur);
  const lineForeign = (l: { qty: string; priceForeign?: string | null; discountPct: string }) => Math.round(Number(l.qty) * Number(l.priceForeign ?? 0) * (100 - Number(l.discountPct))) / 100;
  const subForeign = foreign && inv ? inv.lines.reduce((a, l) => a + lineForeign(l), 0) : 0;
  const totalForeign = Number(inv?.totalForeign ?? 0);
  const restForeign = foreign && inv ? totalForeign - Number(inv.paidForeign ?? 0) : 0;

  const wa =
    inv &&
    waLink(
      inv.customer.phone,
      invoiceMessage({
        customer: inv.customer.name,
        number: inv.number,
        date: inv.date,
        dueDate: inv.dueDate,
        total: inv.total,
        outstanding: rest,
        company: lh.data?.name ?? '',
        bankInfo: lh.data?.bankInfo,
        overdue,
      }),
    );

  return (
    <>
      <PageHeader
        title={
          <Space wrap>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/invoices')} aria-label="Kembali" />
            {inv ? `Faktur ${inv.number}` : 'Faktur'}
            {inv && <InvoiceStatusTag status={inv.status} />}
            {inv?.isOpening && <Tag color="gold">Saldo awal</Tag>}
          </Space>
        }
        extra={
          inv && (
            <Space wrap className="no-print">
              {!inv.isOpening && !service && (
                <Segmented
                  value={doc}
                  onChange={(v) => setDoc(v as typeof doc)}
                  options={[
                    { value: 'invoice', label: t('Faktur') },
                    { value: 'delivery', label: 'Surat jalan' },
                  ]}
                />
              )}
              <Button icon={<PrinterOutlined />} onClick={() => printDoc(`${doc === 'invoice' ? 'Faktur' : 'Surat Jalan'} ${inv.number}`)}>
                Cetak / PDF
              </Button>
              <Tooltip title={hasPhone(inv.customer.phone) ? 'Kirim tagihan lewat WhatsApp (lampirkan PDF bila perlu)' : 'Nomor HP pelanggan belum diisi'}>
                <Button icon={<WhatsAppOutlined />} href={wa} target="_blank" disabled={!hasPhone(inv.customer.phone)} style={{ color: hasPhone(inv.customer.phone) ? '#16a34a' : undefined }}>
                  {overdue ? 'Ingatkan via WA' : 'Kirim via WA'}
                </Button>
              </Tooltip>
              {inv.status !== 'PAID' && !inv.isOpening && (
                <Tooltip title="Kirim email pengingat pembayaran ke pelanggan (alamat email diisi di Data › Pelanggan)">
                  <Button icon={<MailOutlined />} loading={emailReminder.isPending} onClick={() => emailReminder.mutate(undefined)}>
                    {overdue ? 'Ingatkan via email' : 'Kirim via email'}
                  </Button>
                </Tooltip>
              )}
              {inv.status !== 'PAID' && !inv.isOpening && <Button onClick={() => setApplying(true)}>Pakai uang muka</Button>}
              {inv.status !== 'PAID' && (
                <Button type="primary" icon={<DollarOutlined />} onClick={() => setPaying(true)}>
                  Terima bayar
                </Button>
              )}
            </Space>
          )
        }
      />
      <QueryState q={q}>
        {(inv) => (
          <>
            {overdue && <Alert className="no-print" type="warning" showIcon style={{ marginBottom: 12 }} message={`Lewat jatuh tempo sejak ${fmtDate(inv.dueDate)} — sisa ${fmtMoney(rest)}`} />}
            <Card>
              <PrintSheet>
                {doc === 'invoice' || inv.isOpening || service ? (
                  <>
                    <DocHeader
                      title={service ? 'FAKTUR JASA' : 'FAKTUR'}
                      meta={[
                        ['No.', inv.number],
                        ['Tanggal', fmtDate(inv.date)],
                        ['Jatuh tempo', fmtDate(inv.dueDate)],
                        ...(inv.salesOrder ? ([['No. order', inv.salesOrder.number]] as [string, string][]) : []),
                        ...(inv.project ? ([['Proyek', `${inv.project.code} · ${inv.project.name}`]] as [string, string][]) : []),
                        ...(inv.termLabel ? ([['Termin', inv.termLabel]] as [string, string][]) : []),
                      ]}
                    />
                    <PartyBlock
                      label="Kepada Yth."
                      name={inv.customer.name}
                      lines={[inv.customer.address, inv.customer.phone && `Telp. ${inv.customer.phone}`, inv.customer.npwp && `NPWP ${inv.customer.npwp}`]}
                    />
                    {inv.isOpening ? (
                      <p style={{ fontSize: 13 }}>{t('Saldo piutang dari pembukuan sebelumnya (faktur asli diterbitkan di sistem lama).')}</p>
                    ) : service ? (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr>
                            <th style={{ ...head, width: 36 }}>No</th>
                            <th style={head}>Uraian pekerjaan</th>
                            <th style={{ ...head, textAlign: 'right' }}>Qty</th>
                            <th style={{ ...head, textAlign: 'right' }}>Harga</th>
                            <th style={{ ...head, textAlign: 'right' }}>Jumlah</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(inv.serviceLines ?? []).map((l, i) => (
                            <tr key={l.id}>
                              <td style={cell}>{i + 1}</td>
                              <td style={cell}>{l.description}</td>
                              <td style={right}>
                                {fmtQty(l.qty)} {l.unit}
                              </td>
                              <td style={right}>{fmtMoney(l.price)}</td>
                              <td style={right}>{fmtMoney(l.lineTotal)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr>
                            <th style={{ ...head, width: 36 }}>No</th>
                            <th style={head}>Barang</th>
                            <th style={{ ...head, textAlign: 'right' }}>Qty</th>
                            <th style={{ ...head, textAlign: 'right' }}>Harga</th>
                            {disc && <th style={{ ...head, textAlign: 'right' }}>Disk.</th>}
                            <th style={{ ...head, textAlign: 'right' }}>Jumlah</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inv.lines.map((l, i) => (
                            <tr key={l.id}>
                              <td style={cell}>{i + 1}</td>
                              <td style={cell}>
                                {l.product.name}
                                <div style={{ color: '#94a3b8', fontSize: 11 }}>{l.product.sku}</div>
                              </td>
                              <td style={right}>
                                {fmtQty(l.qty)} {l.uom}
                              </td>
                              <td style={right}>{foreign ? fc(l.priceForeign) : fmtMoney(l.price)}</td>
                              {disc && <td style={right}>{Number(l.discountPct) ? `${Number(l.discountPct)}%` : '-'}</td>}
                              <td style={right}>{foreign ? fc(lineForeign(l)) : fmtMoney(l.lineTotal)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, marginTop: 12, flexWrap: 'wrap', fontSize: 13 }}>
                      <div style={{ flex: '1 1 280px' }}>
                        {foreign ? (
                          <div style={{ marginBottom: 8 }}>
                            Mata uang: <strong>{cur}</strong> · kurs Rp {fmtRate(inv.fxRate)} per 1 {cur}
                            <div style={{ fontSize: 12, color: '#475569' }}>Setara {fmtMoney(inv.total)} (DPP {fmtMoney(inv.subtotal)}, PPN {fmtMoney(inv.taxAmount)} dalam Rupiah)</div>
                          </div>
                        ) : (
                          <div style={{ fontStyle: 'italic', marginBottom: 8 }}>Terbilang: {terbilang(inv.total)}</div>
                        )}
                        {lh.data?.bankInfo && (
                          <div style={{ border: '1px dashed #cbd5e1', borderRadius: 6, padding: 8, whiteSpace: 'pre-line' }}>
                            <strong>Pembayaran ke:</strong>
                            {'\n'}
                            {lh.data.bankInfo}
                          </div>
                        )}
                      </div>
                      <table style={{ minWidth: 260 }}>
                        <tbody>
                          {!inv.isOpening && (
                            <>
                              <tr>
                                <td style={{ padding: 4 }}>Subtotal (DPP)</td>
                                <td style={{ padding: 4, textAlign: 'right' }}>{foreign ? fc(subForeign) : fmtMoney(inv.subtotal)}</td>
                              </tr>
                              <tr>
                                <td style={{ padding: 4 }}>PPN</td>
                                <td style={{ padding: 4, textAlign: 'right' }}>{foreign ? fc(totalForeign - subForeign) : fmtMoney(inv.taxAmount)}</td>
                              </tr>
                            </>
                          )}
                          <tr style={{ fontWeight: 700, fontSize: 15 }}>
                            <td style={{ padding: 4, borderTop: '2px solid #333' }}>Total</td>
                            <td style={{ padding: 4, borderTop: '2px solid #333', textAlign: 'right' }}>{foreign ? fc(totalForeign) : fmtMoney(inv.total)}</td>
                          </tr>
                          {wh > 0 && (
                            <tr>
                              <td style={{ padding: 4 }}>
                                Dipotong PPh {inv.withholdingType === 'PPH23' ? '23' : '4(2)'} {Number(inv.withholdingRate)}%
                              </td>
                              <td style={{ padding: 4, textAlign: 'right' }}>({fmtMoney(wh)})</td>
                            </tr>
                          )}
                          {dep > 0 && (
                            <tr>
                              <td style={{ padding: 4 }}>Uang muka</td>
                              <td style={{ padding: 4, textAlign: 'right' }}>({fmtMoney(dep)})</td>
                            </tr>
                          )}
                          {Number(inv.paidAmount) - wh - dep + Number(inv.returnedAmount) > 0 && (
                            <tr>
                              <td style={{ padding: 4 }}>Sudah dibayar / retur</td>
                              <td style={{ padding: 4, textAlign: 'right' }}>({foreign ? fc(Number(inv.paidForeign ?? 0)) : fmtMoney(Number(inv.paidAmount) - wh - dep + Number(inv.returnedAmount))})</td>
                            </tr>
                          )}
                          {Number(inv.paidAmount) + Number(inv.returnedAmount) > 0 && (
                            <>
                              <tr style={{ fontWeight: 700 }}>
                                <td style={{ padding: 4 }}>Sisa tagihan</td>
                                <td style={{ padding: 4, textAlign: 'right' }}>{foreign ? fc(restForeign) : fmtMoney(rest)}</td>
                              </tr>
                            </>
                          )}
                        </tbody>
                      </table>
                    </div>
                    {wh > 0 && (
                      <div style={{ marginTop: 12, fontSize: 12, color: '#475569' }}>
                        Mohon bukti potong PPh {inv.withholdingType === 'PPH23' ? 'Pasal 23' : 'Pasal 4 ayat (2)'} atas DPP {fmtMoney(inv.withholdingBase)} dikirimkan kepada kami.
                        {inv.withholdingSlipNo && ` Bukti potong diterima: ${inv.withholdingSlipNo} (${fmtDate(inv.withholdingSlipDate)}).`}
                      </div>
                    )}
                    {lh.data?.invoiceNote && <div style={{ marginTop: 16, fontSize: 12, color: '#475569', whiteSpace: 'pre-line' }}>{lh.data.invoiceNote}</div>}
                    <Signatures labels={[['Penerima,'], ['Hormat kami,', lh.data?.name]]} />
                  </>
                ) : (
                  <>
                    <DocHeader
                      title="SURAT JALAN"
                      meta={[
                        ['No. faktur', inv.number],
                        ['Tanggal', fmtDate(inv.date)],
                        ...(inv.salesOrder ? ([['No. order', inv.salesOrder.number]] as [string, string][]) : []),
                      ]}
                    />
                    <PartyBlock label="Dikirim kepada" name={inv.customer.name} lines={[inv.customer.address, inv.customer.phone && `Telp. ${inv.customer.phone}`]} />
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th style={{ ...head, width: 36 }}>No</th>
                          <th style={head}>Kode</th>
                          <th style={head}>Nama barang</th>
                          <th style={{ ...head, textAlign: 'right' }}>Qty</th>
                          <th style={head}>Satuan</th>
                          <th style={{ ...head, width: 110 }}>Diterima (cek)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inv.lines.map((l, i) => (
                          <tr key={l.id}>
                            <td style={cell}>{i + 1}</td>
                            <td style={cell}>{l.product.sku}</td>
                            <td style={cell}>{l.product.name}</td>
                            <td style={right}>{fmtQty(l.qty)}</td>
                            <td style={cell}>{l.uom}</td>
                            <td style={cell}>☐</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ marginTop: 12, fontSize: 12, color: '#475569' }}>Barang telah diterima dalam keadaan baik dan jumlah yang sesuai.</div>
                    <Signatures labels={[['Penerima,'], ['Pengirim / sopir,'], ['Bagian gudang,']]} />
                  </>
                )}
              </PrintSheet>
            </Card>
            {inv.payments.length > 0 && (
              <Card title="Riwayat pembayaran" className="no-print" style={{ marginTop: 16 }}>
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={inv.payments}
                  columns={[
                    { title: 'No.', dataIndex: 'number' },
                    { title: 'Tanggal', dataIndex: 'date', render: fmtDate },
                    { title: 'Metode', dataIndex: 'method', render: (m: keyof typeof PAYMENT_METHOD_LABELS) => PAYMENT_METHOD_LABELS[m] ?? m },
                    { title: 'Catatan', dataIndex: 'notes' },
                    {
                      title: 'Jumlah',
                      dataIndex: 'amount',
                      align: 'right',
                      render: (v, p) =>
                        p.amountForeign ? (
                          <>
                            {fmtCurrency(p.amountForeign, p.currency)}
                            <div style={{ fontSize: 11, color: '#64748b' }}>
                              kas {fmtMoney(p.cashAmount)} @ {fmtRate(p.fxRate)}
                              {Number(p.fxGainLoss) !== 0 && ` · ${Number(p.fxGainLoss) > 0 ? 'laba' : 'rugi'} kurs ${fmtMoney(Math.abs(Number(p.fxGainLoss)))}`}
                            </div>
                          </>
                        ) : (
                          fmtMoney(v)
                        ),
                    },
                  ]}
                />
              </Card>
            )}
            <DocumentChain invoiceId={inv.id} />
          </>
        )}
      </QueryState>
      <PaymentModal invoice={paying ? (inv ?? null) : null} onClose={() => setPaying(false)} />
      <ApplyDepositModal invoice={applying && inv ? { ...inv, customerId: inv.customerId } : null} onClose={() => setApplying(false)} />
    </>
  );
}
