import { documentTotals, lineTotal, roundVat } from './pricing';
import { D } from '../../common/utils/money';

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

  describe('pembulatan PPN ke rupiah penuh', () => {
    const lines = [{ qty: 1, price: 1015 }]; // PPN 11% = 111,65
    it('bawaan tanpa pembulatan', () => {
      expect(documentTotals(lines, 11).taxAmount.toFixed(2)).toBe('111.65');
    });
    it('ke terdekat dan ke bawah', () => {
      expect(documentTotals(lines, 11, 'NEAREST').taxAmount.toFixed(2)).toBe('112.00');
      expect(documentTotals(lines, 11, 'DOWN').taxAmount.toFixed(2)).toBe('111.00');
      expect(documentTotals(lines, 11, 'NEAREST').total.toFixed(2)).toBe('1127.00');
    });
    it('batas setengah dibulatkan ke atas, bukan genap', () => {
      expect(roundVat(D('100.50'), 'NEAREST').toFixed(2)).toBe('101.00');
      expect(roundVat(D('101.50'), 'NEAREST').toFixed(2)).toBe('102.00');
      expect(roundVat(D('100.49'), 'NEAREST').toFixed(2)).toBe('100.00');
      expect(roundVat(D('0.40'), 'DOWN').toFixed(2)).toBe('0.00');
    });
    it('nilai bulat tidak berubah', () => {
      expect(roundVat(D('13090.00'), 'DOWN').toFixed(2)).toBe('13090.00');
    });
  });
});
