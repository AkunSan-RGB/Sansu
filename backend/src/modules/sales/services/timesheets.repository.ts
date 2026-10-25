import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { sql } from 'drizzle-orm';
import { ApproveDto, TimerStartDto } from './timesheets.dto';
import { AuthUser } from '../../../common/auth/auth-user';
import { EntriesQuery } from './timesheets.shared';

/** Akses data untuk Timesheets: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class TimesheetsRepository {
  /** Dipakai oleh TimesheetService.ownEmployee */
  queryEmployee(db: DbOrTx, tenantId: string, sub: string) {
    return db.execute<{ id: string }>(
      sql`SELECT id FROM employees WHERE tenant_id = ${tenantId} AND user_id = ${sub} LIMIT 1`,
    );
  }

  /** Dipakai oleh TimesheetService.resolveRate */
  queryResolveRate(db: DbOrTx, projectId: string | null, employeeId: string, tenantId: string, date: string) {
    return db.execute<{ rate: string }>(sql`
      SELECT rate FROM (
        SELECT rate, valid_from, created_at,
          CASE WHEN project_id IS NOT DISTINCT FROM ${projectId}::uuid AND project_id IS NOT NULL AND employee_id = ${employeeId}::uuid THEN 4
               WHEN project_id IS NOT DISTINCT FROM ${projectId}::uuid AND project_id IS NOT NULL AND employee_id IS NULL THEN 3
               WHEN project_id IS NULL AND employee_id = ${employeeId}::uuid THEN 2
               WHEN project_id IS NULL AND employee_id IS NULL THEN 1 ELSE 0 END AS spec
        FROM billing_rates WHERE tenant_id = ${tenantId} AND valid_from <= ${date}::date) x
      WHERE spec > 0 ORDER BY spec DESC, valid_from DESC, created_at DESC LIMIT 1`);
  }

  /** Dipakai oleh TimesheetService.dayHours */
  queryTimeEntry(db: DbOrTx, tenantId: string, employeeId: string, date: string, exceptId: string | undefined) {
    return db.execute<{ h: string }>(
      sql`SELECT COALESCE(SUM(hours), 0) AS h FROM time_entries WHERE tenant_id = ${tenantId} AND employee_id = ${employeeId} AND work_date = ${date} AND status NOT IN ('REJECTED', 'WRITTEN_OFF') ${exceptId ? sql`AND id <> ${exceptId}` : sql``}`,
    );
  }

  /** Dipakai oleh TimesheetService.create */
  queryEmployeeForCreate(db: DbOrTx, employeeId: string, tenantId: string) {
    return db.execute<{ id: string; is_active: boolean | null }>(
      sql`SELECT id FROM employees WHERE id = ${employeeId} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
  }

  /** Dipakai oleh TimesheetService.create */
  queryProject(db: DbOrTx, projectId: string, tenantId: string) {
    return db.execute<{ id: string; customer_id: string; status: string }>(
      sql`SELECT id, customer_id, status FROM projects WHERE id = ${projectId} AND tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh TimesheetService.create */
  queryCustomer(db: DbOrTx, customerId: string, tenantId: string) {
    return db.execute(sql`SELECT 1 FROM customers WHERE id = ${customerId} AND tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh TimesheetService.submit */
  querySubmit(db: DbOrTx, id: string) {
    return db.execute(
      sql`UPDATE time_entries SET status = 'SUBMITTED', submitted_at = now(), decision_note = NULL WHERE id = ${id}`,
    );
  }

  /** Dipakai oleh TimesheetService.approve */
  queryEmployeeForApprove(db: DbOrTx, employee_id: string) {
    return db.execute<{ user_id: string | null }>(sql`SELECT user_id FROM employees WHERE id = ${employee_id}`);
  }

  /** Dipakai oleh TimesheetService.approve */
  queryApprove(db: DbOrTx, rate: string | null, dto: ApproveDto, u: AuthUser, id: string) {
    return db.execute(
      sql`UPDATE time_entries SET status = 'APPROVED', rate = ${rate}, rate_note = ${dto.rate !== undefined ? dto.rateNote!.trim() : null}, decided_by_id = ${u.sub}, decided_at = now(), decision_note = ${dto.note ?? null} WHERE id = ${id}`,
    );
  }

  /** Dipakai oleh TimesheetService.reject */
  queryReject(db: DbOrTx, sub: string, reason: string, id: string) {
    return db.execute(
      sql`UPDATE time_entries SET status = 'REJECTED', decided_by_id = ${sub}, decided_at = now(), decision_note = ${reason} WHERE id = ${id}`,
    );
  }

  /** Dipakai oleh TimesheetService.writeOff */
  queryWriteOff(db: DbOrTx, reason: string, sub: string, id: string) {
    return db.execute(
      sql`UPDATE time_entries SET status = 'WRITTEN_OFF', decision_note = ${reason}, decided_by_id = ${sub}, decided_at = now() WHERE id = ${id}`,
    );
  }

  /** Dipakai oleh TimesheetService.list */
  queryTimeEntryForList(
    db: DbOrTx,
    u: AuthUser,
    onlyId: string | undefined,
    scoped: boolean,
    own: string | null,
    q: EntriesQuery,
  ) {
    return db.execute(sql`
      SELECT t.id, t.employee_id AS "employeeId", e.name AS "employeeName", t.project_id AS "projectId", p.name AS "projectName", t.customer_id AS "customerId", c.name AS "customerName",
             t.work_date AS "workDate", t.hours, t.description, t.billable, t.rate, (t.hours * COALESCE(t.rate, 0)) AS amount, t.rate_note AS "rateNote", t.status,
             t.decision_note AS "decisionNote", t.invoice_id AS "invoiceId", t.created_by_id AS "createdById", t.created_at AS "createdAt"
      FROM time_entries t JOIN employees e ON e.id = t.employee_id JOIN customers c ON c.id = t.customer_id LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.tenant_id = ${u.tenantId}
        ${onlyId ? sql`AND t.id = ${onlyId}` : sql``}
        ${scoped ? sql`AND (t.employee_id = ${own}::uuid OR t.created_by_id = ${u.sub})` : sql``}
        ${q.status ? sql`AND t.status = ${q.status}` : sql``} ${q.employeeId ? sql`AND t.employee_id = ${q.employeeId}` : sql``} ${q.customerId ? sql`AND t.customer_id = ${q.customerId}` : sql``}
        ${q.from ? sql`AND t.work_date >= ${q.from}` : sql``} ${q.to ? sql`AND t.work_date <= ${q.to}` : sql``}
      ORDER BY t.work_date DESC, t.created_at DESC LIMIT 500`);
  }

  /** Dipakai oleh TimesheetService.createRate */
  queryEmployeeForCreateRate(db: DbOrTx, employeeId: string, tenantId: string) {
    return db.execute(sql`SELECT 1 FROM employees WHERE id = ${employeeId} AND tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh TimesheetService.createRate */
  queryProjectForCreateRate(db: DbOrTx, projectId: string, tenantId: string) {
    return db.execute(sql`SELECT 1 FROM projects WHERE id = ${projectId} AND tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh TimesheetService.unbilled */
  queryTimeEntryForUnbilled(db: DbOrTx, tenantId: string) {
    return db.execute(sql`
      SELECT t.customer_id AS "customerId", c.name AS "customerName", t.project_id AS "projectId", p.name AS "projectName",
             COUNT(*)::int AS entries, SUM(t.hours) AS hours, SUM(t.hours * t.rate) AS amount, MIN(t.work_date) AS oldest
      FROM time_entries t JOIN customers c ON c.id = t.customer_id LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.tenant_id = ${tenantId} AND t.status = 'APPROVED' AND t.billable
      GROUP BY t.customer_id, c.name, t.project_id, p.name ORDER BY MIN(t.work_date)`);
  }

  /** Dipakai oleh TimesheetService.bill */
  queryTimeEntryForBill(db: DbOrTx, tenantId: string, ids: string[]) {
    return db.execute<{ id: string; hours: string; rate: string }>(
      sql`SELECT id, hours, rate FROM time_entries WHERE tenant_id = ${tenantId} AND id IN (${sql.join(
        ids.map((i) => sql`${i}::uuid`),
        sql`, `,
      )}) AND status = 'APPROVED' AND billable AND invoice_id IS NULL FOR UPDATE`,
    );
  }

  /** Dipakai oleh TimesheetService.bill */
  queryBill(db: DbOrTx, id: string, ids: string[]) {
    return db.execute(
      sql`UPDATE time_entries SET status = 'BILLED', invoice_id = ${id} WHERE id IN (${sql.join(
        ids.map((i) => sql`${i}::uuid`),
        sql`, `,
      )})`,
    );
  }

  /** Dipakai oleh TimesheetService.timer */
  queryTimeTimer(db: DbOrTx, tenantId: string, emp: string) {
    return db.execute(
      sql`SELECT t.id, t.employee_id AS "employeeId", t.customer_id AS "customerId", c.name AS "customerName", t.project_id AS "projectId", t.description, t.billable, t.started_at AS "startedAt", EXTRACT(EPOCH FROM (now() - t.started_at))::int AS "elapsedSeconds" FROM time_timers t JOIN customers c ON c.id = t.customer_id WHERE t.tenant_id = ${tenantId} AND t.employee_id = ${emp}`,
    );
  }

  /** Dipakai oleh TimesheetService.startTimer */
  queryTimeTimerForStartTimer(
    db: DbOrTx,
    tenantId: string,
    emp: string,
    projectId: string | null,
    customerId: string,
    dto: TimerStartDto,
    sub: string,
  ) {
    return db.execute(
      sql`INSERT INTO time_timers (tenant_id, employee_id, project_id, customer_id, description, billable, created_by_id) VALUES (${tenantId}, ${emp}, ${projectId}, ${customerId}, ${dto.description.trim()}, ${dto.billable ?? true}, ${sub})`,
    );
  }

  /** Dipakai oleh TimesheetService.stopTimer */
  queryTimeTimerForStopTimer(db: DbOrTx, tenantId: string, emp: string) {
    return db.execute<{
      project_id: string | null;
      customer_id: string;
      description: string;
      billable: boolean;
      started_at: Date;
      created_by_id: string;
    }>(
      sql`DELETE FROM time_timers WHERE tenant_id = ${tenantId} AND employee_id = ${emp} RETURNING project_id, customer_id, description, billable, started_at, created_by_id`,
    );
  }

  /** Dipakai oleh TimesheetService.discardTimer */
  queryTimeTimerForDiscardTimer(db: DbOrTx, tenantId: string, emp: string) {
    return db.execute(
      sql`DELETE FROM time_timers WHERE tenant_id = ${tenantId} AND employee_id = ${emp} RETURNING started_at`,
    );
  }

  /** Dipakai oleh TimesheetService.utilization */
  queryEmployeeForUtilization(db: DbOrTx, from: string, to: string, tenantId: string) {
    return db.execute(sql`
      SELECT e.id AS "employeeId", e.name AS employee,
             COALESCE(SUM(t.hours) FILTER (WHERE t.status NOT IN ('REJECTED', 'WRITTEN_OFF')), 0) AS "totalHours",
             COALESCE(SUM(t.hours) FILTER (WHERE t.billable AND t.status NOT IN ('REJECTED', 'WRITTEN_OFF', 'DRAFT')), 0) AS "billableHours",
             COALESCE(SUM(t.hours * t.rate) FILTER (WHERE t.status = 'BILLED'), 0) AS billed,
             COALESCE(SUM(t.hours * t.rate) FILTER (WHERE t.status = 'APPROVED' AND t.billable), 0) AS "approvedUnbilled"
      FROM employees e JOIN time_entries t ON t.employee_id = e.id AND t.work_date BETWEEN ${from} AND ${to}
      WHERE e.tenant_id = ${tenantId} GROUP BY e.id, e.name ORDER BY e.name`);
  }
}
