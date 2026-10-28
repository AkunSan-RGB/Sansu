import { splitRetention } from './retention-split';

describe('splitRetention', () => {
  it('memecah tagihan: jumlah dua tagihan sama dengan semula', () => {
    const lines = [{ description: 'Termin 1', qty: '1', price: '100000000' }];
    const { main, retention } = splitRetention(lines, '5');
    expect(main[0].price).toBe('95000000.00');
    expect(retention.toFixed(2)).toBe('5000000.00');
  });

  it('tanpa selisih pembulatan untuk banyak baris dan jumlah pecahan', () => {
    const lines = [
      { description: 'A', qty: '3', price: '333333.33' },
      { description: 'B', qty: '1.5', price: '1234567.89' },
    ];
    const { main, retention } = splitRetention(lines, '7.5');
    const gross = 3 * 333333.33 + 1.5 * 1234567.89;
    const net = main.reduce((a, l) => a + Number(l.qty) * Number(l.price), 0);
    expect(Math.abs(gross - net - Number(retention.toFixed(2)))).toBeLessThan(0.02);
  });

  it('persen nol atau tidak sah tidak memecah', () => {
    expect(splitRetention([{ description: 'A', price: '100' }], '0').retention.toFixed(2)).toBe('0.00');
    expect(splitRetention([{ description: 'A', price: '100' }], '100').retention.toFixed(2)).toBe('0.00');
  });
});
