import { PriceTier, PromoRule, quote, tierPrice } from './pricing-engine';
import { D } from '../../../common/utils/money';

const tiers: PriceTier[] = [
  { productId: 'A', minQty: '1', price: '1000' },
  { productId: 'A', minQty: '10', price: '900' },
  { productId: 'A', minQty: '100', price: '800' },
];
const promo = (p: Partial<PromoRule>): PromoRule => ({ id: 'p1', name: 'Promo', kind: 'DISCOUNT', productId: 'A', minQty: '1', discountPct: '5', bonusProductId: null, bonusQty: '0', validFrom: null, validTo: null, priceListId: null, isActive: true, ...p });
const ctx = { tiers, promos: [] as PromoRule[], date: '2026-10-10', customerListId: 'L1', applyPromos: true };

describe('daftar harga bertingkat', () => {
  it('memilih tingkat dengan jumlah minimum terbesar yang terpenuhi', () => {
    expect(tierPrice(tiers, 'A', D(5))!.toString()).toBe('1000');
    expect(tierPrice(tiers, 'A', D(10))!.toString()).toBe('900');
    expect(tierPrice(tiers, 'A', D(99))!.toString()).toBe('900');
    expect(tierPrice(tiers, 'A', D(100))!.toString()).toBe('800');
    expect(tierPrice(tiers, 'B', D(100))).toBeNull();
    expect(tierPrice(tiers, 'A', D('0.5'))).toBeNull();
  });
  it('harga baris: daftar × faktor satuan; harga yang diisi tidak ditimpa; tanpa daftar = master', () => {
    const r = quote([{ productId: 'A', uom: 'DUS', factor: '12', qty: '2' }, { productId: 'A', uom: 'PCS', factor: '1', qty: '1', price: '1234' }], ctx);
    // total 25 satuan dasar → tingkat 10
    expect(r.lines[0]).toMatchObject({ price: '10800.00', priceSource: 'LIST' });
    expect(r.lines[1]).toMatchObject({ price: '1234', priceSource: 'EXPLICIT' });
    const none = quote([{ productId: 'A', uom: 'PCS', factor: '1', qty: '50' }], { ...ctx, customerListId: null });
    expect(none.lines[0]).toMatchObject({ price: undefined, priceSource: 'MASTER' });
    const other = quote([{ productId: 'B', uom: 'PCS', factor: '1', qty: '5' }], ctx);
    expect(other.lines[0].priceSource).toBe('MASTER');
  });
});

describe('promo', () => {
  it('potongan: dipakai yang terbesar, tidak ditumpuk, tidak menimpa potongan yang diisi pengguna', () => {
    const promos = [promo({ id: 'a', discountPct: '5', minQty: '10' }), promo({ id: 'b', discountPct: '8', minQty: '50' }), promo({ id: 'c', discountPct: '3', productId: null, minQty: '1' })];
    const r = quote([{ productId: 'A', uom: 'PCS', factor: '1', qty: '60' }, { productId: 'A', uom: 'PCS', factor: '1', qty: '1', discountPct: '2' }], { ...ctx, promos });
    // total 61 → promo b (8%) untuk baris tanpa potongan; baris dengan potongan 2% dibiarkan
    expect(r.lines[0]).toMatchObject({ discountPct: '8', promoId: 'b' });
    expect(r.lines[1]).toMatchObject({ discountPct: '2', promoId: undefined });
  });
  it('promo hanya berlaku dalam periode, aktif, dan untuk daftar harga yang dituju', () => {
    const base = { productId: 'A', uom: 'PCS', factor: '1', qty: '10' };
    expect(quote([base], { ...ctx, promos: [promo({ validFrom: '2026-10-11' })] }).lines[0].discountPct).toBe('0');
    expect(quote([base], { ...ctx, promos: [promo({ validTo: '2026-10-09' })] }).lines[0].discountPct).toBe('0');
    expect(quote([base], { ...ctx, promos: [promo({ isActive: false })] }).lines[0].discountPct).toBe('0');
    expect(quote([base], { ...ctx, promos: [promo({ priceListId: 'L2' })] }).lines[0].discountPct).toBe('0');
    expect(quote([base], { ...ctx, promos: [promo({ priceListId: 'L1', validFrom: '2026-10-10', validTo: '2026-10-10' })] }).lines[0].discountPct).toBe('5');
    expect(quote([base], { ...ctx, applyPromos: false, promos: [promo({})] }).lines[0].discountPct).toBe('0');
  });
  it('bonus barang: tiap kelipatan jumlah minimum, dari total produk pemicu di pesanan', () => {
    const promos = [promo({ id: 'bn', kind: 'BONUS', productId: 'A', minQty: '12', bonusProductId: 'B', bonusQty: '1', discountPct: '0' })];
    const r = quote([{ productId: 'A', uom: 'DUS', factor: '12', qty: '2' }, { productId: 'A', uom: 'PCS', factor: '1', qty: '5' }], { ...ctx, promos });
    // 29 satuan dasar → 2 kelipatan 12 → 2 bonus
    expect(r.bonus).toEqual([{ productId: 'B', qty: '2', promoId: 'bn', promoName: 'Promo' }]);
    expect(quote([{ productId: 'A', uom: 'PCS', factor: '1', qty: '11' }], { ...ctx, promos }).bonus).toEqual([]);
  });
});
