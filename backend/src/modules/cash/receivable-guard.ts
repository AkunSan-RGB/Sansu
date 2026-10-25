import { Db } from '../../db/db';
import { queryInvoice } from './receivable-guard.repository';

type Exec = Pick<Db, 'execute'>;

export interface ReceivableHit {
  number: string;
  customer: string;
  outstanding: number;
  why: 'JUMLAH' | 'NAMA';
}

export async function findReceivableLookalike(
  db: Exec,
  tenantId: string,
  amount: number,
  text: string,
): Promise<ReceivableHit | null> {
  const t = (text ?? '').toLowerCase();
  const r = await queryInvoice(db, tenantId, amount, t);
  const h = r.rows[0];
  if (!h) return null;
  const out = Number(h.outstanding);
  return {
    number: h.number,
    customer: h.name,
    outstanding: out,
    why: Math.abs(out - amount) < 0.005 ? 'JUMLAH' : 'NAMA',
  };
}
