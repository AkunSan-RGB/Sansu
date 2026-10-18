/**
 * Penjaga "pembayaran pelanggan dibelokkan": uang masuk non-penjualan (mis. Pendapatan lain-lain) yang jumlahnya persis sama dengan
 * sisa piutang suatu faktur, atau yang keterangannya menyebut nama pelanggan/nomor faktur yang masih berutang, kemungkinan besar
 * adalah pembayaran pelanggan. Pembayaran pelanggan harus dicatat di Faktur & piutang agar piutang berkurang dan uangnya terlacak.
 */
import { sql } from 'drizzle-orm';
import { Db } from '../../db/db';

type Exec = Pick<Db, 'execute'>;

export interface ReceivableHit { number: string; customer: string; outstanding: number; why: 'JUMLAH' | 'NAMA' }

export async function findReceivableLookalike(db: Exec, tenantId: string, amount: number, text: string): Promise<ReceivableHit | null> {
  const t = (text ?? '').toLowerCase();
  const r = await db.execute<{ number: string; name: string; outstanding: string }>(sql`
    SELECT i.number, c.name, (i.total - i.paid_amount - i.returned_amount)::text AS outstanding
    FROM invoices i JOIN customers c ON c.id = i.customer_id
    WHERE i.tenant_id = ${tenantId} AND i.status <> 'PAID' AND i.is_opening = false AND (i.total - i.paid_amount - i.returned_amount) > 0.005
      AND (
        ABS((i.total - i.paid_amount - i.returned_amount) - ${amount}) < 0.005
        OR (length(c.name) >= 4 AND position(lower(c.name) in ${t}) > 0)
        OR position(lower(i.number) in ${t}) > 0
      )
    ORDER BY (ABS((i.total - i.paid_amount - i.returned_amount) - ${amount}) < 0.005) DESC, i.date DESC
    LIMIT 1`);
  const h = r.rows[0];
  if (!h) return null;
  const out = Number(h.outstanding);
  return { number: h.number, customer: h.name, outstanding: out, why: Math.abs(out - amount) < 0.005 ? 'JUMLAH' : 'NAMA' };
}
