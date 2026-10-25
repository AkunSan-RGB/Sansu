import { ONLINE_CHANNEL_LABELS, POS_CASHIER_PAYMENT_METHODS, POS_PAYMENT_LABELS, type PosPaymentMethod } from '@sansu/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Checkbox, Divider, InputNumber, Modal, Segmented, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { get, post } from '@/api/client';
import { useAction } from '@/api/queries';
import type { PosOrder, PosSession, PosTabDetail } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { fmtMoney, fmtQty } from '@/lib/format';
import { posTax, vatTotals } from '@/lib/vat';
import { KEYS } from './shared';

export function PayModal({ open, onClose, tab, session, onPaid }: { open: boolean; onClose: () => void; tab: PosTabDetail; session: PosSession | null; onPaid: (o: PosOrder) => void }) {
  const { me } = useAuth();
  const { rate, label } = posTax(me);
  const inclusive = !!me?.taxProfile?.posPricesIncludeVat && rate > 0;
  const unpaid = tab.lines.filter((l) => l.status !== 'VOID' && !l.paidOrderId);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [method, setMethod] = useState<PosPaymentMethod>('CASH');
  const [amount, setAmount] = useState<number | null>(null);
  const ids = picked ?? unpaid.map((l) => l.id);
  const sum = unpaid.filter((l) => ids.includes(l.id)).reduce((a, l) => a + Number(l.qty) * Number(l.product.sellPrice), 0);
  const { total } = vatTotals(sum, rate, inclusive);
  const enough = method === 'CASH' ? (amount ?? 0) >= total : true;
  const pay = useAction(
    () => post<PosOrder>(`/pos/tabs/${tab.id}/pay`, { sessionId: session!.id, lineIds: ids.length === unpaid.length ? undefined : ids, payments: [{ method, amount: (method === 'CASH' ? (amount ?? 0) : total).toFixed(2) }] }),
    { invalidate: KEYS, onSuccess: (o) => { setPicked(null); setAmount(null); onPaid(o); } },
  );
  const unsent = unpaid.filter((l) => ids.includes(l.id) && l.status === 'DRAFT').length;
  const payOnline = useAction(() => post<PosOrder>(`/pos/tabs/${tab.id}/pay`, { sessionId: session!.id }), { invalidate: KEYS, onSuccess: (o) => onPaid(o) });
  const commissions = useQuery({ queryKey: ['pos-online-settings'], queryFn: () => get<{ commissions: Record<string, number> }>('/pos/online/settings'), enabled: !!tab.channel });
  if (tab.channel) {
    const pct = commissions.data?.commissions[tab.channel] ?? 0;
    const fee = Math.round(((sum * pct) / 100) * 100) / 100;
    return (
      <Modal title={`Selesaikan pesanan ${ONLINE_CHANNEL_LABELS[tab.channel]}`} open={open} onCancel={onClose} onOk={() => payOnline.mutate()} okText="Selesai" confirmLoading={payOnline.isPending} okButtonProps={{ disabled: !session || unsent > 0 }} destroyOnHidden>
        <Typography.Paragraph>
          Pesanan ini dibayar oleh platform, bukan oleh pelanggan di kasir. Penjualan dicatat sebagai <strong>piutang platform</strong> (dikurangi komisi). Saat dana dari platform masuk, catat di <strong>Pesanan online › Pencairan</strong>.
        </Typography.Paragraph>
        <div>Total termasuk {label} {rate}%: <strong>{fmtMoney(total)}</strong></div>
        <div>Komisi {ONLINE_CHANNEL_LABELS[tab.channel]} ({pct}% dari harga menu): <strong>{fmtMoney(fee)}</strong></div>
        <div>Perkiraan diterima dari platform: <strong>{fmtMoney(total - fee)}</strong></div>
        {unsent > 0 && <Alert type="warning" showIcon style={{ marginTop: 12 }} message="Ada menu yang belum dikirim ke dapur. Kirim dulu." />}
      </Modal>
    );
  }
  return (
    <Modal title="Pembayaran" open={open} onCancel={onClose} onOk={() => pay.mutate()} okText="Terima pembayaran" confirmLoading={pay.isPending} okButtonProps={{ disabled: !ids.length || !enough || unsent > 0 || !session }} destroyOnHidden>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>Pilih menu yang dibayar sekarang. Bayar sebagian untuk pisah bill; sisanya tetap terbuka.</Typography.Paragraph>
      <Checkbox.Group style={{ width: '100%' }} value={ids} onChange={(v) => setPicked(v as string[])}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {unpaid.map((l) => (
            <Checkbox key={l.id} value={l.id} style={{ width: '100%' }}>
              {fmtQty(Number(l.qty))} × {l.product.name} — {fmtMoney(Number(l.qty) * Number(l.product.sellPrice))}
              {l.status === 'DRAFT' && <Tag color="red" style={{ marginLeft: 8 }}>belum dikirim</Tag>}
            </Checkbox>
          ))}
        </Space>
      </Checkbox.Group>
      <Divider style={{ margin: '12px 0' }} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: '#666' }}>Total termasuk {label} {rate}%</div>
        <Typography.Title level={3} style={{ margin: 0 }}>{fmtMoney(total)}</Typography.Title>
      </div>
      <Segmented block style={{ margin: '12px 0' }} value={method} onChange={(v) => { setMethod(v as PosPaymentMethod); setAmount(null); }} options={POS_CASHIER_PAYMENT_METHODS.map((k) => ({ value: k, label: POS_PAYMENT_LABELS[k] }))} />
      {method === 'CASH' && (
        <>
          <InputNumber style={{ width: '100%' }} min={0} prefix="Rp" placeholder="Uang diterima" value={amount} onChange={setAmount} />
          {(amount ?? 0) >= total && total > 0 && <div style={{ marginTop: 6 }}>Kembalian: <strong>{fmtMoney((amount ?? 0) - total)}</strong></div>}
        </>
      )}
      {unsent > 0 && <Alert type="warning" showIcon style={{ marginTop: 12 }} message="Ada menu yang belum dikirim ke dapur. Kirim dulu sebelum dibayar." />}
    </Modal>
  );
}
