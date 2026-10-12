import { consumeLayers, movingAverage } from './costing';

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

describe('consumeLayers (MPKP / FIFO)', () => {
  const layers = [
    { id: 'a', qty: '10', unitCost: '1000' },
    { id: 'b', qty: '10', unitCost: '1200' },
  ];
  it('mengambil dari lapisan paling lama lebih dulu', () => {
    const r = consumeLayers(layers, '15');
    expect(r.cost.toString()).toBe('16000'); // 10×1000 + 5×1200
    expect(r.remaining.map((x) => [x.id, x.qty.toString()])).toEqual([['a', '0'], ['b', '5']]);
    expect(r.shortfall.toString()).toBe('0');
  });
  it('sebagian lapisan pertama saja', () => {
    const r = consumeLayers(layers, '4');
    expect(r.cost.toString()).toBe('4000');
    expect(r.remaining.map((x) => x.qty.toString())).toEqual(['6', '10']);
  });
  it('kekurangan stok dilaporkan', () => {
    expect(consumeLayers(layers, '25').shortfall.toString()).toBe('5');
  });
});
