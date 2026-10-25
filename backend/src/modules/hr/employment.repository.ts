import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { employees, employeeChangeRequests } from '../../db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { ChangeQueryDto } from './employment.dto';

/** Akses data untuk Employment: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class EmploymentRepository {
  /** Dipakai oleh EmploymentService.assertNoDuplicates */
  listEmployeesByIsActive(db: DbOrTx, tenantId: string) {
    return db
      .select({
        id: employees.id,
        code: employees.code,
        name: employees.name,
        nik: employees.nik,
        npwp: employees.npwp,
        bankAccount: employees.bankAccount,
      })
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), eq(employees.isActive, true)));
  }

  /** Dipakai oleh EmploymentService.splitUpdate */
  findEmployeeChangeRequestsByEmployeeIdAndStatus(db: DbOrTx, id: string) {
    return db
      .select({ id: employeeChangeRequests.id })
      .from(employeeChangeRequests)
      .where(and(eq(employeeChangeRequests.employeeId, id), eq(employeeChangeRequests.status, 'PENDING')));
  }

  /** Dipakai oleh EmploymentService.assertCanDecide */
  findEmployeesById(db: DbOrTx, employeeId: string) {
    return db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, employeeId));
  }

  /** Dipakai oleh EmploymentService.listChanges */
  queryEmployeeChangeRequest(db: DbOrTx, u: AuthUser, q: ChangeQueryDto) {
    return db.execute<Record<string, unknown>>(sql`
      SELECT c.id, c.employee_id AS "employeeId", e.code AS "employeeCode", e.name AS "employeeName", c.changes, c.reason, c.status,
             c.requested_by_id AS "requestedById", ru.name AS "requestedByName", du.name AS "decidedByName", c.decision_note AS "decisionNote",
             c.created_at AS "createdAt", c.decided_at AS "decidedAt"
      FROM employee_change_requests c JOIN employees e ON e.id = c.employee_id
      LEFT JOIN users ru ON ru.id = c.requested_by_id LEFT JOIN users du ON du.id = c.decided_by_id
      WHERE c.tenant_id = ${u.tenantId} ${q.status ? sql`AND c.status = ${q.status}` : sql``}
      ORDER BY c.created_at DESC LIMIT 300`);
  }

  /** Dipakai oleh EmploymentService.approveChange */
  findEmployeesByIdForApproveChange(db: DbOrTx, employeeId: string) {
    return db.select().from(employees).where(eq(employees.id, employeeId)).for('update');
  }

  /** Dipakai oleh EmploymentService.alerts */
  listEmployeesByIsActiveForAlerts(db: DbOrTx, tenantId: string) {
    return db
      .select()
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), eq(employees.isActive, true)));
  }

  /** Dipakai oleh EmploymentService.alerts */
  queryEmployeeChangeRequestForAlerts(db: DbOrTx, tenantId: string) {
    return db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM employee_change_requests WHERE tenant_id = ${tenantId} AND status = 'PENDING' AND created_at < now() - interval '3 days'`,
    );
  }
}
