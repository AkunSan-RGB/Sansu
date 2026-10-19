import { sql } from 'drizzle-orm';
import { Builder, num, rows } from './types';

export const hrReport: Builder = async (c) => {
  const pFrom = c.from.slice(0, 7);
  const pTo = c.to.slice(0, 7);
  const [head] = await rows<{ n: string }>(c, sql`SELECT COUNT(*)::text AS n FROM employees WHERE tenant_id = ${c.tenantId} AND is_active`);
  const byDept = await rows(c, sql`SELECT COALESCE(NULLIF(department, ''), '(tanpa bagian)') AS department, COUNT(*)::int AS employees, SUM(base_salary) AS base_salary FROM employees WHERE tenant_id = ${c.tenantId} AND is_active GROUP BY 1 ORDER BY COUNT(*) DESC`);
  const byType = await rows(c, sql`SELECT COALESCE(employment_type, 'TETAP') AS type, COUNT(*)::int AS employees FROM employees WHERE tenant_id = ${c.tenantId} AND is_active GROUP BY 1 ORDER BY 2 DESC`);
  const attendance = await rows(c, sql`
    SELECT e.name AS employee, COUNT(*) FILTER (WHERE a.status = 'HADIR')::int AS present, COUNT(*) FILTER (WHERE a.status = 'IZIN')::int AS permit, COUNT(*) FILTER (WHERE a.status = 'SAKIT')::int AS sick,
      COUNT(*) FILTER (WHERE a.status = 'CUTI')::int AS leave, COUNT(*) FILTER (WHERE a.status = 'ALPA')::int AS absent, COALESCE(SUM(a.overtime_hours), 0) AS overtime
    FROM attendances a JOIN employees e ON e.id = a.employee_id WHERE a.tenant_id = ${c.tenantId} AND a.date BETWEEN ${c.from}::date AND ${c.to}::date GROUP BY e.name ORDER BY e.name LIMIT 300`);
  const leaves = await rows(c, sql`SELECT e.name AS employee, l.type, l.start_date, l.end_date, l.days, l.status FROM leave_requests l JOIN employees e ON e.id = l.employee_id WHERE l.tenant_id = ${c.tenantId} AND l.start_date <= ${c.to}::date AND l.end_date >= ${c.from}::date ORDER BY l.start_date DESC LIMIT 200`);
  const runs = await rows(c, sql`SELECT r.number, r.period, r.status, r.total_gross, r.total_employer_cost, r.total_pph21, r.total_net FROM payroll_runs r WHERE r.tenant_id = ${c.tenantId} AND r.period BETWEEN ${pFrom} AND ${pTo} ORDER BY r.period DESC`);
  const contrib = await rows(c, sql`SELECT r.period, SUM(s.pph21) AS pph21, SUM(s.bpjs_kes_company + s.jht_company + s.jp_company + s.jkk_company + s.jkm_company) AS bpjs_company, SUM(s.bpjs_kes_employee + s.jht_employee + s.jp_employee) AS bpjs_employee FROM payslips s JOIN payroll_runs r ON r.id = s.run_id WHERE r.tenant_id = ${c.tenantId} AND r.period BETWEEN ${pFrom} AND ${pTo} AND r.status <> 'DRAFT' GROUP BY r.period ORDER BY r.period`);
  const present = attendance.reduce((a, r) => a + num(r.present), 0);
  const records = attendance.reduce((a, r) => a + num(r.present) + num(r.permit) + num(r.sick) + num(r.leave) + num(r.absent), 0);
  const leaveDays = leaves.filter((l) => l.status === 'APPROVED').reduce((a, l) => a + num(l.days), 0);
  return {
    kpis: [
      { label: 'Karyawan aktif', value: num(head.n), type: 'int' }, { label: 'Kehadiran', value: records ? (present / records) * 100 : 0, type: 'pct' },
      { label: 'Hari cuti disetujui', value: leaveDays, type: 'int' }, { label: 'Biaya gaji perusahaan', value: runs.filter((r) => r.status !== 'DRAFT').reduce((a, r) => a + num(r.total_employer_cost), 0), type: 'money' },
    ],
    sections: [
      { key: 'karyawan', title: 'Karyawan per bagian', columns: [{ key: 'department', label: 'Bagian' }, { key: 'employees', label: 'Karyawan', type: 'int' }, { key: 'base_salary', label: 'Gaji pokok', type: 'money' }], rows: byDept },
      { key: 'status', title: 'Status kepegawaian', columns: [{ key: 'type', label: 'Status' }, { key: 'employees', label: 'Karyawan', type: 'int' }], rows: byType },
      { key: 'absensi', title: 'Absensi', columns: [{ key: 'employee', label: 'Karyawan' }, { key: 'present', label: 'Hadir', type: 'int' }, { key: 'permit', label: 'Izin', type: 'int' }, { key: 'sick', label: 'Sakit', type: 'int' }, { key: 'leave', label: 'Cuti', type: 'int' }, { key: 'absent', label: 'Alpa', type: 'int' }, { key: 'overtime', label: 'Lembur (jam)', type: 'hours' }], rows: attendance, empty: 'Belum ada absensi pada rentang ini' },
      { key: 'cuti', title: 'Cuti', columns: [{ key: 'employee', label: 'Karyawan' }, { key: 'type', label: 'Jenis' }, { key: 'start_date', label: 'Mulai', type: 'date' }, { key: 'end_date', label: 'Selesai', type: 'date' }, { key: 'days', label: 'Hari', type: 'int' }, { key: 'status', label: 'Status' }], rows: leaves, empty: 'Tidak ada cuti pada rentang ini' },
      { key: 'gaji', title: 'Penggajian', columns: [{ key: 'number', label: 'Proses' }, { key: 'period', label: 'Periode' }, { key: 'status', label: 'Status' }, { key: 'total_gross', label: 'Bruto', type: 'money' }, { key: 'total_employer_cost', label: 'Biaya perusahaan', type: 'money' }, { key: 'total_pph21', label: 'PPh 21', type: 'money' }, { key: 'total_net', label: 'Dibayar', type: 'money' }], rows: runs, empty: 'Belum ada proses gaji pada rentang ini' },
      { key: 'rekap', title: 'Rekap PPh 21 dan BPJS', note: 'Dari slip gaji proses yang sudah dibukukan.', columns: [{ key: 'period', label: 'Periode' }, { key: 'pph21', label: 'PPh 21', type: 'money' }, { key: 'bpjs_company', label: 'BPJS ditanggung perusahaan', type: 'money' }, { key: 'bpjs_employee', label: 'BPJS potongan karyawan', type: 'money' }], rows: contrib },
    ],
  };
};
