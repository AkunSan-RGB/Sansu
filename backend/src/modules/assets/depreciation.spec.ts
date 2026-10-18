import { D, ZERO } from '../../common/utils/money';
import { accumulatedThrough, depreciationFor, fiscalDepreciation, monthlyDepreciation } from './depreciation';

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

  it('saldo menurun 1,5×: tarif 37,5% setahun untuk masa 4 tahun, habis tepat di akhir', () => {
    const a = { cost: '48000000', residualValue: '8000000', usefulLifeMonths: 48, method: 'DECLINING_BALANCE_150', depreciationStart: '2026-01-01' };
    expect(monthlyDepreciation(a, ZERO, '2026-01').toNumber()).toBe(1_500_000); // 48 jt × 37,5% / 12
    expect(accumulatedThrough(a, ZERO, '2029-12').toNumber()).toBe(40_000_000);
  });

  it('jumlah angka tahun: 15 jt / 5 tahun → 5, 4, 3, 2, 1 jt per tahun', () => {
    const a = { cost: '15000000', residualValue: '0', usefulLifeMonths: 60, method: 'SUM_OF_YEARS', depreciationStart: '2026-01-01' };
    expect(accumulatedThrough(a, ZERO, '2026-12').toNumber()).toBeCloseTo(5_000_000, 0);
    expect(accumulatedThrough(a, ZERO, '2027-12').toNumber()).toBeCloseTo(9_000_000, 0);
    expect(monthlyDepreciation(a, ZERO, '2026-01').toNumber()).toBeGreaterThan(monthlyDepreciation(a, ZERO, '2027-01').toNumber());
    expect(accumulatedThrough(a, ZERO, '2030-12').toNumber()).toBe(15_000_000); // habis tepat, tanpa melewati
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

describe('Perubahan metode (berlaku ke depan)', () => {
  const base = { cost: '48000000', residualValue: '0', usefulLifeMonths: 48, method: 'DECLINING_BALANCE', depreciationStart: '2026-01-01' };
  const changes = [{ from: '2027-01', method: 'DECLINING_BALANCE', prevMethod: 'STRAIGHT_LINE', accumulatedAt: '12000000' }];

  it('bulan sebelum bulan berlaku tetap memakai metode lama', () => {
    expect(depreciationFor({ ...base, methodChanges: changes }, ZERO, '2026-06').toNumber()).toBe(1_000_000); // garis lurus 48 jt / 48
  });

  it('mulai bulan berlaku: sisa nilai buku disusutkan dengan metode baru selama sisa masa manfaat', () => {
    // sisa 36 jt, 36 bulan, saldo menurun ganda: 36 jt × (2/3) / 12 = 2 jt
    expect(depreciationFor({ ...base, methodChanges: changes }, D('12000000'), '2027-01').toNumber()).toBe(2_000_000);
  });

  it('total tetap habis tepat di akhir masa manfaat (tidak lebih/kurang dari harga perolehan)', () => {
    let acc = ZERO;
    for (let i = 0; i < 48; i++) {
      const p = `${2026 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
      acc = acc.plus(depreciationFor({ ...base, methodChanges: changes }, acc, p));
    }
    expect(acc.toNumber()).toBe(48_000_000);
  });

  it('tanpa perubahan memberi hasil sama dengan monthlyDepreciation', () => {
    expect(depreciationFor(base, ZERO, '2026-01').toNumber()).toBe(monthlyDepreciation(base, ZERO, '2026-01').toNumber());
  });
});

describe('Unit produksi', () => {
  const a = { cost: '100000000', residualValue: '10000000', usefulLifeMonths: 60, method: 'UNITS_OF_PRODUCTION', depreciationStart: '2026-01-01', units: { total: 200_000, byPeriod: { '2026-01': 5_000, '2026-02': 0, '2026-03': 10_000 } as Record<string, number> } };

  it('penyusutan = (perolehan − residu) × pemakaian ÷ kapasitas', () => {
    expect(monthlyDepreciation(a, ZERO, '2026-01').toNumber()).toBe(2_250_000); // 90 jt × 5.000 / 200.000
    expect(monthlyDepreciation(a, ZERO, '2026-03').toNumber()).toBe(4_500_000);
  });

  it('tanpa pemakaian (atau sebelum mulai) tidak ada penyusutan', () => {
    expect(monthlyDepreciation(a, ZERO, '2026-02').toNumber()).toBe(0);
    expect(monthlyDepreciation(a, ZERO, '2026-04').toNumber()).toBe(0);
    expect(monthlyDepreciation(a, ZERO, '2025-12').toNumber()).toBe(0);
  });

  it('tidak melewati nilai yang bisa disusutkan walau pemakaian melebihi sisa', () => {
    const b = { ...a, units: { total: 100, byPeriod: { '2026-01': 150 } as Record<string, number> } };
    expect(monthlyDepreciation(b, ZERO, '2026-01').toNumber()).toBe(90_000_000);
    expect(monthlyDepreciation(b, D('90000000'), '2026-02').toNumber()).toBe(0);
  });

  it('tidak dibatasi masa manfaat bulan (mengikuti pemakaian)', () => {
    const c = { ...a, usefulLifeMonths: 1, units: { total: 200_000, byPeriod: { '2030-01': 1_000 } as Record<string, number> } };
    expect(monthlyDepreciation(c, ZERO, '2030-01').toNumber()).toBe(450_000);
  });
});
