import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { tenants, payrollRuns, payslips, employees, attendances } from '../../db/schema';
import { eq, and, sql, asc } from 'drizzle-orm';

/** Akses data untuk Payroll: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class PayrollRepository {
  /** Dipakai oleh PayrollService.getPayslip */
  findTenantsById(db: DbOrTx, tenantId: string) {
    return db
      .select({ name: tenants.name, address: tenants.address, npwp: tenants.npwp })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
  }

  /** Dipakai oleh PayrollService.createRun */
  findPayrollRunsByPeriod(db: DbOrTx, tenantId: string, period: string) {
    return db
      .select({ number: payrollRuns.number })
      .from(payrollRuns)
      .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.period, period)));
  }

  /** Dipakai oleh PayrollService.updatePayslip */
  findPayslipsById(db: DbOrTx, id: string) {
    return db.select().from(payslips).where(eq(payslips.id, id));
  }

  /** Dipakai oleh PayrollService.deleteRun */
  deletePayrollRunsById(db: DbOrTx, id: string) {
    return db.delete(payrollRuns).where(eq(payrollRuns.id, id));
  }

  /** Dipakai oleh PayrollService.post */
  listPayslipsByRunId(db: DbOrTx, id: string) {
    return db.select().from(payslips).where(eq(payslips.runId, id));
  }

  /** Dipakai oleh PayrollService.post */
  listEmployees(db: DbOrTx, tenantId: string) {
    return db
      .select({ id: employees.id, isProduction: employees.isProduction, branchId: employees.branchId })
      .from(employees)
      .where(eq(employees.tenantId, tenantId));
  }

  /** Dipakai oleh PayrollService.netByBranch */
  queryPayslip(db: DbOrTx, runId: string) {
    return db.execute<{ b: string | null; net: string }>(sql`
      SELECT e.branch_id::text AS b, SUM(p.net_pay) AS net FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ${runId} GROUP BY e.branch_id`);
  }

  /** Dipakai oleh PayrollService.pph21Report */
  queryPayslipForPph21Report(db: DbOrTx, tenantId: string, year: number) {
    return db.execute<{
      employee_id: string;
      code: string;
      name: string;
      npwp: string | null;
      nik: string | null;
      ptkp: string;
      months: number;
      gross: string;
      pension: string;
      pph21: string;
    }>(sql`
      SELECT e.id AS employee_id, e.code, e.name, e.npwp, e.nik, e.ptkp, COUNT(*)::int AS months,
             SUM(p.taxable_gross) AS gross, SUM(p.jht_employee + p.jp_employee) AS pension, SUM(p.pph21) AS pph21
      FROM payslips p
      JOIN payroll_runs r ON r.id = p.run_id
      JOIN employees e ON e.id = p.employee_id
      WHERE r.tenant_id = ${tenantId} AND r.status <> 'DRAFT' AND r.period LIKE ${`${year}-%`}
      GROUP BY e.id ORDER BY e.code`);
  }

  /** Dipakai oleh PayrollService.pph21Report */
  queryPayslipForPph21Report2(db: DbOrTx, tenantId: string, year: number) {
    return db.execute<{ period: string; gross: string; pph21: string; n: number }>(sql`
      SELECT r.period, SUM(p.taxable_gross) AS gross, SUM(p.pph21) AS pph21, COUNT(*)::int AS n
      FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
      WHERE r.tenant_id = ${tenantId} AND r.status <> 'DRAFT' AND r.period LIKE ${`${year}-%`}
      GROUP BY r.period ORDER BY r.period`);
  }

  /** Dipakai oleh PayrollService.bpjsReport */
  queryPayslipForBpjsReport(db: DbOrTx, tenantId: string, period: string) {
    return db.execute<Record<string, string | null>>(sql`
      SELECT e.id, e.code, e.name, e.nik, e.join_date::text AS "joinDate", e.resign_date::text AS "resignDate",
             (p.base_salary + p.fixed_allowance)::text AS wage,
             p.bpjs_kes_company AS "kesCompany", p.bpjs_kes_employee AS "kesEmployee",
             p.jht_company AS "jhtCompany", p.jht_employee AS "jhtEmployee",
             p.jkk_company AS "jkkCompany", p.jkm_company AS "jkmCompany",
             p.jp_company AS "jpCompany", p.jp_employee AS "jpEmployee"
      FROM payslips p JOIN payroll_runs r ON r.id = p.run_id JOIN employees e ON e.id = p.employee_id
      WHERE r.tenant_id = ${tenantId} AND r.status <> 'DRAFT' AND r.period = ${period}
      ORDER BY e.code`);
  }

  /** Dipakai oleh PayrollService.bpjsReport */
  findPayrollRunsByPeriodForBpjsReport(db: DbOrTx, tenantId: string, period: string) {
    return db
      .select({ number: payrollRuns.number, status: payrollRuns.status })
      .from(payrollRuns)
      .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.period, period)));
  }

  /** Dipakai oleh PayrollService.bpjsReport */
  queryEmployee(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ code: string; name: string; kind: string; date: string }>(sql`
      SELECT code, name, 'MASUK' AS kind, join_date::text AS date FROM employees WHERE tenant_id = ${tenantId} AND join_date BETWEEN ${from} AND ${to}
      UNION ALL
      SELECT code, name, 'KELUAR' AS kind, resign_date::text AS date FROM employees WHERE tenant_id = ${tenantId} AND resign_date BETWEEN ${from} AND ${to}
      ORDER BY date`);
  }

  /** Dipakai oleh PayrollService.bpjsReport */
  queryTaxPayment(db: DbOrTx, tenantId: string, period: string) {
    return db.execute<{ amount: string; date: string | null; ntpn: string | null }>(sql`
      SELECT COALESCE(SUM(amount), 0)::text AS amount, MAX(date)::text AS date, STRING_AGG(NULLIF(ntpn, ''), ', ') AS ntpn
      FROM tax_payments WHERE tenant_id = ${tenantId} AND type = 'BPJS' AND period = ${period}`);
  }

  /** Dipakai oleh PayrollService.generate */
  listEmployeesByCode(db: DbOrTx, tenantId: string) {
    return db.select().from(employees).where(eq(employees.tenantId, tenantId)).orderBy(asc(employees.code));
  }

  /** Dipakai oleh PayrollService.generate */
  listPayslipsByRunIdForGenerate(db: DbOrTx, runId: string) {
    return db.select().from(payslips).where(eq(payslips.runId, runId));
  }

  /** Dipakai oleh PayrollService.generate */
  deletePayslipsById(db: DbOrTx, id: string) {
    return db.delete(payslips).where(eq(payslips.id, id));
  }

  /** Dipakai oleh PayrollService.generate */
  listAttendancesByDate(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db
      .select()
      .from(attendances)
      .where(and(eq(attendances.tenantId, tenantId), sql`${attendances.date} BETWEEN ${from} AND ${to}`));
  }

  /** Dipakai oleh PayrollService.generate */
  queryPayslipForGenerate(db: DbOrTx, tenantId: string, year: number, period: string) {
    return db.execute<{ employee_id: string; gross: string; pension: string; pph: string; n: number }>(sql`
      SELECT p.employee_id, SUM(p.taxable_gross) AS gross, SUM(p.jht_employee + p.jp_employee) AS pension,
             SUM(p.pph21) AS pph, COUNT(*)::int AS n
      FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
      WHERE r.tenant_id = ${tenantId} AND r.status <> 'DRAFT' AND r.period >= ${`${year}-01`} AND r.period < ${period}
      GROUP BY p.employee_id`);
  }

  /** Dipakai oleh PayrollService.lockRun */
  queryPayrollRun(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<{ id: string }>(
      sql`SELECT id FROM payroll_runs WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
  }

  /** Dipakai oleh PayrollService.lockRun */
  findPayrollRunsById(db: DbOrTx, id: string) {
    return db.select().from(payrollRuns).where(eq(payrollRuns.id, id));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh PayrollService.generate */
  insertPayslips(db: DbOrTx, values: typeof payslips.$inferInsert) {
    return db.insert(payslips).values(values);
  }
}
