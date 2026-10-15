/**
 * Mesin harga & promo (murni, tanpa database): menentukan harga satuan dari daftar harga pelanggan, potongan promo, dan bonus barang.
 * Aturan sengaja sederhana agar bisa dijelaskan ke pelanggan dan diperiksa auditor:
 *  - Harga yang diisi pengguna pada baris tidak pernah ditimpa. Baris tanpa harga memakai harga daftar pelanggan, lalu harga jual master.
 *  - Harga daftar bertingkat: tingkat dengan jumlah minimum terbesar yang masih terpenuhi (dihitung dalam satuan dasar).
 *  - Potongan promo tidak ditumpuk: dipakai yang terbesar. Potongan yang diisi pengguna pada baris tidak ditimpa.
 *  - Bonus barang: tiap kelipatan jumlah minimum memberi bonus; boleh ada beberapa promo bonus sekaligus.
 */
import { D, Dec, ZERO } from '../../../common/utils/money';

export interface PriceTier {
  productId: string;
  /** Satuan dasar */
  minQty: string;
  /** Per satuan dasar */
  price: string;
}

export interface PromoRule {
  id: string;
  name: string;
  kind: 'DISCOUNT' | 'BONUS';
  productId: string | null;
  minQty: string;
  discountPct: string;
  bonusProductId: string | null;
  bonusQty: string;
  validFrom: string | null;
  validTo: string | null;
  priceListId: string | null;
  isActive: boolean;
}

/** Harga satuan dasar dari daftar harga untuk jumlah (satuan dasar) tertentu; null bila produk tidak ada di daftar */
export function tierPrice(tiers: PriceTier[], productId: string, baseQty: Dec): Dec | null {
  let best: PriceTier | null = null;
  for (const t of tiers) {
    if (t.productId !== productId || D(t.minQty).gt(baseQty)) continue;
    if (!best || D(t.minQty).gt(best.minQty)) best = t;
  }
  return best ? D(best.price) : null;
}

export function promoActive(p: PromoRule, date: string, customerListId: string | null): boolean {
  if (!p.isActive) return false;
  if (p.validFrom && date < p.validFrom) return false;
  if (p.validTo && date > p.validTo) return false;
  if (p.priceListId && p.priceListId !== customerListId) return false;
  return true;
}

export interface QuoteLineIn {
  productId: string;
  uom: string;
  /** Faktor satuan baris terhadap satuan dasar */
  factor: string;
  qty: string;
  price?: string;
  discountPct?: string;
}
export interface QuoteLineOut {
  productId: string;
  uom: string;
  qty: string;
  /** Harga per satuan baris (kosong bila tidak ditentukan daftar harga: dipakai harga jual master oleh pemanggil) */
  price?: string;
  discountPct: string;
  priceSource: 'EXPLICIT' | 'LIST' | 'MASTER';
  promoId?: string;
  promoName?: string;
}
export interface BonusLine {
  productId: string;
  qty: string;
  promoId: string;
  promoName: string;
}

export function quote(
  lines: QuoteLineIn[],
  ctx: { tiers: PriceTier[]; promos: PromoRule[]; date: string; customerListId: string | null; applyPromos: boolean },
): { lines: QuoteLineOut[]; bonus: BonusLine[] } {
  const promos = ctx.applyPromos ? ctx.promos.filter((p) => promoActive(p, ctx.date, ctx.customerListId)) : [];
  // jumlah beli per produk (satuan dasar) lintas baris: promo bertingkat dihitung dari total produk di pesanan
  const totalBase = new Map<string, Dec>();
  for (const l of lines) totalBase.set(l.productId, (totalBase.get(l.productId) ?? ZERO).plus(D(l.qty).times(l.factor)));

  const out: QuoteLineOut[] = lines.map((l) => {
    const baseQty = totalBase.get(l.productId)!;
    let price = l.price;
    let priceSource: QuoteLineOut['priceSource'] = l.price !== undefined ? 'EXPLICIT' : 'MASTER';
    if (l.price === undefined && ctx.customerListId) {
      const tp = tierPrice(ctx.tiers, l.productId, baseQty);
      if (tp) {
        price = tp.times(l.factor).toDecimalPlaces(2, 4).toFixed(2);
        priceSource = 'LIST';
      }
    }
    let discountPct = l.discountPct ?? '0';
    let promoId: string | undefined;
    let promoName: string | undefined;
    if (D(discountPct).isZero()) {
      for (const p of promos) {
        if (p.kind !== 'DISCOUNT') continue;
        if (p.productId && p.productId !== l.productId) continue;
        if (baseQty.lt(p.minQty)) continue;
        if (D(p.discountPct).gt(discountPct)) {
          discountPct = D(p.discountPct).toString();
          promoId = p.id;
          promoName = p.name;
        }
      }
    }
    return { productId: l.productId, uom: l.uom, qty: l.qty, price, discountPct, priceSource, promoId, promoName };
  });

  const bonus: BonusLine[] = [];
  for (const p of promos) {
    if (p.kind !== 'BONUS' || !p.productId || !p.bonusProductId) continue;
    const base = totalBase.get(p.productId);
    if (!base || base.lt(p.minQty)) continue;
    const times = base.div(p.minQty).floor();
    const q = times.times(p.bonusQty);
    if (q.gt(0)) bonus.push({ productId: p.bonusProductId, qty: q.toFixed(4).replace(/\.?0+$/, ''), promoId: p.id, promoName: p.name });
  }
  return { lines: out, bonus };
}
