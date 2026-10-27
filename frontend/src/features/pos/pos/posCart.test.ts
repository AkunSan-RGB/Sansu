import { describe, expect, it } from 'vitest';
import type { PosProduct } from '@/api/types';
import { addToCart, checkAdd, lineTotal, loyaltyMath, paymentMath, setCartQty, type CartLine, type LoyaltyCfg } from './posCart';

const prod = (o: Partial<PosProduct> = {}): PosProduct =>
  ({ id: 'p1', name: 'Kopi', sku: 'KP', sellPrice: '15000', stock: '5', baseUom: 'PCS', uoms: [{ uom: 'DUS', factor: '12' }], ...o }) as unknown as PosProduct;

describe('keranjang kasir', () => {
  it('barang tanpa harga jual ditolak', () => {
    const r = checkAdd(prod({ sellPrice: '0' }), 'PCS', []);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.message).toMatch(/belum diisi/);
  });
  it('tidak boleh melebihi stok, termasuk yang sudah di keranjang dan konversi satuan', () => {
    const p = prod({ stock: '5' });
    let cart: CartLine[] = [];
    for (let i = 0; i < 5; i++) {
      const c = checkAdd(p, 'PCS', cart);
      expect(c.ok).toBe(true);
      cart = addToCart(cart, p, 'PCS', 1);
    }
    expect(cart).toHaveLength(1);
    expect(cart[0].qty).toBe(5);
    const over = checkAdd(p, 'PCS', cart);
    expect(!over.ok && over.message).toMatch(/sudah di keranjang/);
    expect(checkAdd(p, 'DUS', []).ok).toBe(false); // 1 dus = 12 pcs > stok 5
  });
  it('satuan lain menjadi baris sendiri dengan harga per satuan', () => {
    const p = prod({ stock: '100' });
    const c1 = addToCart([], p, 'PCS', 1);
    const c2 = addToCart(c1, p, 'DUS', 12);
    expect(c2).toHaveLength(2);
    expect(c2[1].unitPrice).toBe(15000 * 12);
  });
  it('jumlah nol menghapus baris, total baris memperhitungkan diskon dan membulatkan sen', () => {
    const c = addToCart([], prod(), 'PCS', 1);
    expect(setCartQty(c, 0, 0)).toEqual([]);
    expect(setCartQty(c, 0, 3)[0].qty).toBe(3);
    expect(lineTotal({ ...c[0], qty: 3, unitPrice: 10000, discountPct: 10 })).toBe(27000);
    expect(lineTotal({ ...c[0], qty: 1, unitPrice: 333.33, discountPct: 0 })).toBe(333.33);
  });
});

describe('poin loyalitas dan pembayaran', () => {
  const cfg: LoyaltyCfg = { enabled: true, earnPerRp: 10000, pointValueRp: 100, minRedeemPoints: 10, maxRedeemPct: 50, expiryMonths: 12 };
  it('penukaran dibatasi saldo dan persentase maksimum, serta minimum penukaran', () => {
    // total 100.000, maks 50% = 50.000 = 500 poin; saldo 300 → batas 300
    expect(loyaltyMath({ cfg, customerId: 'c', balance: 300, redeem: 400, total: 100_000 })).toMatchObject({ maxRedeem: 300, redeemPts: 0 }); // melebihi batas → ditolak
    expect(loyaltyMath({ cfg, customerId: 'c', balance: 300, redeem: 200, total: 100_000 })).toMatchObject({ redeemPts: 200, redeemValue: 20_000, payable: 80_000, willEarn: 8 });
    expect(loyaltyMath({ cfg, customerId: 'c', balance: 300, redeem: 5, total: 100_000 }).redeemPts).toBe(0); // di bawah minimum
  });
  it('tanpa pelanggan atau program nonaktif tidak ada penukaran dan tidak ada poin', () => {
    expect(loyaltyMath({ cfg, balance: 999, redeem: 100, total: 100_000 })).toMatchObject({ maxRedeem: 0, redeemPts: 0, willEarn: 0, payable: 100_000 });
    expect(loyaltyMath({ cfg: { ...cfg, enabled: false }, customerId: 'c', balance: 999, redeem: 100, total: 100_000 }).redeemPts).toBe(0);
  });
  it('kembalian hanya untuk tunai; non-tunai selalu cukup', () => {
    expect(paymentMath('CASH', 100_000, 85_000)).toEqual({ change: 15_000, enough: true });
    expect(paymentMath('CASH', 50_000, 85_000)).toEqual({ change: 0, enough: false });
    expect(paymentMath('CASH', null, 85_000).enough).toBe(false);
    expect(paymentMath('QRIS', null, 85_000)).toEqual({ change: 0, enough: true });
  });
});
