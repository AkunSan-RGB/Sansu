import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql, and, eq } from 'drizzle-orm';
import { serviceRates, employees, projects, attendances, serviceWorkEntries } from '../../db/schema';
import { Dec } from '../../common/utils/money';
import { UpdateRateDto, EntryQueryDto, DecideEntryDto } from './service-work.dto';
import { AuthUser } from '../../common/auth/auth-user';
import { invoiceUsable } from './service-work.shared';

export const MAX_HOURS_PER_MONTH = 260;

/** Akses data untuk ServiceWork: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class ServiceWorkRepository {
  /** Dipakai oleh ServiceWorkService.staff */
  queryEmployee(db: DbOrTx, tenantId: string) {
    return db.execute<{ id: string; code: string; name: string; isActive: boolean; verified: boolean }>(sql`
      SELECT id, code, name, is_active AS "isActive", verified FROM employees WHERE tenant_id = ${tenantId} AND is_active ORDER BY name`);
  }

  /** Dipakai oleh ServiceWorkService.createRate */
  findServiceRatesByName(db: DbOrTx, tenantId: string, name: string) {
    return db
      .select({ id: serviceRates.id })
      .from(serviceRates)
      .where(and(eq(serviceRates.tenantId, tenantId), eq(serviceRates.name, name.trim())));
  }

  /** Dipakai oleh ServiceWorkService.updateRate */
  updateServiceRatesById(db: DbOrTx, rate: Dec, dto: UpdateRateDto, isActive: boolean, id: string) {
    return db
      .update(serviceRates)
      .set({ rate: rate.toFixed(2), isActive: dto.isActive ?? isActive })
      .where(eq(serviceRates.id, id))
      .returning();
  }

  /** Dipakai oleh ServiceWorkService.list */
  queryServiceWorkEntry(db: DbOrTx, u: AuthUser, range: { from: string; to: string } | null, q: EntryQueryDto) {
    return db.execute<Record<string, unknown>>(sql`
      SELECT w.id, w.employee_id AS "employeeId", e.code AS "employeeCode", e.name AS "employeeName", w.rate_id AS "rateId", sr.name AS "rateName", w.unit,
             w.work_date::text AS "workDate", w.project_id AS "projectId", p.code AS "projectCode", w.invoice_id AS "invoiceId", i.number AS "invoiceNumber", w.production_order_id AS "productionOrderId", po.number AS "productionNumber",
             w.quantity, w.rate, w.base_amount AS "baseAmount", w.amount, w.description, w.status, w.created_by_id AS "createdById", cu.name AS "createdByName",
             w.decided_by_id AS "decidedById", du.name AS "decidedByName", w.decision_note AS "decisionNote", w.run_id AS "runId", r.number AS "runNumber", r.status AS "runStatus"
      FROM service_work_entries w
      JOIN employees e ON e.id = w.employee_id
      JOIN service_rates sr ON sr.id = w.rate_id
      LEFT JOIN projects p ON p.id = w.project_id
      LEFT JOIN invoices i ON i.id = w.invoice_id
      LEFT JOIN production_orders po ON po.id = w.production_order_id
      LEFT JOIN payroll_runs r ON r.id = w.run_id
      LEFT JOIN users cu ON cu.id = w.created_by_id
      LEFT JOIN users du ON du.id = w.decided_by_id
      WHERE w.tenant_id = ${u.tenantId}
        ${range ? sql`AND w.work_date BETWEEN ${range.from} AND ${range.to}` : sql``}
        ${q.status ? sql`AND w.status = ${q.status}` : sql``}
        ${q.employeeId ? sql`AND w.employee_id = ${q.employeeId}` : sql``}
      ORDER BY w.work_date DESC, w.created_at DESC LIMIT 500`);
  }

  /** Dipakai oleh ServiceWorkService.productionOrdersForPay */
  queryProductionOrder(db: DbOrTx, tenantId: string) {
    return db.execute<Record<string, unknown>>(sql`
      SELECT po.id, po.number, po.status, po.planned_qty AS "plannedQty", po.output_qty AS "outputQty",
             COALESCE((SELECT SUM(w.quantity) FROM service_work_entries w WHERE w.production_order_id = po.id AND w.status IN ('PENDING','APPROVED')), 0) AS "paidQty"
      FROM production_orders po WHERE po.tenant_id = ${tenantId} AND po.status IN ('IN_PROGRESS','COMPLETED') ORDER BY po.created_at DESC LIMIT 100`);
  }

  /** Dipakai oleh ServiceWorkService.commissionableInvoices */
  queryInvoice(db: DbOrTx, tenantId: string, since: string) {
    return db.execute<Record<string, unknown>>(sql`
      SELECT i.id, i.number, i.date::text AS date, i.subtotal, c.name AS "customerName", i.project_id AS "projectId",
             COALESCE((SELECT SUM(w.rate) FROM service_work_entries w WHERE w.invoice_id = i.id AND w.status IN ('PENDING','APPROVED')), 0) AS "allocatedPct"
      FROM invoices i JOIN customers c ON c.id = i.customer_id
      WHERE i.tenant_id = ${tenantId} AND i.date >= ${since} AND ${invoiceUsable}
      ORDER BY i.date DESC LIMIT 200`);
  }

  /** Dipakai oleh ServiceWorkService.create */
  queryEmployeeForCreate(db: DbOrTx, employeeId: string, tenantId: string) {
    return db.execute<{ id: string }>(
      sql`SELECT id FROM employees WHERE id = ${employeeId} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
  }

  /** Dipakai oleh ServiceWorkService.create */
  findEmployeesById(db: DbOrTx, employeeId: string) {
    return db.select().from(employees).where(eq(employees.id, employeeId));
  }

  /** Dipakai oleh ServiceWorkService.create */
  findProjectsById(db: DbOrTx, projectId: string, tenantId: string) {
    return db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)));
  }

  /** Dipakai oleh ServiceWorkService.create */
  queryInvoiceForCreate(db: DbOrTx, invoiceId: string, tenantId: string) {
    return db.execute<{ id: string; subtotal: string; project_id: string | null }>(sql`
          SELECT i.id, i.subtotal, i.project_id FROM invoices i WHERE i.id = ${invoiceId} AND i.tenant_id = ${tenantId} AND ${invoiceUsable} FOR UPDATE OF i`);
  }

  /** Dipakai oleh ServiceWorkService.create */
  queryServiceWorkEntryForCreate(db: DbOrTx, invoiceId: string) {
    return db.execute<{ pct: string }>(
      sql`SELECT COALESCE(SUM(rate), 0) AS pct FROM service_work_entries WHERE invoice_id = ${invoiceId} AND status IN ('PENDING','APPROVED')`,
    );
  }

  /** Dipakai oleh ServiceWorkService.create */
  queryServiceWorkEntryForCreate2(db: DbOrTx, id: string, workDate: string) {
    return db.execute<{ h: string }>(
      sql`SELECT COALESCE(SUM(quantity), 0) AS h FROM service_work_entries WHERE employee_id = ${id} AND work_date = ${workDate} AND unit = 'HOUR' AND status IN ('PENDING','APPROVED')`,
    );
  }

  /** Dipakai oleh ServiceWorkService.create */
  queryServiceWorkEntryForCreate3(db: DbOrTx, id: string, workDate: string) {
    return db.execute<{ n: string }>(
      sql`SELECT COALESCE(SUM(quantity), 0) AS n FROM service_work_entries WHERE employee_id = ${id} AND work_date = ${workDate} AND unit = 'SHIFT' AND status IN ('PENDING','APPROVED')`,
    );
  }

  /** Dipakai oleh ServiceWorkService.create */
  queryServiceWorkEntryForCreate4(db: DbOrTx, id: string, rateId: string) {
    return db.execute<{ q: string }>(
      sql`SELECT COALESCE(SUM(quantity), 0) AS q FROM service_work_entries WHERE production_order_id = ${id} AND rate_id = ${rateId} AND status IN ('PENDING','APPROVED')`,
    );
  }

  /** Dipakai oleh ServiceWorkService.create */
  findAttendancesByEmployeeIdAndDate(db: DbOrTx, id: string, workDate: string) {
    return db
      .select({ status: attendances.status })
      .from(attendances)
      .where(and(eq(attendances.employeeId, id), eq(attendances.date, workDate)));
  }

  /** Dipakai oleh ServiceWorkService.create */
  queryServiceWorkEntryForCreate5(
    db: DbOrTx,
    id: string,
    workDate: string,
    rateId: string,
    quantity: Dec,
    projectId: string | null,
    invoiceId: string | null,
    productionOrderId: string | null,
  ) {
    return db.execute<{ id: string }>(sql`
        SELECT id FROM service_work_entries WHERE employee_id = ${id} AND work_date = ${workDate} AND rate_id = ${rateId} AND quantity = ${quantity.toFixed(2)}
          AND project_id IS NOT DISTINCT FROM ${projectId}::uuid AND invoice_id IS NOT DISTINCT FROM ${invoiceId}::uuid
          AND production_order_id IS NOT DISTINCT FROM ${productionOrderId}::uuid AND status IN ('PENDING','APPROVED') LIMIT 1`);
  }

  /** Dipakai oleh ServiceWorkService.assertCanDecide */
  findEmployeesByIdForAssertCanDecide(db: DbOrTx, employeeId: string) {
    return db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, employeeId));
  }

  /** Dipakai oleh ServiceWorkService.approve */
  queryInvoiceForApprove(db: DbOrTx, invoiceId: string | null) {
    return db.execute(sql`SELECT 1 FROM invoices i WHERE i.id = ${invoiceId} AND ${invoiceUsable}`);
  }

  /** Dipakai oleh ServiceWorkService.approve */
  updateServiceWorkEntriesById(db: DbOrTx, sub: string, dto: DecideEntryDto, id: string) {
    return db
      .update(serviceWorkEntries)
      .set({ status: 'APPROVED', decidedById: sub, decidedAt: new Date(), decisionNote: dto.note ?? null })
      .where(eq(serviceWorkEntries.id, id))
      .returning();
  }

  /** Dipakai oleh ServiceWorkService.reject */
  updateServiceWorkEntriesByIdForReject(db: DbOrTx, sub: string, reason: string, id: string) {
    return db
      .update(serviceWorkEntries)
      .set({ status: 'REJECTED', decidedById: sub, decidedAt: new Date(), decisionNote: reason })
      .where(eq(serviceWorkEntries.id, id))
      .returning();
  }

  /** Dipakai oleh ServiceWorkService.voidIt */
  queryPayrollRun(db: DbOrTx, runId: string) {
    return db
      .execute<{ status: string; number: string }>(sql`SELECT status, number FROM payroll_runs WHERE id = ${runId}`)
      .then((r) => r.rows);
  }

  /** Dipakai oleh ServiceWorkService.voidIt */
  updateServiceWorkEntriesByIdForVoidIt(db: DbOrTx, reason: string, sub: string, id: string) {
    return db
      .update(serviceWorkEntries)
      .set({ status: 'VOID', decisionNote: reason, decidedById: sub, decidedAt: new Date(), runId: null })
      .where(eq(serviceWorkEntries.id, id))
      .returning();
  }

  /** Dipakai oleh ServiceWorkService.anomalies */
  queryServiceWorkEntryForAnomalies(db: DbOrTx, tenantId: string, to: string) {
    return db.execute<{ employee_id: string; name: string; number: string | null }>(sql`
      SELECT w.employee_id, e.name, i.number FROM service_work_entries w JOIN employees e ON e.id = w.employee_id LEFT JOIN invoices i ON i.id = w.invoice_id
      WHERE w.tenant_id = ${tenantId} AND w.unit = 'PERCENT' AND w.status = 'APPROVED' AND w.run_id IS NULL AND w.work_date <= ${to}`);
  }

  /** Dipakai oleh ServiceWorkService.anomalies */
  queryServiceWorkEntryForAnomalies2(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ employee_id: string; name: string; d: string; st: string }>(sql`
      SELECT w.employee_id, e.name, w.work_date::text AS d, a.status::text AS st
      FROM service_work_entries w JOIN employees e ON e.id = w.employee_id JOIN attendances a ON a.employee_id = w.employee_id AND a.date = w.work_date
      WHERE w.tenant_id = ${tenantId} AND w.unit <> 'PERCENT' AND w.status IN ('PENDING','APPROVED') AND a.status <> 'HADIR' AND w.work_date BETWEEN ${from} AND ${to}`);
  }

  /** Dipakai oleh ServiceWorkService.anomalies */
  queryServiceWorkEntryForAnomalies3(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ employee_id: string; name: string; svc: string; base: string }>(sql`
      SELECT w.employee_id, e.name, SUM(w.amount) AS svc, (e.base_salary + e.fixed_allowance) AS base
      FROM service_work_entries w JOIN employees e ON e.id = w.employee_id
      WHERE w.tenant_id = ${tenantId} AND w.status IN ('PENDING','APPROVED') AND w.work_date BETWEEN ${from} AND ${to}
      GROUP BY w.employee_id, e.name, e.base_salary, e.fixed_allowance
      HAVING (e.base_salary + e.fixed_allowance) > 0 AND SUM(w.amount) > 3 * (e.base_salary + e.fixed_allowance)`);
  }

  /** Dipakai oleh ServiceWorkService.anomalies */
  queryServiceWorkEntryForAnomalies4(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ employee_id: string; name: string; n: string }>(sql`
      SELECT w.employee_id, e.name, SUM(w.quantity) AS n FROM service_work_entries w JOIN employees e ON e.id = w.employee_id
      WHERE w.tenant_id = ${tenantId} AND w.unit = 'SHIFT' AND w.status IN ('PENDING','APPROVED') AND w.work_date BETWEEN ${from} AND ${to}
      GROUP BY w.employee_id, e.name HAVING SUM(w.quantity) > 31`);
  }

  /** Dipakai oleh ServiceWorkService.anomalies */
  queryServiceWorkEntryForAnomalies5(db: DbOrTx, tenantId: string) {
    return db.execute<{ number: string; paid: string; cap: string }>(sql`
      SELECT po.number, SUM(w.quantity) AS paid, (CASE WHEN po.status = 'COMPLETED' THEN po.output_qty ELSE po.planned_qty END) AS cap
      FROM service_work_entries w JOIN production_orders po ON po.id = w.production_order_id
      WHERE w.tenant_id = ${tenantId} AND w.unit = 'PIECE' AND w.status IN ('PENDING','APPROVED')
      GROUP BY po.id, po.number, po.status, po.output_qty, po.planned_qty
      HAVING SUM(w.quantity) > (CASE WHEN po.status = 'COMPLETED' THEN po.output_qty ELSE po.planned_qty END)`);
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh ServiceWorkService.anomalies */
  queryServiceWorkEntryForAnomalies6(db: DbOrTx, tenantId: string, from: string, to: string) {
    return db.execute<{ employee_id: string; name: string; h: string }>(sql`
      SELECT w.employee_id, e.name, SUM(w.quantity) AS h FROM service_work_entries w JOIN employees e ON e.id = w.employee_id
      WHERE w.tenant_id = ${tenantId} AND w.unit = 'HOUR' AND w.status IN ('PENDING','APPROVED') AND w.work_date BETWEEN ${from} AND ${to}
      GROUP BY w.employee_id, e.name HAVING SUM(w.quantity) > ${MAX_HOURS_PER_MONTH}`);
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh ServiceWorkService.listRates */
  listServiceRatesByUnitAndName(db: DbOrTx, tenantId: NonNullable<(typeof serviceRates.$inferSelect)['tenantId']>) {
    return db
      .select()
      .from(serviceRates)
      .where(eq(serviceRates.tenantId, tenantId))
      .orderBy(serviceRates.unit, serviceRates.name);
  }
}
