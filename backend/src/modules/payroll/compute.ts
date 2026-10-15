/**
 * Hitung satu slip gaji (fungsi murni, mudah diuji).
 *  * Dasar BPJS = gaji pokok + tunjangan tetap (dibatasi plafon masing-masing program)
 *  * Bruto PPh 21 = penghasilan tunai + premi JKK, JKM, BPJS Kesehatan yang dibayar perusahaan
 *  * Pengurang setahun = iuran JHT + JP yang dibayar pegawai
 */
import type { PayrollSettings } from '@sansu/shared';
import { D, Dec, Decimal, money, ZERO } from '../../common/utils/money';
import { pph21Annual, pph21Ter } from './tax';

export interface EmployeeInput {
  ptkp: string;
  baseSalary: string;
  fixedAllowance: string;
  dailyAllowance: string;
  bpjsKes: boolean;
  bpjsTk: boolean;
  bpjsJp: boolean;
  /** Upah per jam bila bukan gaji bulanan (status harian); kosong = (gaji pokok + tunjangan tetap) / pembagi lembur */
  hourlyRate?: string;
}

export interface AttendanceInput {
  workDays: number;
  presentDays: number;
  /** Alpa + cuti tidak dibayar → potongan gaji per hari */
  unpaidDays: number;
  /** Jam lembur per hari kerja (untuk tarif jam pertama 1,5x dan berikutnya 2x) */
  overtimeByDay: number[];
}

export interface YearToDate {
  /** Bulan ke-berapa dalam tahun (1–12) */
  month: number;
  /** Masa pajak terakhir (Desember atau bulan terakhir bekerja) → hitung ulang setahun */
  isFinalPeriod: boolean;
  /** Akumulasi bulan-bulan sebelumnya di tahun yang sama */
  prevGross: Dec;
  prevPension: Dec;
  prevWithheld: Dec;
  prevMonths: number;
}

export interface Adjustments {
  otherIncome?: string;
  otherDeduction?: string;
  /** Upah jasa dari catatan kerja yang disetujui (jam, sesi, borongan, komisi faktur); bukan dasar BPJS */
  serviceIncome?: string;
}

const pct = (base: Dec, rate: number) => money(base.times(rate).div(100));

export function overtimePay(baseHourly: Dec, hoursByDay: number[]): Dec {
  // Kepmenakertrans 102/2004 (hari kerja): jam pertama 1,5x, jam berikutnya 2x upah sejam
  const total = hoursByDay.reduce<Dec>((a, h) => {
    if (h <= 0) return a;
    const first = Math.min(1, h);
    return a.plus(baseHourly.times(first * 1.5)).plus(baseHourly.times(Math.max(0, h - 1) * 2));
  }, ZERO);
  return money(total);
}

export function computePayslip(emp: EmployeeInput, att: AttendanceInput, s: PayrollSettings, ytd: YearToDate, adj: Adjustments = {}) {
  const base = D(emp.baseSalary);
  const fixed = D(emp.fixedAllowance);
  const wage = base.plus(fixed); // upah untuk BPJS & lembur
  const dailyAllowance = money(D(emp.dailyAllowance).times(att.presentDays));
  const hourly = emp.hourlyRate !== undefined ? D(emp.hourlyRate) : wage.div(s.overtimeDivisor);
  const overtime = overtimePay(hourly, att.overtimeByDay);
  const absenceDeduction = att.workDays > 0 ? money(base.div(att.workDays).times(att.unpaidDays)) : ZERO;
  const otherIncome = money(D(adj.otherIncome));
  const otherDeduction = money(D(adj.otherDeduction));
  const serviceIncome = money(D(adj.serviceIncome));

  const grossPay = base.plus(fixed).plus(dailyAllowance).plus(overtime).plus(otherIncome).plus(serviceIncome).minus(absenceDeduction);

  const kesBase = Decimal.min(wage, D(s.bpjsKesCap));
  const jpBase = Decimal.min(wage, D(s.jpCap));
  const bpjsKesEmployee = emp.bpjsKes ? pct(kesBase, 1) : ZERO;
  const bpjsKesCompany = emp.bpjsKes ? pct(kesBase, 4) : ZERO;
  const jhtEmployee = emp.bpjsTk ? pct(wage, 2) : ZERO;
  const jhtCompany = emp.bpjsTk ? pct(wage, 3.7) : ZERO;
  const jkkCompany = emp.bpjsTk ? pct(wage, s.jkkRate) : ZERO;
  const jkmCompany = emp.bpjsTk ? pct(wage, s.jkmRate) : ZERO;
  const jpEmployee = emp.bpjsTk && emp.bpjsJp ? pct(jpBase, 1) : ZERO;
  const jpCompany = emp.bpjsTk && emp.bpjsJp ? pct(jpBase, 2) : ZERO;

  const taxableGross = grossPay.plus(jkkCompany).plus(jkmCompany).plus(bpjsKesCompany);
  const pension = jhtEmployee.plus(jpEmployee);

  let terCategory: string;
  let terRateVal: number;
  let pph21: Dec;
  const ter = pph21Ter(emp.ptkp, taxableGross);
  terCategory = ter.category;
  terRateVal = ter.rate;
  pph21 = ter.tax;
  let annual: ReturnType<typeof pph21Annual> | undefined;
  if (ytd.isFinalPeriod) {
    annual = pph21Annual({
      ptkp: emp.ptkp,
      annualGross: ytd.prevGross.plus(taxableGross),
      annualPensionContrib: ytd.prevPension.plus(pension),
      withheld: ytd.prevWithheld,
      months: ytd.prevMonths + 1,
    });
    // Kelebihan potong tidak dikembalikan lewat slip ini (dicatat 0; selisih dilaporkan di bukti potong A1)
    pph21 = Decimal.max(annual.tax, ZERO);
    terCategory = `${ter.category}*`;
    terRateVal = 0;
  }

  const employeeDeductions = bpjsKesEmployee.plus(jhtEmployee).plus(jpEmployee);
  const netPay = grossPay.minus(employeeDeductions).minus(pph21).minus(otherDeduction);

  return {
    workDays: att.workDays,
    presentDays: att.presentDays,
    absentDays: att.unpaidDays,
    overtimeHours: att.overtimeByDay.reduce((a, h) => a + h, 0),
    baseSalary: money(base),
    fixedAllowance: money(fixed),
    dailyAllowance,
    overtimePay: overtime,
    otherIncome,
    serviceIncome,
    absenceDeduction,
    grossPay: money(grossPay),
    bpjsKesEmployee,
    jhtEmployee,
    jpEmployee,
    bpjsKesCompany,
    jhtCompany,
    jpCompany,
    jkkCompany,
    jkmCompany,
    taxableGross: money(taxableGross),
    terCategory,
    terRate: terRateVal,
    pph21,
    otherDeduction,
    netPay: money(netPay),
    annual,
  };
}

export type PayslipCalc = ReturnType<typeof computePayslip>;
