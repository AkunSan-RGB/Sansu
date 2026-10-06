import { date, num } from './parse';

describe('impor: baca angka & tanggal', () => {
  it.each([
    [1250000, '1250000'],
    ['1.250.000', '1250000'],
    ['1.250.000,50', '1250000.5'],
    ['1,250,000.50', '1250000.5'],
    ['Rp 1.250.000', '1250000'],
    ['Rp.75.000', '75000'],
    ['(5.000)', '-5000'],
    ['-12500', '-12500'],
    ['1250,5', '1250.5'],
    ['0', '0'],
  ])('%p → %s', (v, out) => expect((num(v) as { toString(): string }).toString()).toBe(out));
  it('kosong & salah', () => {
    expect(num('')).toBeNull();
    expect(num(null)).toBeNull();
    expect(num('abc')).toBe('invalid');
    expect(num('1.2.3,4,5')).toBe('invalid');
  });
  it.each([
    [46022, '2025-12-31'],
    ['2025-12-31', '2025-12-31'],
    ['31/12/2025', '2025-12-31'],
    ['1-9-2026', '2026-09-01'],
  ])('tanggal %p → %s', (v, out) => expect(date(v)).toBe(out));
  it('tanggal salah', () => {
    expect(date('31/02/2026')).toBe('invalid');
    expect(date('kemarin')).toBe('invalid');
    expect(date('')).toBeNull();
  });
});
