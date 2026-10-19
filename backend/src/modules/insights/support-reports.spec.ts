import { withRest } from './support-reports';

describe('withRest', () => {
  const rows = Array.from({ length: 5 }, (_, i) => [`R${i}`, i + 1, (i + 1) * 100]);
  it('tidak mengubah tabel yang tidak melebihi batas', () => {
    expect(withRest(rows, 5, [1, 2])).toEqual(rows);
  });
  it('menggabungkan baris di luar batas menjadi satu baris Lainnya yang menjaga jumlah', () => {
    const out = withRest(rows, 3, [1, 2]);
    expect(out).toHaveLength(4);
    expect(out[3]).toEqual(['Lainnya (2)', 9, 900]);
    const total = (r: (string | number | null)[][], i: number) => r.reduce((a, x) => a + Number(x[i]), 0);
    expect(total(out, 1)).toBe(total(rows, 1));
    expect(total(out, 2)).toBe(total(rows, 2));
  });
});
