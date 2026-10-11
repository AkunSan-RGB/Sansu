/**
 * Tautan persetujuan lewat email: token bertanda tangan (HMAC) yang memuat jenis permintaan, id permintaan, id penyetuju, dan masa berlaku.
 * Token hanya membuka halaman ringkasan; keputusan baru diambil saat tombol ditekan (POST), sehingga pemindai tautan email tidak
 * menyetujui apa pun. Setiap permintaan hanya bisa diputuskan sekali (status permintaan), dan token kedaluwarsa dalam 72 jam.
 */
import { createHmac, timingSafeEqual } from 'crypto';

export interface ApprovalLink {
  /** AR = approval_requests (PO, jurnal manual, harga faktur); PR = permintaan pembelian */
  k: 'AR' | 'PR';
  r: string;
  u: string;
  exp: number;
}

export const APPROVAL_LINK_TTL_MS = 72 * 3600_000;

const key = () => createHmac('sha256', process.env.JWT_SECRET || 'sansu-dev-key').update('approval-link-v1').digest();
const b64 = (b: Buffer) => b.toString('base64url');

export function signApprovalLink(p: Omit<ApprovalLink, 'exp'>, now = Date.now()): string {
  const body = b64(Buffer.from(JSON.stringify({ ...p, exp: now + APPROVAL_LINK_TTL_MS })));
  return `${body}.${b64(createHmac('sha256', key()).update(body).digest())}`;
}

export function verifyApprovalLink(token: string, now = Date.now()): ApprovalLink | null {
  const [body, sig, extra] = String(token).split('.');
  if (!body || !sig || extra !== undefined) return null;
  const want = createHmac('sha256', key()).update(body).digest();
  let got: Buffer;
  try {
    got = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as ApprovalLink;
    if ((p.k !== 'AR' && p.k !== 'PR') || typeof p.r !== 'string' || typeof p.u !== 'string' || typeof p.exp !== 'number' || p.exp < now) return null;
    return p;
  } catch {
    return null;
  }
}
