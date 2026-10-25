import { describe, expect, it } from 'vitest';
import type { Product } from '@/api/types';
import { previewLine, uomFactor } from './docLines';

describe('previewLine', () => {
  it('menghitung qty × harga dikurangi diskon, dibulatkan ke sen', () => {
    expect(previewLine({ qty: 3, price: 1000, discountPct: 10 })).toBe(2700);
    expect(previewLine({ qty: 1, price: 333.33, discountPct: 0 })).toBe(333.33);
  });
  it('nilai kosong dianggap nol', () => {
    expect(previewLine({})).toBe(0);
    expect(previewLine({ qty: 5 })).toBe(0);
  });
});

describe('uomFactor', () => {
  const p = { baseUom: 'pcs', uoms: [{ uom: 'dus', factor: '12' }] } as unknown as Product;
  it('satuan dasar atau produk kosong berfaktor 1', () => {
    expect(uomFactor(p, 'pcs')).toBe(1);
    expect(uomFactor(undefined, 'dus')).toBe(1);
    expect(uomFactor(p, undefined)).toBe(1);
  });
  it('satuan turunan memakai faktornya; tidak dikenal berfaktor 1', () => {
    expect(uomFactor(p, 'dus')).toBe(12);
    expect(uomFactor(p, 'koli')).toBe(1);
  });
});
