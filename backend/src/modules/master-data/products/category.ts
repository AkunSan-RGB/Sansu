import { sql } from 'drizzle-orm';
import type { DbOrTx } from '../../../db/db';

/** Rapikan kategori: spasi berlebih dibuang; kosong = tanpa kategori (null) */
export const cleanCategory = (v?: string | null): string | null => {
  const s = (v ?? '').replace(/\s+/g, ' ').trim();
  return s || null;
};

/**
 * Ejaan baku tiap kategori di satu perusahaan (huruf besar/kecil diabaikan; yang paling banyak dipakai menang),
 * agar "minuman" dan "Minuman" tidak terpecah jadi dua kategori di kasir, filter, stok opname, dan laporan.
 */
export async function categorySpellings(db: DbOrTx, tenantId: string): Promise<Map<string, string>> {
  const r = await db.execute<{ category: string; n: number }>(sql`
    SELECT category, COUNT(*)::int AS n FROM products WHERE tenant_id = ${tenantId} AND category IS NOT NULL AND btrim(category) <> ''
    GROUP BY category ORDER BY COUNT(*) DESC, category`);
  const m = new Map<string, string>();
  for (const row of r.rows) {
    const clean = cleanCategory(row.category)!;
    if (!m.has(clean.toLowerCase())) m.set(clean.toLowerCase(), clean);
  }
  return m;
}

/** Kategori hasil rapi dan disamakan dengan ejaan baku yang sudah ada (kategori baru dipakai apa adanya) */
export async function canonicalCategory(db: DbOrTx, tenantId: string, raw: string | null | undefined): Promise<string | null> {
  const c = cleanCategory(raw);
  if (!c) return null;
  return (await categorySpellings(db, tenantId)).get(c.toLowerCase()) ?? c;
}
