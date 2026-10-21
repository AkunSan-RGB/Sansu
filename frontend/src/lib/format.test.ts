import { describe, expect, it } from 'vitest';
import { fmtMoney } from './format';

// Intl memakai spasi tak-pecah (U+00A0) setelah "Rp"
const n = (s: string) => s.replace(/ /g, ' ');

describe('fmtMoney', () => {
  it('nominal bulat tanpa desimal', () => {
    expect(n(fmtMoney(1234567))).toBe('Rp 1.234.567');
    expect(n(fmtMoney('0'))).toBe('Rp 0');
    expect(n(fmtMoney(null))).toBe('Rp 0');
  });
  it('bila ada sen selalu dua digit (",20", bukan ",2")', () => {
    expect(n(fmtMoney(395737.2))).toBe('Rp 395.737,20');
    expect(n(fmtMoney('110822.4'))).toBe('Rp 110.822,40');
    expect(n(fmtMoney('40833994.02'))).toBe('Rp 40.833.994,02');
  });
  it('pembulatan ke sen dan bilangan negatif', () => {
    expect(n(fmtMoney(10.004))).toBe('Rp 10');
    expect(n(fmtMoney(10.005))).toMatch(/^Rp 10,0[01]$/);
    expect(n(fmtMoney(-1500.5))).toMatch(/^-Rp 1\.500,50$/);
  });
});
