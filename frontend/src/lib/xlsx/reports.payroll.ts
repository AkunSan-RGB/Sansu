/**
 * Lembar Excel untuk setiap laporan SANSU. Semua fungsi murni: data API → SheetSpec.
 * Angka turunan ditulis sebagai rumus (dengan nilai hasil), angka sumber sebagai nilai.
 */
import { type Payslip, type PayrollRun } from '@sansu/shared';
import { n, SheetBuilder, total, type SheetSpec } from './book';
import { BULAN, tgl, RP, money } from './reports.shared';

// ============ Penggajian ============
export function payrollSheets(run: PayrollRun, slips: Payslip[], company?: string): SheetSpec[] {
  const per = `Periode ${run.period} · dibayar ${tgl(run.payDate)}`;
  const s = new SheetBuilder('Rekap Gaji', {
    company,
    title: `Rekap Gaji ${run.number}`,
    subtitle: [per, RP],
    columns: [
      { key: 'code', header: 'Kode', fmt: 'code', width: 10 },
      { key: 'name', header: 'Nama pegawai', width: 26 },
      { key: 'wd', header: 'Hari kerja', fmt: 'int', width: 8 },
      { key: 'pd', header: 'Hadir', fmt: 'int', width: 8 },
      money('base', 'Gaji pokok'),
      money('fix', 'Tunjangan tetap'),
      money('daily', 'Uang makan/ transport'),
      money('ot', 'Lembur'),
      money('oth', 'Bonus/ lainnya'),
      money('abs', 'Potongan absen'),
      money('gross', 'Penghasilan bruto'),
      money('kes', 'BPJS Kesehatan'),
      money('jht', 'BPJS JHT'),
      money('jp', 'BPJS JP'),
      money('pph', 'PPh 21'),
      money('loan', 'Kasbon/ potongan lain'),
      money('ded', 'Jumlah potongan'),
      money('net', 'Gaji bersih'),
      { key: 'bank', header: 'Bank', width: 10 },
      { key: 'acct', header: 'No. rekening', fmt: 'code', width: 16 },
    ],
    freezeCols: 2,
    filter: true,
    landscape: true,
  });
  const first = s.next;
  for (const p of slips) {
    const r = s.next;
    const a = (k: string) => s.ref(k, r);
    const v = {
      base: n(p.baseSalary) ?? 0,
      fix: n(p.fixedAllowance) ?? 0,
      daily: n(p.dailyAllowance) ?? 0,
      ot: n(p.overtimePay) ?? 0,
      oth: n(p.otherIncome) ?? 0,
      abs: n(p.absenceDeduction) ?? 0,
      kes: n(p.bpjsKesEmployee) ?? 0,
      jht: n(p.jhtEmployee) ?? 0,
      jp: n(p.jpEmployee) ?? 0,
      pph: n(p.pph21) ?? 0,
      loan: n(p.otherDeduction) ?? 0,
    };
    const gross = v.base + v.fix + v.daily + v.ot + v.oth - v.abs;
    const ded = v.kes + v.jht + v.jp + v.pph + v.loan;
    s.row({
      code: p.employee.code,
      name: p.employee.name,
      wd: p.workDays,
      pd: p.presentDays,
      ...v,
      gross: s.verified(`SUM(${a('base')}:${a('oth')})-${a('abs')}`, n(p.grossPay), gross),
      ded: s.fx(`SUM(${a('kes')}:${a('loan')})`, ded),
      net: s.verified(`${a('gross')}-${a('ded')}`, n(p.netPay), (n(p.grossPay) ?? gross) - ded),
      bank: p.employee.bankName ?? '',
      acct: p.employee.bankAccount ?? '',
    });
  }
  const last = s.next - 1;
  const keys = ['base', 'fix', 'daily', 'ot', 'oth', 'abs', 'gross', 'kes', 'jht', 'jp', 'pph', 'loan', 'ded', 'net'];
  s.totals(`Jumlah (${slips.length} pegawai)`, first, last, keys, {
    cache: { gross: n(run.totalGross), pph: n(run.totalPph21), net: n(run.totalNet) },
    style: 'grand',
    labelKey: 'name',
  });

  const c = new SheetBuilder('Iuran Perusahaan', {
    company,
    title: `Iuran BPJS Ditanggung Perusahaan · ${run.number}`,
    subtitle: [per, RP],
    columns: [
      { key: 'code', header: 'Kode', fmt: 'code', width: 10 },
      { key: 'name', header: 'Nama pegawai', width: 26 },
      money('gross', 'Penghasilan bruto'),
      money('kes', 'BPJS Kesehatan'),
      money('jht', 'JHT'),
      money('jp', 'JP'),
      money('jkk', 'JKK'),
      money('jkm', 'JKM'),
      money('tot', 'Jumlah iuran'),
      money('cost', 'Total biaya pegawai'),
    ],
    freezeCols: 2,
    filter: true,
  });
  const f2 = c.next;
  for (const p of slips) {
    const r2 = c.next;
    const a = (k: string) => c.ref(k, r2);
    const v = {
      kes: n(p.bpjsKesCompany) ?? 0,
      jht: n(p.jhtCompany) ?? 0,
      jp: n(p.jpCompany) ?? 0,
      jkk: n(p.jkkCompany) ?? 0,
      jkm: n(p.jkmCompany) ?? 0,
    };
    const tot = v.kes + v.jht + v.jp + v.jkk + v.jkm;
    c.row({
      code: p.employee.code,
      name: p.employee.name,
      gross: n(p.grossPay),
      ...v,
      tot: c.fx(`SUM(${a('kes')}:${a('jkm')})`, tot),
      cost: c.fx(`${a('gross')}+${a('tot')}`, (n(p.grossPay) ?? 0) + tot),
    });
  }
  c.totals('Jumlah', f2, c.next - 1, ['gross', 'kes', 'jht', 'jp', 'jkk', 'jkm', 'tot', 'cost'], {
    cache: { cost: n(run.totalEmployerCost) },
    style: 'grand',
    labelKey: 'name',
  });
  return [s.spec, c.spec];
}
export interface Pph21Report {
  year: number;
  /** 1–12 bila laporan dipersempit ke satu masa; kosong = setahun */
  month?: number | null;
  employees: {
    code: string;
    name: string;
    nik: string | null;
    npwp: string | null;
    ptkp: string;
    months: number;
    gross: string;
    pension: string;
    pph21: string;
  }[];
  monthly: { period: string; gross: string; pph21: string; n: number }[];
}
export function pph21Sheets(p: Pph21Report, company?: string): SheetSpec[] {
  const masa = p.month ? `${BULAN[p.month - 1]} ${p.year}` : `Tahun ${p.year}`;
  const m = new SheetBuilder('Per Masa Pajak', {
    company,
    title: `Rekap PPh 21 ${masa} · per masa pajak`,
    subtitle: ['Bahan SPT Masa PPh 21 · hanya penggajian yang sudah diposting', RP],
    columns: [
      { key: 'period', header: 'Masa pajak', width: 16 },
      { key: 'n', header: 'Jumlah pegawai', fmt: 'int', width: 12 },
      money('gross', 'Penghasilan bruto'),
      money('pph', 'PPh 21 dipotong'),
      { key: 'rate', header: 'Tarif efektif', fmt: 'pct', width: 11 },
    ],
  });
  const a = m.next;
  for (const x of p.monthly) {
    const r = m.next;
    const [y, mm] = x.period.split('-').map(Number);
    const g = n(x.gross) ?? 0;
    m.row({
      period: `${BULAN[mm - 1]} ${y}`,
      n: x.n,
      gross: g,
      pph: n(x.pph21),
      rate: m.fx(`IF(${m.ref('gross', r)}=0,0,${m.ref('pph', r)}/${m.ref('gross', r)})`, g ? (n(x.pph21) ?? 0) / g : 0),
    });
  }
  const b = m.next - 1;
  const tg = total(p.monthly.map((x) => n(x.gross)));
  const tp = total(p.monthly.map((x) => n(x.pph21)));
  m.totals('Jumlah setahun', a, b, ['gross', 'pph'], {
    cache: { gross: tg, pph: tp },
    style: 'grand',
    extra: (t) => ({
      rate: m.fx(`IF(${m.ref('gross', t)}=0,0,${m.ref('pph', t)}/${m.ref('gross', t)})`, tg ? tp / tg : 0),
    }),
  });

  const e = new SheetBuilder('Per Pegawai', {
    company,
    title: `Rekap PPh 21 ${masa} · per pegawai`,
    subtitle: ['Bahan bukti potong 1721-A1', RP],
    columns: [
      { key: 'code', header: 'Kode', fmt: 'code', width: 10 },
      { key: 'name', header: 'Nama pegawai', width: 26 },
      { key: 'nik', header: 'NIK', fmt: 'code', width: 18 },
      { key: 'npwp', header: 'NPWP', fmt: 'code', width: 22 },
      { key: 'ptkp', header: 'Status PTKP', width: 10 },
      { key: 'months', header: 'Jumlah bulan', fmt: 'int', width: 9 },
      money('gross', 'Bruto setahun'),
      money('pension', 'Iuran JHT + JP'),
      money('pph', 'PPh 21 dipotong'),
    ],
    filter: true,
    freezeCols: 2,
  });
  const a2 = e.next;
  for (const x of p.employees)
    e.row({
      code: x.code,
      name: x.name,
      nik: x.nik ?? '',
      npwp: x.npwp ?? '',
      ptkp: x.ptkp,
      months: x.months,
      gross: n(x.gross),
      pension: n(x.pension),
      pph: n(x.pph21),
    });
  e.totals('Jumlah', a2, e.next - 1, ['gross', 'pension', 'pph'], {
    style: 'grand',
    labelKey: 'name',
    cache: {
      gross: total(p.employees.map((x) => n(x.gross))),
      pension: total(p.employees.map((x) => n(x.pension))),
      pph: total(p.employees.map((x) => n(x.pph21))),
    },
  });
  return [m.spec, e.spec];
}
