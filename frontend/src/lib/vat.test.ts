import { describe, expect, it } from 'vitest';
import { outputVatRate, vatTotals } from './vat';

describe('vatTotals', () => {
  it('harga belum termasuk PPN', () => {
    expect(vatTotals(100_000, 11)).toEqual({ subtotal: 100_000, tax: 11_000, total: 111_000 });
  });
  it('harga termasuk PPN: total tetap = harga rak', () => {
    expect(vatTotals(111_000, 11, true)).toEqual({ subtotal: 100_000, tax: 11_000, total: 111_000 });
    const t = vatTotals(15_000, 11, true);
    expect(t.total).toBe(15_000);
    expect(t.subtotal).toBe(13_513.51);
    expect(t.tax).toBe(1_486.49);
  });
  it('non-PKP tidak memungut PPN', () => {
    expect(outputVatRate({ ppnRate: '11', taxProfile: { pkp: false, posPricesIncludeVat: false, salesPricesIncludeVat: false } })).toBe(0);
    expect(outputVatRate({ ppnRate: '11', taxProfile: { pkp: true, posPricesIncludeVat: false, salesPricesIncludeVat: false } })).toBe(11);
  });
});
