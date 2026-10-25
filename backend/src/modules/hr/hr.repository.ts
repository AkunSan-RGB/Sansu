import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, and, eq, inArray, lte, gte } from 'drizzle-orm';
import { projects, employees, attendances, leaveRequests } from '../../db/schema';
import { type AttendanceStatus } from '@sansu/shared';

/** Akses data untuk Hr: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class HrRepository {
  /** Dipakai oleh HrService.accounts */
  queryUser(db: DbOrTx, tenantId: string) {
    return db.execute(
      sql`SELECT u.id, u.name, u.email, u.role, e.id AS "employeeId", e.name AS "employeeName" FROM users u LEFT JOIN employees e ON e.user_id = u.id AND e.tenant_id = u.tenant_id WHERE u.tenant_id = ${tenantId} AND u.is_active ORDER BY u.name`,
    );
  }

  /** Dipakai oleh HrService.linkAccount */
  queryUserForLinkAccount(db: DbOrTx, userId: string, tenantId: string) {
    return db.execute<{ id: string }>(
      sql`SELECT id FROM users WHERE id = ${userId} AND tenant_id = ${tenantId} AND is_active`,
    );
  }

  /** Dipakai oleh HrService.linkAccount */
  queryEmployee(db: DbOrTx, tenantId: string, userId: string, id: string) {
    return db.execute<{ name: string }>(
      sql`SELECT name FROM employees WHERE tenant_id = ${tenantId} AND user_id = ${userId} AND id <> ${id}`,
    );
  }

  /** Dipakai oleh HrService.assertProject */
  findProjectsById(db: DbOrTx, projectId: string, tenantId: string) {
    return db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)));
  }

  /** Dipakai oleh HrService.assertBranch */
  queryBranche(db: DbOrTx, branchId: string, tenantId: string) {
    return db.execute<{ id: string }>(
      sql`SELECT id FROM branches WHERE id = ${branchId} AND tenant_id = ${tenantId} AND is_active`,
    );
  }

  /** Dipakai oleh HrService.updateEmployee */
  findEmployeesById(db: DbOrTx, id: string) {
    return db.select().from(employees).where(eq(employees.id, id));
  }

  /** Dipakai oleh HrService.updateEmployee */
  updateEmployeesById(db: DbOrTx, direct: Record<string, unknown>, id: string) {
    return db
      .update(employees)
      .set({ ...direct, code: (direct.code as string | undefined)?.trim().toUpperCase() })
      .where(eq(employees.id, id))
      .returning();
  }

  /** Dipakai oleh HrService.attendanceDay */
  listAttendancesByDate(db: DbOrTx, tenantId: string, date: string) {
    return db
      .select()
      .from(attendances)
      .where(and(eq(attendances.tenantId, tenantId), eq(attendances.date, date)));
  }

  /** Dipakai oleh HrService.saveAttendance */
  listEmployeesById(db: DbOrTx, tenantId: string, ids: string[]) {
    return db
      .select({ id: employees.id, type: employees.employmentType })
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), inArray(employees.id, ids)));
  }

  /** Dipakai oleh HrService.attendanceMonth */
  queryAttendance(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ employee_id: string; status: AttendanceStatus; n: number; ot: string }>(sql`
      SELECT employee_id, status, COUNT(*)::int AS n, COALESCE(SUM(overtime_hours), 0) AS ot
      FROM attendances WHERE tenant_id = ${tenantId} AND date BETWEEN ${from} AND ${to}
      GROUP BY employee_id, status`);
  }

  /** Dipakai oleh HrService.leaveBalance */
  queryLeaveRequest(db: DbOrTx, tenantId: string, employeeId: string, year: number) {
    return db.execute<{ used: number }>(sql`
      SELECT COALESCE(SUM(days), 0)::int AS used FROM leave_requests
      WHERE tenant_id = ${tenantId} AND employee_id = ${employeeId} AND type = 'ANNUAL' AND status = 'APPROVED'
        AND start_date BETWEEN ${`${year}-01-01`} AND ${`${year}-12-31`}`);
  }

  /** Dipakai oleh HrService.createLeave */
  findLeaveRequestsByEmployeeIdAndStatusAndStartDate(db: DbOrTx, id: string, end: string, start: string) {
    return db
      .select({ id: leaveRequests.id })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.employeeId, id),
          inArray(leaveRequests.status, ['PENDING', 'APPROVED']),
          lte(leaveRequests.startDate, end),
          gte(leaveRequests.endDate, start),
        ),
      );
  }

  /** Dipakai oleh HrService.decideLeave */
  insertAttendances(
    db: DbOrTx,
    values: {
      tenantId: string;
      employeeId: string;
      date: string;
      status: AttendanceStatus;
      overtimeHours: string;
      notes: string | null;
    },
  ) {
    return db
      .insert(attendances)
      .values(values)
      .onConflictDoUpdate({ target: [attendances.employeeId, attendances.date], set: values });
  }

  /** Dipakai oleh HrService.decideLeave */
  updateLeaveRequestsById(db: DbOrTx, decision: 'REJECTED' | 'APPROVED', sub: string, id: string) {
    return db
      .update(leaveRequests)
      .set({ status: decision, decidedById: sub })
      .where(eq(leaveRequests.id, id))
      .returning();
  }
}
