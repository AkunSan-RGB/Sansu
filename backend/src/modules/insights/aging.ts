/** Umur saldo terbuka faktur penjualan (AR) atau tagihan pembelian (AP) per pihak lawan, sejak jatuh tempo */
import { sql } from 'drizzle-orm';
import { Db } from '../../db/db';

export const AGING_BUCKETS = ['Belum jatuh tempo', '1–30 hari', '31–60 hari', '61–90 hari', 'Lebih dari 90 hari'] as const;

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
  const res = await db.execute<{ code: string; name: string; bucket: number; v: string }>(sql`
    SELECT p.code, p.name,
           CASE WHEN d.due_date >= ${to}::date THEN 0
                WHEN d.due_date >= (${to}::date - 30) THEN 1
                WHEN d.due_date >= (${to}::date - 60) THEN 2
                WHEN d.due_date >= (${to}::date - 90) THEN 3
                ELSE 4 END AS bucket,
           SUM(d.total - d.paid_amount - d.returned_amount) AS v
    FROM ${doc} d JOIN ${party} p ON p.id = d.${partyKey}
    WHERE d.tenant_id = ${tenantId} AND d.date <= ${to} AND d.status <> 'PAID'
    GROUP BY p.code, p.name, 3
    ORDER BY p.name`);
  const byParty = new Map<string, AgingRow>();
  for (const r of res.rows) {
    const e = byParty.get(r.code) ?? { code: r.code, label: `${r.code} ${r.name}`, cells: AGING_BUCKETS.map(() => 0), total: 0 };
    e.cells[r.bucket] += Number(r.v);
    e.total += Number(r.v);
    byParty.set(r.code, e);
  }
  // Pihak yang saldonya nol (mis. lunas oleh retur) tidak ditampilkan
  return [...byParty.values()].filter((r) => Math.abs(r.total) > 0.004);
}
