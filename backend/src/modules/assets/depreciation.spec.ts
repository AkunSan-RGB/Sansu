import { D, ZERO } from '../../common/utils/money';
import { accumulatedThrough, fiscalDepreciation, monthlyDepreciation } from './depreciation';

describe('Penyusutan komersial', () => {
  const car = { cost: '240000000', residualValue: '0', usefulLifeMonths: 96, method: 'STRAIGHT_LINE', depreciationStart: '2026-01-01' };

  it('garis lurus: 240 jt / 96 bulan = 2,5 jt per bulan', () => {
    expect(monthlyDepreciation(car, ZERO, '2026-01').toNumber()).toBe(2_500_000);
    expect(monthlyDepreciation(car, ZERO, '2025-12').toNumber()).toBe(0);
  });

  it('habis tepat di akhir masa manfaat, tidak melewati nilai residu', () => {
    const acc = accumulatedThrough(car, ZERO, '2033-12');
    expect(acc.toNumber()).toBe(240_000_000);
    expect(monthlyDepreciation(car, acc, '2034-01').toNumber()).toBe(0);
  });

  it('pembulatan sen: sisa dibebankan di bulan terakhir', () => {
    const a = { cost: '1000000', residualValue: '0', usefulLifeMonths: 3, method: 'STRAIGHT_LINE', depreciationStart: '2026-01-01' };
    expect(accumulatedThrough(a, ZERO, '2026-03').toNumber()).toBe(1_000_000);
    expect(monthlyDepreciation(a, ZERO, '2026-01').toNumber()).toBe(333_333.33);
  });

  it('saldo menurun ganda dengan residu', () => {
    const a = { cost: '48000000', residualValue: '8000000', usefulLifeMonths: 48, method: 'DECLINING_BALANCE', depreciationStart: '2026-01-01' };
    expect(monthlyDepreciation(a, ZERO, '2026-01').toNumber()).toBe(2_000_000); // 48 jt × 50% / 12
    expect(accumulatedThrough(a, ZERO, '2029-12').toNumber()).toBe(40_000_000);
  });

  it('aset lama: akumulasi awal ikut diperhitungkan', () => {
    expect(monthlyDepreciation(car, D('237500000'), '2033-12').toNumber()).toBe(2_500_000);
  });
});

describe('Penyusutan fiskal', () => {
  it('kelompok 2 garis lurus, perolehan Juli: 6/12 × 12,5%', () => {
    const r = fiscalDepreciation('240000000', '2026-07-15', 'GROUP_2', 'STRAIGHT_LINE', 2026);
    expect(r.amount.toNumber()).toBe(15_000_000);
    expect(fiscalDepreciation('240000000', '2026-07-15', 'GROUP_2', 'STRAIGHT_LINE', 2027).amount.toNumber()).toBe(30_000_000);
  });

  it('total fiskal garis lurus = harga perolehan', () => {
    const r = fiscalDepreciation('100000000', '2026-04-01', 'GROUP_1', 'STRAIGHT_LINE', 2030);
    expect(r.accumulatedEnd.toNumber()).toBe(100_000_000);
  });

  it('tanah tidak disusutkan', () => {
    expect(fiscalDepreciation('500000000', '2026-01-01', 'LAND', 'STRAIGHT_LINE', 2026).amount.toNumber()).toBe(0);
  });
});
