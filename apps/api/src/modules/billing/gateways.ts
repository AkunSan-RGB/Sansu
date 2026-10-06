/**
 * Gerbang pembayaran otomatis. Aktif bila kuncinya diisi di .env:
 *   Midtrans: MIDTRANS_SERVER_KEY (+ MIDTRANS_PRODUCTION=true untuk transaksi sungguhan)
 *   Xendit:   XENDIT_SECRET_KEY + XENDIT_CALLBACK_TOKEN
 * Tanpa kunci → hanya transfer manual (bukti transfer dikonfirmasi pemilik layanan).
 */
import { createHash, timingSafeEqual } from 'crypto';

export type GatewayName = 'MIDTRANS' | 'XENDIT';

export interface CheckoutInput {
  orderId: string;
  amount: number;
  description: string;
  customer: { name: string; email: string };
  finishUrl: string;
}
export interface CheckoutResult {
  ref: string;
  url: string;
}
/** Hasil pemeriksaan notifikasi (webhook) */
export interface PaymentNotice {
  orderId: string;
  paid: boolean;
  /** Pembayaran gagal / kedaluwarsa / dibatalkan di sisi gerbang */
  failed: boolean;
  amount: number | null;
  ref: string | null;
}

export function activeGateway(): GatewayName | null {
  if (process.env.MIDTRANS_SERVER_KEY) return 'MIDTRANS';
  if (process.env.XENDIT_SECRET_KEY) return 'XENDIT';
  return null;
}

const basic = (key: string) => `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// ---------- Midtrans Snap ----------
export const midtrans = {
  snapUrl: () => (process.env.MIDTRANS_PRODUCTION === 'true' ? 'https://app.midtrans.com/snap/v1/transactions' : 'https://app.sandbox.midtrans.com/snap/v1/transactions'),

  body(i: CheckoutInput) {
    return {
      transaction_details: { order_id: i.orderId, gross_amount: Math.round(i.amount) },
      item_details: [{ id: i.orderId, price: Math.round(i.amount), quantity: 1, name: i.description.slice(0, 50) }],
      customer_details: { first_name: i.customer.name.slice(0, 50), email: i.customer.email },
      callbacks: { finish: i.finishUrl },
    };
  },

  async checkout(i: CheckoutInput, fetchFn: typeof fetch = fetch): Promise<CheckoutResult> {
    const res = await fetchFn(midtrans.snapUrl(), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: basic(process.env.MIDTRANS_SERVER_KEY!) },
      body: JSON.stringify(midtrans.body(i)),
    });
    const j = (await res.json().catch(() => ({}))) as { token?: string; redirect_url?: string; error_messages?: string[] };
    if (!res.ok || !j.redirect_url) throw new Error(`Midtrans: ${j.error_messages?.join(', ') || res.statusText}`);
    return { ref: j.token ?? i.orderId, url: j.redirect_url };
  },

  /** signature_key = SHA512(order_id + status_code + gross_amount + ServerKey) */
  signature: (orderId: string, statusCode: string, grossAmount: string, serverKey: string) => createHash('sha512').update(orderId + statusCode + grossAmount + serverKey).digest('hex'),

  verify(body: Record<string, string>): PaymentNotice | null {
    const key = process.env.MIDTRANS_SERVER_KEY;
    if (!key || !body?.order_id || !body.signature_key) return null;
    const expected = midtrans.signature(body.order_id, String(body.status_code), String(body.gross_amount), key);
    if (!safeEq(expected, String(body.signature_key))) return null;
    const st = body.transaction_status;
    const paid = st === 'settlement' || (st === 'capture' && (body.fraud_status ?? 'accept') === 'accept');
    return { orderId: body.order_id, paid, failed: ['deny', 'cancel', 'expire', 'failure'].includes(st), amount: Number(body.gross_amount), ref: body.transaction_id ?? null };
  },
};

// ---------- Xendit Invoice ----------
export const xendit = {
  url: 'https://api.xendit.co/v2/invoices',

  body(i: CheckoutInput) {
    return {
      external_id: i.orderId,
      amount: Math.round(i.amount),
      description: i.description,
      payer_email: i.customer.email,
      customer: { given_names: i.customer.name, email: i.customer.email },
      success_redirect_url: i.finishUrl,
      failure_redirect_url: i.finishUrl,
      currency: 'IDR',
    };
  },

  async checkout(i: CheckoutInput, fetchFn: typeof fetch = fetch): Promise<CheckoutResult> {
    const res = await fetchFn(xendit.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: basic(process.env.XENDIT_SECRET_KEY!) },
      body: JSON.stringify(xendit.body(i)),
    });
    const j = (await res.json().catch(() => ({}))) as { id?: string; invoice_url?: string; message?: string };
    if (!res.ok || !j.invoice_url) throw new Error(`Xendit: ${j.message || res.statusText}`);
    return { ref: j.id ?? i.orderId, url: j.invoice_url };
  },

  /** Xendit mengirim header x-callback-token yang harus sama dengan token verifikasi di dashboard */
  verify(token: string | undefined, body: Record<string, unknown>): PaymentNotice | null {
    const expected = process.env.XENDIT_CALLBACK_TOKEN;
    if (!expected || !token || !safeEq(expected, token) || typeof body?.external_id !== 'string') return null;
    const st = String(body.status ?? '');
    return {
      orderId: body.external_id,
      paid: st === 'PAID' || st === 'SETTLED',
      failed: st === 'EXPIRED',
      amount: typeof body.paid_amount === 'number' ? body.paid_amount : typeof body.amount === 'number' ? body.amount : null,
      ref: typeof body.id === 'string' ? body.id : null,
    };
  },
};
