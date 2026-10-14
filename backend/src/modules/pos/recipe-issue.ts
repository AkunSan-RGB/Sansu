/**
 * Menu yang dibuat saat dipesan (produk "madeToOrder"): kasir tidak mengurangi stok produknya, tetapi bahan sesuai resep aktif.
 * Kebutuhan bahan per satuan dasar menu = qty bahan di resep / jumlah hasil per batch.
 */
import { BadRequestException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { D, Dec, qty4 } from '../../common/utils/money';
import { DbOrTx } from '../../db/db';
import { bomLines, boms, products, stockBalances } from '../../db/schema';

export interface RecipeComponent {
  productId: string;
  /** Jumlah bahan (satuan dasar bahan) untuk 1 satuan dasar menu */
  perUnit: Dec;
}

/** Resep aktif terbaru tiap menu: productId → bahan. Menu tanpa resep aktif ditolak dengan pesan yang jelas. */
export async function recipesFor(db: DbOrTx, tenantId: string, menu: { id: string; sku: string }[]): Promise<Map<string, RecipeComponent[]>> {
  const out = new Map<string, RecipeComponent[]>();
  if (!menu.length) return out;
  const rows = await db
    .select()
    .from(boms)
    .where(and(eq(boms.tenantId, tenantId), eq(boms.isActive, true), inArray(boms.productId, menu.map((m) => m.id))))
    .orderBy(desc(boms.createdAt));
  const chosen = new Map<string, (typeof rows)[number]>();
  for (const b of rows) if (!chosen.has(b.productId)) chosen.set(b.productId, b);
  const lines = chosen.size
    ? await db.select().from(bomLines).where(inArray(bomLines.bomId, [...chosen.values()].map((b) => b.id)))
    : [];
  for (const m of menu) {
    const bom = chosen.get(m.id);
    const ls = bom ? lines.filter((l) => l.bomId === bom.id) : [];
    if (!bom || !ls.length) throw new BadRequestException(`Menu ${m.sku} belum punya resep aktif. Buat resepnya di menu Produksi › Resep, atau matikan "dibuat saat dipesan" pada produk.`);
    const per = D(bom.outputQty);
    if (per.lte(0)) throw new BadRequestException(`Resep menu ${m.sku} tidak valid (jumlah hasil nol)`);
    out.set(
      m.id,
      ls.map((l) => ({ productId: l.productId, perUnit: D(l.qty).div(per) })),
    );
  }
  return out;
}

/** Bahan yang dipakai untuk menjual `baseQty` (satuan dasar menu), dibulatkan 4 desimal seperti mutasi stok */
export const componentNeeds = (recipe: RecipeComponent[], baseQty: Dec) =>
  recipe.map((c) => ({ productId: c.productId, qty: qty4(c.perUnit.times(baseQty)) })).filter((n) => n.qty.gt(0));

/** Porsi menu yang masih bisa dibuat dari stok bahan di gudang (bilangan bulat, terkecil di antara semua bahan) */
export async function portionsAvailable(db: DbOrTx, tenantId: string, warehouseId: string, recipes: Map<string, RecipeComponent[]>): Promise<Map<string, string>> {
  const ids = [...new Set([...recipes.values()].flatMap((r) => r.map((c) => c.productId)))];
  const bal = ids.length
    ? await db
        .select({ productId: stockBalances.productId, qty: stockBalances.qty })
        .from(stockBalances)
        .where(and(eq(stockBalances.tenantId, tenantId), eq(stockBalances.warehouseId, warehouseId), inArray(stockBalances.productId, ids)))
    : [];
  const have = new Map(bal.map((b) => [b.productId, D(b.qty)]));
  const out = new Map<string, string>();
  for (const [menuId, comps] of recipes) {
    let min: Dec | null = null;
    for (const c of comps) {
      if (c.perUnit.lte(0)) continue;
      const n = (have.get(c.productId) ?? D(0)).div(c.perUnit).floor();
      min = min === null || n.lt(min) ? n : min;
    }
    out.set(menuId, (min ?? D(0)).toFixed(0));
  }
  return out;
}
