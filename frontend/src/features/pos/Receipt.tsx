import { POS_ORDER_TYPE_LABELS, POS_PAYMENT_LABELS } from '@sansu/shared';
import dayjs from 'dayjs';
import type { PosOrder } from '@/api/types';
import { fmtMoney, fmtQty } from '@/lib/format';

/** Cetak hanya struk (kertas thermal 58/80 mm) */
export function printReceipt() {
  document.body.classList.add('printing-receipt');
  window.print();
  document.body.classList.remove('printing-receipt');
}

/** Struk belanja kasir */
export default function Receipt({ order, company, cashier, warehouse }: { order: PosOrder; company: string; cashier: string; warehouse: string }) {
  const row = { display: 'flex', justifyContent: 'space-between', gap: 8 } as const;
  return (
    <div className="receipt" style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 12, lineHeight: 1.45, background: '#fff', padding: 8, border: '1px dashed #ccc' }}>
      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 14 }}>{company}</div>
      <div style={{ textAlign: 'center' }}>{warehouse}</div>
      <div style={{ textAlign: 'center', marginBottom: 6 }}>
        {order.number} · {dayjs(order.createdAt).format('DD/MM/YYYY HH:mm')}
      </div>
      <div>Kasir: {cashier}</div>
      {order.customer && <div>Pelanggan: {order.customer.name}</div>}
      {(order.orderType || order.tableLabel) && (
        <div>
          {order.orderType ? POS_ORDER_TYPE_LABELS[order.orderType] : ''}
          {order.orderType && order.tableLabel ? ' · ' : ''}
          {order.tableLabel ?? ''}
        </div>
      )}
      <div style={{ borderTop: '1px dashed #999', margin: '6px 0' }} />
      {order.lines?.map((l) => (
        <div key={l.id}>
          <div>{l.product.name}</div>
          <div style={row}>
            <span>
              {fmtQty(l.qty)} {l.uom} x {fmtMoney(l.price)}
              {Number(l.discountPct) > 0 && ` -${Number(l.discountPct)}%`}
            </span>
            <span>{fmtMoney(l.lineTotal)}</span>
          </div>
        </div>
      ))}
      <div style={{ borderTop: '1px dashed #999', margin: '6px 0' }} />
      {Number(order.taxAmount) > 0 && !order.pricesIncludeVat && (
        <>
          <div style={row}>
            <span>Subtotal</span>
            <span>{fmtMoney(order.subtotal)}</span>
          </div>
          <div style={row}>
            <span>PPN</span>
            <span>{fmtMoney(order.taxAmount)}</span>
          </div>
        </>
      )}
      <div style={{ ...row, fontWeight: 700, fontSize: 14 }}>
        <span>TOTAL</span>
        <span>{fmtMoney(order.total)}</span>
      </div>
      {Number(order.taxAmount) > 0 && order.pricesIncludeVat && (
        <div style={{ ...row, fontSize: 11 }}>
          <span>Termasuk PPN (DPP {fmtMoney(order.subtotal)})</span>
          <span>{fmtMoney(order.taxAmount)}</span>
        </div>
      )}
      {order.payments.map((p) => (
        <div key={p.id} style={row}>
          <span>{POS_PAYMENT_LABELS[p.method]}</span>
          <span>{fmtMoney(p.method === 'CASH' ? Number(p.amount) + Number(order.change) : p.amount)}</span>
        </div>
      ))}
      {Number(order.change) > 0 && (
        <div style={row}>
          <span>Kembali</span>
          <span>{fmtMoney(order.change)}</span>
        </div>
      )}
      <div style={{ textAlign: 'center', marginTop: 8 }}>Terima kasih atas kunjungan Anda</div>
    </div>
  );
}
