import type { DbOrTx } from '../../../db/db';
import { queryProduct } from './category.repository';

/** Rapikan kategori: spasi berlebih dibuang; kosong = tanpa kategori (null) */
export const cleanCategory = (v?: string | null): string | null => {
  const s = (v ?? '').replace(/\s+/g, ' ').trim();
  return s || null;
};

/** Semua huruf kecil atau semua huruf besar (bukan ejaan campuran seperti "Minuman") */
export const isPlain = (v: string) => v === v.toLowerCase() || v === v.toUpperCase();

/**
 * Ejaan baku tiap kategori di satu perusahaan (huruf besar/kecil diabaikan; yang paling banyak dipakai menang),
 * agar "minuman" dan "Minuman" tidak terpecah jadi dua kategori di kasir, filter, stok opname, dan laporan.
 */
export async function categorySpellings(db: DbOrTx, tenantId: string): Promise<Map<string, string>> {
  const r = await queryProduct(db, tenantId);
  const m = new Map<string, string>();
  // paling banyak dipakai menang; bila seri, ejaan campuran ("Minuman") didahulukan dari semua kecil/besar
  const rows = [...r.rows].sort(
    (a, b) =>
      b.n - a.n || Number(isPlain(a.category)) - Number(isPlain(b.category)) || a.category.localeCompare(b.category),
  );
  for (const row of rows) {
    const clean = cleanCategory(row.category)!;
    if (!m.has(clean.toLowerCase())) m.set(clean.toLowerCase(), clean);
  }
  return m;
}

/** Kategori hasil rapi dan disamakan dengan ejaan baku yang sudah ada (kategori baru dipakai apa adanya) */
export async function canonicalCategory(
  db: DbOrTx,
  tenantId: string,
  raw: string | null | undefined,
): Promise<string | null> {
  const c = cleanCategory(raw);
  if (!c) return null;
  return (await categorySpellings(db, tenantId)).get(c.toLowerCase()) ?? c;
}
