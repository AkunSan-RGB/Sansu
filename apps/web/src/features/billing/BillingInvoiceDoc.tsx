import { PrinterOutlined } from '@ant-design/icons';
import { BILLING_STATUS_LABELS, BRAND, type BillingInvoiceDoc as Doc } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Modal, Spin } from 'antd';
import { get } from '@/api/client';
import { LogoMark } from '@/brand/Logo';
import { cell, head, PartyBlock, PrintSheet } from '@/components/print/Letterhead';
import { fmtDate, fmtMoney } from '@/lib/format';
import { printDoc } from '@/lib/print';

const CYCLE = { MONTHLY: 'Bulanan', YEARLY: 'Tahunan' } as const;
const C = BRAND.colors.primary;

/** Invoice langganan SANSU (penjual: PT pemilik SANSU, pembeli: perusahaan pelanggan) */
export function InvoiceSheet({ d }: { d: Doc }) {
  const vat = Number(d.vatAmount) > 0;
  const period = d.periodStart
    ? `${fmtDate(d.periodStart)} – ${fmtDate(d.periodEnd)}`
    : `1 periode ${CYCLE[d.cycle].toLowerCase()}`;
  return (
    <PrintSheet>
      <div style={{ padding: 24, fontSize: 13 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            borderBottom: `3px solid ${C}`,
            paddingBottom: 12,
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 0, flex: '1 1 300px' }}>
            <LogoMark size={48} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{d.seller.name}</div>
              <div style={{ fontSize: 12, color: '#475569', whiteSpace: 'pre-line' }}>
                {[d.seller.address, d.seller.npwp && `NPWP ${d.seller.npwp}`].filter(Boolean).join('\n')}
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: C, letterSpacing: 0.5 }}>INVOICE</div>
            <table style={{ marginLeft: 'auto', fontSize: 13 }}>
              <tbody>
                {(
                  [
                    ['Nomor', d.number],
                    ['Tanggal', fmtDate(d.createdAt)],
                    ['Jatuh tempo', fmtDate(d.dueDate)],
                    ['Status', BILLING_STATUS_LABELS[d.status]],
                  ] as const
                ).map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ color: '#64748b', paddingRight: 8, textAlign: 'right' }}>{k}</td>
                    <td style={{ fontWeight: 600, textAlign: 'right' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <PartyBlock
          label="Ditagihkan kepada"
          name={d.buyer.name}
          lines={[d.buyer.address, d.buyer.npwp && `NPWP ${d.buyer.npwp}`]}
        />

        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
          <thead>
            <tr>
              <th style={head}>Uraian</th>
              <th style={head}>Periode</th>
              <th style={{ ...head, textAlign: 'right' }}>Jumlah</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={cell}>
                Langganan {BRAND.name} paket <strong>{d.planName}</strong> ({CYCLE[d.cycle].toLowerCase()})
              </td>
              <td style={cell}>{period}</td>
              <td style={{ ...cell, textAlign: 'right' }}>{fmtMoney(d.subtotal)}</td>
            </tr>
          </tbody>
        </table>

        <table style={{ marginLeft: 'auto', minWidth: 280, borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td style={{ padding: '4px 8px' }}>{vat ? 'Dasar pengenaan pajak' : 'Subtotal'}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right' }}>{fmtMoney(d.subtotal)}</td>
            </tr>
            {vat && (
              <tr>
                <td style={{ padding: '4px 8px' }}>PPN {Number(d.vatRate)}%</td>
                <td style={{ padding: '4px 8px', textAlign: 'right' }}>{fmtMoney(d.vatAmount)}</td>
              </tr>
            )}
            <tr>
              <td style={{ padding: '6px 8px', fontWeight: 700, borderTop: `2px solid ${C}` }}>Total</td>
              <td
                style={{
                  padding: '6px 8px',
                  fontWeight: 700,
                  textAlign: 'right',
                  borderTop: `2px solid ${C}`,
                  fontSize: 15,
                }}
              >
                {fmtMoney(d.amount)}
              </td>
            </tr>
          </tbody>
        </table>

        {d.status === 'PAID' ? (
          <div
            style={{
              marginTop: 24,
              display: 'inline-block',
              border: `2px solid ${BRAND.colors.accent}`,
              color: BRAND.colors.accent,
              fontWeight: 800,
              padding: '4px 14px',
              borderRadius: 6,
              letterSpacing: 2,
            }}
          >
            LUNAS {d.paidAt ? `· ${fmtDate(d.paidAt)}` : ''}
          </div>
        ) : (
          d.seller.bank && (
            <div style={{ marginTop: 24 }}>
              <div style={{ color: '#64748b' }}>Pembayaran melalui transfer ke</div>
              <div style={{ fontWeight: 700 }}>
                {d.seller.bank.name} {d.seller.bank.account} a.n. {d.seller.bank.holder}
              </div>
            </div>
          )
        )}
        <div style={{ marginTop: 28, fontSize: 11, color: '#64748b' }}>
          {vat ? 'Faktur pajak elektronik diterbitkan terpisah melalui Coretax DJP. ' : ''}Dokumen ini dibuat otomatis
          oleh sistem dan sah tanpa tanda tangan.
        </div>
      </div>
    </PrintSheet>
  );
}

/** Modal pratinjau + cetak invoice langganan */
export default function BillingInvoiceModal({
  id,
  admin,
  onClose,
}: {
  id: string | null;
  admin?: boolean;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ['billing-invoice', admin ? 'admin' : 'me', id],
    queryFn: () => get<Doc>(admin ? `/platform-admin/invoices/${id}` : `/billing/invoices/${id}`),
    enabled: !!id,
  });
  return (
    <Modal
      open={!!id}
      onCancel={onClose}
      width={880}
      title={q.data ? `Invoice ${q.data.number}` : 'Invoice'}
      footer={
        <Button
          type="primary"
          icon={<PrinterOutlined />}
          disabled={!q.data}
          onClick={() => printDoc(`Invoice ${q.data?.number ?? ''}`)}
        >
          Cetak / simpan PDF
        </Button>
      }
      destroyOnHidden
    >
      {q.data ? <InvoiceSheet d={q.data} /> : <Spin />}
    </Modal>
  );
}
