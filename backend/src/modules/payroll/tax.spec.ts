import { DEFAULT_PAYROLL } from '../../common/settings.service';
import { D, ZERO } from '../../common/utils/money';
import { computePayslip, overtimePay } from './compute';
import { pasal17, pph21Annual, pph21Ter, ptkpAmount, terCategory } from './tax';

describe('PPh 21 TER', () => {
  it('kategori dari PTKP', () => {
    expect(terCategory('TK/0')).toBe('A');
    expect(terCategory('K/0')).toBe('A');
    expect(terCategory('K/1')).toBe('B');
    expect(terCategory('TK/3')).toBe('B');
    expect(terCategory('K/3')).toBe('C');
  });

  it('batas lapisan inklusif', () => {
    expect(pph21Ter('TK/0', D(5_400_000)).rate).toBe(0);
    expect(pph21Ter('TK/0', D(5_400_001)).rate).toBe(0.25);
    expect(pph21Ter('K/1', D(9_200_000)).rate).toBe(1);
    expect(pph21Ter('K/3', D(12_950_000)).rate).toBe(3);
  });

  it('contoh: TK/0 bruto 10.000.000 → TER A 2% = 200.000', () => {
    expect(pph21Ter('TK/0', D(10_000_000)).tax.toNumber()).toBe(200_000);
  });

  it('PTKP & Pasal 17', () => {
    expect(ptkpAmount('TK/0').toNumber()).toBe(54_000_000);
    expect(ptkpAmount('K/3').toNumber()).toBe(72_000_000);
    expect(pasal17(D(60_000_000)).toNumber()).toBe(3_000_000);
    expect(pasal17(D(100_000_000)).toNumber()).toBe(3_000_000 + 6_000_000);
  });

  it('Desember: PPh setahun dikurangi yang sudah dipotong', () => {
    // bruto 10 jt/bln, JHT+JP pegawai 300 rb/bln, TK/0
    const r = pph21Annual({ ptkp: 'TK/0', annualGross: D(120_000_000), annualPensionContrib: D(3_600_000), withheld: D(2_200_000) });
    expect(r.jobCost.toNumber()).toBe(6_000_000);
    expect(r.pkp.toNumber()).toBe(56_400_000);
    expect(r.annualTax.toNumber()).toBe(2_820_000);
    expect(r.tax.toNumber()).toBe(620_000);
  });
});

describe('Slip gaji', () => {
  const emp = { ptkp: 'TK/0', baseSalary: '8000000', fixedAllowance: '1000000', dailyAllowance: '50000', bpjsKes: true, bpjsTk: true, bpjsJp: true };
  const ytd = { month: 10, isFinalPeriod: false, prevGross: ZERO, prevPension: ZERO, prevWithheld: ZERO, prevMonths: 9 };

  it('lembur jam pertama 1,5x, berikutnya 2x', () => {
    expect(overtimePay(D(10_000), [3]).toNumber()).toBe(15_000 + 40_000);
  });

  it('BPJS, bruto pajak, dan gaji bersih', () => {
    const p = computePayslip(emp, { workDays: 26, presentDays: 26, unpaidDays: 0, overtimeByDay: [] }, DEFAULT_PAYROLL, ytd);
    // upah 9 jt; uang makan 26 x 50 rb
    expect(p.grossPay.toNumber()).toBe(9_000_000 + 1_300_000);
    expect(p.bpjsKesEmployee.toNumber()).toBe(90_000);
    expect(p.bpjsKesCompany.toNumber()).toBe(360_000);
    expect(p.jhtEmployee.toNumber()).toBe(180_000);
    expect(p.jhtCompany.toNumber()).toBe(333_000);
    expect(p.jpEmployee.toNumber()).toBe(90_000);
    expect(p.jpCompany.toNumber()).toBe(180_000);
    expect(p.jkkCompany.toNumber()).toBe(21_600);
    expect(p.jkmCompany.toNumber()).toBe(27_000);
    // bruto pajak = 10.300.000 + 21.600 + 27.000 + 360.000 = 10.708.600 → TER A 3%
    expect(p.taxableGross.toNumber()).toBe(10_708_600);
    expect(p.terRate).toBe(3);
    expect(p.pph21.toNumber()).toBe(321_258);
    expect(p.netPay.toNumber()).toBe(10_300_000 - 360_000 - 321_258);
  });

  it('plafon JP & BPJS Kesehatan', () => {
    const p = computePayslip({ ...emp, baseSalary: '20000000', fixedAllowance: '0' }, { workDays: 26, presentDays: 0, unpaidDays: 0, overtimeByDay: [] }, DEFAULT_PAYROLL, ytd);
    expect(p.bpjsKesEmployee.toNumber()).toBe(120_000);
    expect(p.jpEmployee.toNumber()).toBe(105_474);
  });

  it('potongan alpa per hari dari gaji pokok', () => {
    const p = computePayslip(emp, { workDays: 26, presentDays: 24, unpaidDays: 2, overtimeByDay: [] }, DEFAULT_PAYROLL, ytd);
    expect(p.absenceDeduction.toNumber()).toBe(615_384.62);
  });
});
