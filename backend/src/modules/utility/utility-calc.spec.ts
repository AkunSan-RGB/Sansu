import { computeBill, DEFAULT_UTILITY_RULES, flagReading, lateFee, validateBlocks, validateRules } from '@sansu/shared';

const tariff = { fixedFee: 12000, adminFee: 2500, minUsage: 5, blocks: [{ upTo: 10, price: 3000 }, { upTo: 20, price: 4500 }, { upTo: null, price: 7000 }] };

describe('hitung tagihan utilitas', () => {
  it('blok progresif + abonemen + admin', () => {
    expect(computeBill(tariff, 25, 'm³').subtotal).toBe(10 * 3000 + 10 * 4500 + 5 * 7000 + 12000 + 2500);
    expect(computeBill(tariff, 10, 'm³').subtotal).toBe(30000 + 14500);
  });
  it('pemakaian minimum ditagih walau pakai lebih sedikit', () => {
    expect(computeBill(tariff, 2, 'm³').subtotal).toBe(5 * 3000 + 14500);
    expect(computeBill(tariff, 0, 'm³').subtotal).toBe(5 * 3000 + 14500);
  });
  it('tarif tetap tanpa meter', () => {
    const r = computeBill({ fixedFee: 185000, adminFee: 0, minUsage: 0, blocks: [] }, null, 'bulan');
    expect(r.subtotal).toBe(185000);
    expect(r.lines).toHaveLength(1);
  });
  it('validasi blok tarif', () => {
    expect(validateBlocks([{ upTo: 10, price: 1 }, { upTo: null, price: 2 }], true)).toEqual([]);
    expect(validateBlocks([{ upTo: 10, price: 1 }], true)).not.toEqual([]);
    expect(validateBlocks([{ upTo: 20, price: 1 }, { upTo: 10, price: 1 }, { upTo: null, price: 1 }], true)).not.toEqual([]);
    expect(validateBlocks([{ upTo: null, price: -1 }], true)).not.toEqual([]);
    expect(validateBlocks([{ upTo: null, price: 1 }], false)).not.toEqual([]);
    expect(validateBlocks([], true)).not.toEqual([]);
  });
});

describe('denda dan kejanggalan meter', () => {
  const r = DEFAULT_UTILITY_RULES;
  it('denda hanya setelah masa toleransi, persen dari sisa, dibatasi', () => {
    expect(lateFee(100000, 100000, 7, r)).toBe(0);
    expect(lateFee(100000, 100000, 8, r)).toBe(2000);
    expect(lateFee(100000, 0, 30, r)).toBe(0);
    expect(lateFee(100000, 100000, 30, { ...r, lateFeePct: 10, lateFeeCapPct: 5 })).toBe(5000);
    expect(lateFee(100000, 100000, 30, { ...r, lateFeePct: 0 })).toBe(0);
  });
  it('aturan di luar batas ditolak', () => {
    expect(validateRules(r)).toEqual([]);
    expect(validateRules({ ...r, lateFeePct: 50 })).not.toEqual([]);
    expect(validateRules({ ...r, lateFeeCapPct: 1 })).not.toEqual([]);
    expect(validateRules({ ...r, suspendAfterDays: 3 })).not.toEqual([]);
  });
  it('menandai lonjakan, nol, dan meter diganti', () => {
    expect(flagReading(60, [10, 12, 11], r, false)).toEqual(['LONJAKAN']);
    expect(flagReading(14, [10, 12, 11], r, false)).toEqual([]);
    expect(flagReading(0, [10, 12, 11], r, false)).toEqual(['NOL']);
    expect(flagReading(4, [0, 0, 0], r, false)).toEqual([]);
    expect(flagReading(20, [10], r, true)).toEqual(['METER_DIGANTI']);
    expect(flagReading(60, [10], r, false)).toEqual([]); // riwayat belum cukup
  });
});
