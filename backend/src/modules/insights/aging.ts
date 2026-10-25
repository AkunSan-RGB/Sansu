/** Umur saldo terbuka faktur penjualan (AR) atau tagihan pembelian (AP) per pihak lawan, sejak jatuh tempo */
import { sql } from 'drizzle-orm';
import { Db } from '../../db/db';
import { queryOpenBalanceAging } from './aging.repository';

export const AGING_BUCKETS = [
  'Belum jatuh tempo',
  '1–30 hari',
  '31–60 hari',
  '61–90 hari',
  'Lebih dari 90 hari',
] as const;

export interface AgingRow {
  code: string;
  label: string;
  /** Saldo per kelompok umur, urutan sama dengan AGING_BUCKETS */
  cells: number[];
  total: number;
}

export async function openBalanceAging(db: Db, tenantId: string, to: string, kind: 'AR' | 'AP'): Promise<AgingRow[]> {
  const doc = kind === 'AR' ? sql`invoices` : sql`purchase_invoices`;
  const party = kind === 'AR' ? sql`customers` : sql`suppliers`;
  const partyKey = kind === 'AR' ? sql`customer_id` : sql`supplier_id`;
  const res = await queryOpenBalanceAging(db, to, doc, party, partyKey, tenantId);
  const byParty = new Map<string, AgingRow>();
  for (const r of res.rows) {
    const e = byParty.get(r.code) ?? {
      code: r.code,
      label: `${r.code} ${r.name}`,
      cells: AGING_BUCKETS.map(() => 0),
      total: 0,
    };
    e.cells[r.bucket] += Number(r.v);
    e.total += Number(r.v);
    byParty.set(r.code, e);
  }
  // Pihak yang saldonya nol (mis. lunas oleh retur) tidak ditampilkan
  return [...byParty.values()].filter((r) => Math.abs(r.total) > 0.004);
}
