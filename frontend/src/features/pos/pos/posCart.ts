import type { PosPaymentMethod } from '@sansu/shared';
import type { PosProduct } from '@/api/types';
import { fmtQty } from '@/lib/format';

export interface CartLine {
  product: PosProduct;
  uom: string;
  factor: number;
  qty: number;
  unitPrice: number; // per uom (belum PPN, atau sudah termasuk PPN bila harga kasir termasuk PPN)
  discountPct: number;
  /** Nama promo yang memberi potongan (dari server) */
  promoName?: string | null;
}

export interface LoyaltyCfg {
  enabled: boolean;
  earnPerRp: number;
  pointValueRp: number;
  minRedeemPoints: number;
  maxRedeemPct: number;
  expiryMonths: number;
}

export const lineTotal = (l: CartLine) => Math.round(l.qty * l.unitPrice * (100 - l.discountPct)) / 100;

/**
 * Boleh tidaknya barang masuk keranjang — sama dengan aturan server: barang tanpa harga jual tidak dijual di kasir dan
 * penjualan tidak boleh melebihi stok (ditegur sejak barang diklik, bukan saat membayar).
 */
export function checkAdd(p: PosProduct, uom: string, cart: CartLine[]): { ok: true; factor: number } | { ok: false; message: string } {
  if (Number(p.sellPrice) <= 0) {
    return { ok: false, message: `Harga jual ${p.name} belum diisi (Rp 0), jadi tidak bisa dijual di kasir. Isi harga di Produk, atau minta supervisor.` };
  }
  const factor = uom === p.baseUom ? 1 : Number(p.uoms.find((u) => u.uom === uom)?.factor ?? 1);
  const inCart = cart.filter((l) => l.product.id === p.id).reduce((a, l) => a + l.qty * l.factor, 0);
  if (inCart + factor > Number(p.stock) + 1e-9) {
    return { ok: false, message: `Stok ${p.name} tidak cukup (tersedia ${fmtQty(Number(p.stock))}${inCart ? `, sudah di keranjang ${fmtQty(inCart)}` : ''})` };
  }
  return { ok: true, factor };
}

/** Tambah satu satuan barang; baris yang sama (barang + satuan) bertambah jumlahnya, bukan baris baru */
export function addToCart(cart: CartLine[], p: PosProduct, uom: string, factor: number): CartLine[] {
  const i = cart.findIndex((l) => l.product.id === p.id && l.uom === uom);
  if (i >= 0) return cart.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
  return [...cart, { product: p, uom, factor, qty: 1, unitPrice: Number(p.sellPrice) * factor, discountPct: 0 }];
}

/** Ubah jumlah baris; jumlah nol atau kurang menghapus baris */
export const setCartQty = (cart: CartLine[], i: number, qty: number): CartLine[] =>
  qty <= 0 ? cart.filter((_, j) => j !== i) : cart.map((l, j) => (j === i ? { ...l, qty } : l));

/** Penukaran poin loyalitas: dibatasi saldo, persentase maksimum dari total, dan minimum penukaran; server memeriksa ulang */
export function loyaltyMath(a: { cfg?: LoyaltyCfg; customerId?: string; balance: number; redeem: number | null; total: number }) {
  const { cfg, customerId, balance, redeem, total } = a;
  const maxRedeem = cfg?.enabled && customerId ? Math.max(0, Math.min(balance, Math.floor((total * (cfg.maxRedeemPct / 100)) / cfg.pointValueRp))) : 0;
  const redeemPts = redeem && cfg && redeem >= cfg.minRedeemPoints && redeem <= maxRedeem ? redeem : 0;
  const redeemValue = redeemPts * (cfg?.pointValueRp ?? 0);
  const payable = total - redeemValue;
  const willEarn = cfg?.enabled && customerId ? Math.floor(payable / cfg.earnPerRp) : 0;
  return { maxRedeem, redeemPts, redeemValue, payable, willEarn };
}

/** Kembalian dan cukup-tidaknya uang yang diterima (hanya tunai yang punya kembalian) */
export function paymentMath(method: PosPaymentMethod, amount: number | null, payable: number) {
  return {
    change: method === 'CASH' ? Math.max(0, (amount ?? 0) - payable) : 0,
    enough: method === 'CASH' ? (amount ?? 0) >= payable : true,
  };
}

export interface QuoteLine { productId: string; uom: string; price: string; discountPct: string; promoName: string | null }

/**
 * Terapkan kutipan server (daftar harga toko/pelanggan + promo) pada keranjang. Kutipan lama yang tidak lagi cocok
 * dengan isi keranjang (produk/satuan berbeda atau jumlah baris berbeda) diabaikan, jadi harga tidak pernah tertukar baris.
 */
export function applyQuote(cart: CartLine[], quote: QuoteLine[] | undefined): CartLine[] {
  if (!quote || quote.length !== cart.length) return cart;
  if (cart.some((l, i) => quote[i].productId !== l.product.id || quote[i].uom !== l.uom)) return cart;
  return cart.map((l, i) => ({ ...l, unitPrice: Number(quote[i].price), discountPct: Number(quote[i].discountPct), promoName: quote[i].promoName }));
}
