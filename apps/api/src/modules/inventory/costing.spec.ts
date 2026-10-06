import { movingAverage } from './costing';

describe('movingAverage', () => {
  it('stok kosong: rata-rata = biaya masuk', () => {
    expect(movingAverage(0, 0, 10, 5000).toFixed(4)).toBe('5000.0000');
  });

  it('menghitung rata-rata tertimbang', () => {
    // 10 @ 5.000 + 30 @ 6.000 = 230.000 / 40 = 5.750
    expect(movingAverage(10, 5000, 30, 6000).toFixed(4)).toBe('5750.0000');
  });

  it('membulatkan ke 4 desimal', () => {
    // (1 x 1 + 2 x 2) / 3 = 1.6667
    expect(movingAverage(1, 1, 2, 2).toFixed(4)).toBe('1.6667');
  });
});
