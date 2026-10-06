import { documentTotals, lineTotal } from './pricing';

describe('pricing', () => {
  it('menghitung baris dengan diskon', () => {
    // 2 dus x 84.000 x (1 - 2.5%) = 163.800
    expect(lineTotal({ qty: 2, price: 84000, discountPct: 2.5 }).toFixed(2)).toBe('163800.00');
  });

  it('menghitung PPN 11% dari subtotal', () => {
    const t = documentTotals(
      [
        { qty: 10, price: 3500 },
        { qty: 1, price: 84000, discountPct: 0 },
      ],
      11,
    );
    expect(t.subtotal.toFixed(2)).toBe('119000.00');
    expect(t.taxAmount.toFixed(2)).toBe('13090.00');
    expect(t.total.toFixed(2)).toBe('132090.00');
  });

  it('membulatkan half-up', () => {
    // 3 x 333.335 = 1000.005 -> 1000.01
    expect(lineTotal({ qty: 3, price: '333.335' }).toFixed(2)).toBe('1000.01');
  });
});
