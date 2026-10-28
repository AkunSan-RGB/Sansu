import { daysBetween, postBilling, shortfallHeadDays } from './site-coverage';

describe('site-coverage', () => {
  it('daysBetween termasuk kedua ujung', () => {
    expect(daysBetween('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  });

  it('kekurangan dihitung per hari dan hari tanpa jadwal kurang penuh', () => {
    const days = daysBetween('2026-10-01', '2026-10-04');
    const assigned = new Map([['2026-10-01', 2], ['2026-10-02', 1], ['2026-10-03', 3]]);
    // wajib 2 orang: 0 + 1 + 0 + 2 (tanggal 4 tanpa jadwal)
    expect(shortfallHeadDays(days, 2, assigned)).toBe(3);
  });

  it('tagihan penuh bila tidak dipotong; dipotong proporsional bila diminta', () => {
    expect(postBilling(3, '4000000', 30, 6, false)).toEqual({ qty: '3.0000', amount: '12000000.00' });
    // kekurangan 6 hari-orang dari 30 hari = 0,2 petugas
    expect(postBilling(3, '4000000', 30, 6, true)).toEqual({ qty: '2.8000', amount: '11200000.00' });
  });

  it('tidak pernah negatif', () => {
    expect(postBilling(1, '1000000', 30, 90, true)).toEqual({ qty: '0.0000', amount: '0.00' });
  });
});
