import type { Product } from '@/api/types';

/** Satu baris dokumen penjualan/pembelian di formulir (nilai angka masih bertipe number) */
export interface DocLine {
  productId?: string;
  uom?: string;
  qty?: number;
  price?: number;
  discountPct?: number;
}

/** Pengali satuan terhadap satuan dasar produk */
export const uomFactor = (p: Product | undefined, uom: string | undefined) =>
  !p || !uom || uom === p.baseUom ? 1 : Number(p.uoms.find((u) => u.uom === uom)?.factor ?? 1);

/** Pratinjau nilai baris di browser; nilai final selalu dihitung ulang oleh server. */
export const previewLine = (l: DocLine) =>
  Math.round((l.qty ?? 0) * (l.price ?? 0) * (100 - (l.discountPct ?? 0))) / 100;
