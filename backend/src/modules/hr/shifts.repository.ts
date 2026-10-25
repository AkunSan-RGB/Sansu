import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, and, eq } from 'drizzle-orm';
import { shiftTemplates, employees, shiftAssignments } from '../../db/schema';
import { addDays } from '../../common/utils/dates';

/** Akses data untuk Shifts: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class ShiftsRepository {
  /** Dipakai oleh ShiftsService.staff */
  queryEmployee(db: DbOrTx, tenantId: string) {
    return db.execute<{ id: string; code: string; name: string; jobTitle: string | null; isActive: boolean }>(sql`
      SELECT id, code, name, job_title AS "jobTitle", is_active AS "isActive" FROM employees WHERE tenant_id = ${tenantId} AND is_active ORDER BY name`);
  }

  /** Dipakai oleh ShiftsService.templates */
  queryShiftTemplate(db: DbOrTx, tenantId: string) {
    return db.execute<Record<string, unknown>>(sql`
      SELECT t.id, t.name, t.start_time AS "startTime", t.end_time AS "endTime", t.min_staff AS "minStaff", t.premium_rate_id AS "premiumRateId", t.is_active AS "isActive",
             sr.name AS "premiumRateName", sr.rate AS "premiumRate"
      FROM shift_templates t LEFT JOIN service_rates sr ON sr.id = t.premium_rate_id WHERE t.tenant_id = ${tenantId} ORDER BY t.start_time, t.name`);
  }

  /** Dipakai oleh ShiftsService.createTemplate */
  findShiftTemplatesByName(db: DbOrTx, tenantId: string, name: string) {
    return db
      .select({ id: shiftTemplates.id })
      .from(shiftTemplates)
      .where(and(eq(shiftTemplates.tenantId, tenantId), eq(shiftTemplates.name, name.trim())));
  }

  /** Dipakai oleh ShiftsService.updateTemplate */
  updateShiftTemplatesById(
    db: DbOrTx,
    minStaff: number | undefined,
    premiumRateId: string | null | undefined,
    isActive: boolean | undefined,
    id: string,
  ) {
    return db
      .update(shiftTemplates)
      .set({ minStaff: minStaff, premiumRateId: premiumRateId, isActive: isActive })
      .where(eq(shiftTemplates.id, id))
      .returning();
  }

  /** Dipakai oleh ShiftsService.assignOne */
  queryEmployeeForAssignOne(db: DbOrTx, employeeId: string, tenantId: string) {
    return db.execute(sql`SELECT id FROM employees WHERE id = ${employeeId} AND tenant_id = ${tenantId} FOR UPDATE`);
  }

  /** Dipakai oleh ShiftsService.assignOne */
  findEmployeesById(db: DbOrTx, employeeId: string) {
    return db.select().from(employees).where(eq(employees.id, employeeId));
  }

  /** Dipakai oleh ShiftsService.assignOne */
  queryLeaveRequest(db: DbOrTx, employeeId: string, date: string) {
    return db.execute(
      sql`SELECT 1 FROM leave_requests WHERE employee_id = ${employeeId} AND status = 'APPROVED' AND start_date <= ${date} AND end_date >= ${date} LIMIT 1`,
    );
  }

  /** Dipakai oleh ShiftsService.assignOne */
  queryShiftAssignment(db: DbOrTx, employeeId: string, date: string) {
    return db.execute<{ id: string; work_date: string; start_time: string; end_time: string; template_id: string }>(sql`
        SELECT a.id, a.work_date::text, t.start_time, t.end_time, a.template_id FROM shift_assignments a JOIN shift_templates t ON t.id = a.template_id
        WHERE a.employee_id = ${employeeId} AND a.work_date BETWEEN ${addDays(date, -8)} AND ${addDays(date, 8)}`);
  }

  /** Dipakai oleh ShiftsService.assignOne */
  queryShiftAssignmentForAssignOne(db: DbOrTx, employeeId: string, ws: string) {
    return db.execute<{ start_time: string; end_time: string }>(sql`
        SELECT t.start_time, t.end_time FROM shift_assignments a JOIN shift_templates t ON t.id = a.template_id WHERE a.employee_id = ${employeeId} AND a.work_date BETWEEN ${ws} AND ${addDays(ws, 6)}`);
  }

  /** Dipakai oleh ShiftsService.assignOne */
  insertShiftAssignments(db: DbOrTx, tenantId: string, employeeId: string, id: string, date: string, sub: string) {
    return db
      .insert(shiftAssignments)
      .values({ tenantId: tenantId, employeeId: employeeId, templateId: id, workDate: date, createdById: sub })
      .returning({ id: shiftAssignments.id });
  }

  /** Dipakai oleh ShiftsService.unassign */
  queryServiceWorkEntry(db: DbOrTx, id: string) {
    return db.execute(
      sql`SELECT 1 FROM service_work_entries WHERE shift_assignment_id = ${id} AND status IN ('PENDING','APPROVED') LIMIT 1`,
    );
  }

  /** Dipakai oleh ShiftsService.unassign */
  deleteShiftAssignmentsById(db: DbOrTx, id: string) {
    return db.delete(shiftAssignments).where(eq(shiftAssignments.id, id));
  }

  /** Dipakai oleh ShiftsService.roster */
  queryShiftAssignmentForRoster(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<Record<string, unknown>>(sql`
      SELECT a.id, a.employee_id AS "employeeId", e.code AS "employeeCode", e.name AS "employeeName", a.template_id AS "templateId", t.name AS "templateName",
             a.work_date::text AS "workDate", t.start_time AS "startTime", t.end_time AS "endTime",
             (SELECT w.status FROM service_work_entries w WHERE w.shift_assignment_id = a.id AND w.status IN ('PENDING','APPROVED') LIMIT 1) AS "premiumStatus",
             (SELECT at.status::text FROM attendances at WHERE at.employee_id = a.employee_id AND at.date = a.work_date) AS "attendance"
      FROM shift_assignments a JOIN employees e ON e.id = a.employee_id JOIN shift_templates t ON t.id = a.template_id
      WHERE a.tenant_id = ${tenantId} AND a.work_date BETWEEN ${from} AND ${to} ORDER BY a.work_date, t.start_time, e.name`);
  }
}
