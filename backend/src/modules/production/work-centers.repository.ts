import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { sql } from 'drizzle-orm';
import { WorkCenterDto } from './work-centers.dto';
import { AuthUser } from '../../common/auth/auth-user';
import { RangeQuery } from './work-centers.shared';

/** Akses data untuk WorkCenters: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class WorkCentersRepository {
  /** Dipakai oleh WorkCenterService.save */
  querySave(db: DbOrTx, dto: WorkCenterDto, id: string, u: AuthUser) {
    return db.execute(
      sql`UPDATE work_centers SET code = ${dto.code.trim()}, name = ${dto.name.trim()}, kind = ${dto.kind ?? 'MACHINE'}, labor_rate = ${dto.laborRate}, overhead_rate = ${dto.overheadRate}, capacity_hours = ${dto.capacityHours ?? 8}, is_active = ${dto.isActive ?? true} WHERE id = ${id} AND tenant_id = ${u.tenantId} RETURNING id`,
    );
  }

  /** Dipakai oleh WorkCenterService.save */
  queryWorkCenter(db: DbOrTx, u: AuthUser, dto: WorkCenterDto) {
    return db.execute<{ id: string }>(
      sql`INSERT INTO work_centers (tenant_id, code, name, kind, labor_rate, overhead_rate, capacity_hours) VALUES (${u.tenantId}, ${dto.code.trim()}, ${dto.name.trim()}, ${dto.kind ?? 'MACHINE'}, ${dto.laborRate}, ${dto.overheadRate}, ${dto.capacityHours ?? 8}) RETURNING id`,
    );
  }

  /** Dipakai oleh WorkCenterService.addDowntime */
  queryWorkCenterDowntime(
    db: DbOrTx,
    tenantId: string,
    workCenterId: string,
    s: Date,
    e: Date,
    reason: string,
    sub: string,
  ) {
    return db.execute(
      sql`INSERT INTO work_center_downtime (tenant_id, work_center_id, starts_at, ends_at, reason, created_by_id) VALUES (${tenantId}, ${workCenterId}, ${s.toISOString()}, ${e.toISOString()}, ${reason}, ${sub})`,
    );
  }

  /** Dipakai oleh WorkCenterService.setShifts */
  queryWorkCenterShift(db: DbOrTx, workCenterId: string, tenantId: string) {
    return db.execute(
      sql`DELETE FROM work_center_shifts WHERE work_center_id = ${workCenterId} AND tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh WorkCenterService.setShifts */
  queryWorkCenterShiftForSetShifts(
    db: DbOrTx,
    tenantId: string,
    workCenterId: string,
    weekday: number,
    s: number,
    e: number,
  ) {
    return db.execute(
      sql`INSERT INTO work_center_shifts (tenant_id, work_center_id, weekday, start_minute, end_minute) VALUES (${tenantId}, ${workCenterId}, ${weekday}, ${s}, ${e})`,
    );
  }

  /** Dipakai oleh WorkCenterService.withinShift */
  queryWorkCenterShiftForWithinShift(db: DbOrTx, tenantId: string, workCenterId: string) {
    return db.execute<{ weekday: number; start_minute: number; end_minute: number }>(
      sql`SELECT weekday, start_minute, end_minute FROM work_center_shifts WHERE tenant_id = ${tenantId} AND work_center_id = ${workCenterId}`,
    );
  }

  /** Dipakai oleh WorkCenterService.lockWc */
  queryWorkCenterForLockWc(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<{ id: string; is_active: boolean; labor_rate: string; overhead_rate: string; code: string }>(
      sql`SELECT id, is_active, labor_rate, overhead_rate, code FROM work_centers WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
  }

  /** Dipakai oleh WorkCenterService.setBomOperations */
  queryBom(db: DbOrTx, bomId: string, tenantId: string) {
    return db.execute(sql`SELECT 1 FROM boms WHERE id = ${bomId} AND tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh WorkCenterService.setBomOperations */
  queryWorkCenterForSetBomOperations(db: DbOrTx, tenantId: string, ids: string[]) {
    return db.execute(
      sql`SELECT id FROM work_centers WHERE tenant_id = ${tenantId} AND is_active AND id IN (${sql.join(
        ids.map((i) => sql`${i}::uuid`),
        sql`, `,
      )})`,
    );
  }

  /** Dipakai oleh WorkCenterService.setBomOperations */
  queryBomOperation(db: DbOrTx, bomId: string) {
    return db.execute(sql`DELETE FROM bom_operations WHERE bom_id = ${bomId}`);
  }

  /** Dipakai oleh WorkCenterService.setBomOperations */
  queryBomOperationForSetBomOperations(
    db: DbOrTx,
    tenantId: string,
    bomId: string,
    i: number,
    name: string,
    workCenterId: string,
    minutesPerBatch: number,
  ) {
    return db.execute(
      sql`INSERT INTO bom_operations (tenant_id, bom_id, sequence, name, work_center_id, minutes_per_batch) VALUES (${tenantId}, ${bomId}, ${i + 1}, ${name.trim()}, ${workCenterId}, ${minutesPerBatch})`,
    );
  }

  /** Dipakai oleh WorkCenterService.copyToOrder */
  queryProductionOrderOperation(db: DbOrTx, orderId: string, batches: number, bomId: string, tenantId: string) {
    return db.execute(
      sql`INSERT INTO production_order_operations (tenant_id, order_id, sequence, name, work_center_id, planned_minutes) SELECT tenant_id, ${orderId}::uuid, sequence, name, work_center_id, ROUND(minutes_per_batch * ${batches}::numeric, 2) FROM bom_operations WHERE bom_id = ${bomId} AND tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh WorkCenterService.orderConversionCost */
  queryProductionOrderOperationForOrderConversionCost(db: DbOrTx, tenantId: string, orderId: string) {
    return db.execute<{ status: string; labor_cost: string; overhead_cost: string; name: string }>(
      sql`SELECT status, labor_cost, overhead_cost, name FROM production_order_operations WHERE tenant_id = ${tenantId} AND order_id = ${orderId} AND status <> 'CANCELLED' ORDER BY sequence`,
    );
  }

  /** Dipakai oleh WorkCenterService.cancelOrderOps */
  queryCancelOrderOps(db: DbOrTx, tenantId: string, orderId: string) {
    return db.execute(
      sql`UPDATE production_order_operations SET status = 'CANCELLED' WHERE tenant_id = ${tenantId} AND order_id = ${orderId} AND status IN ('PENDING', 'RUNNING')`,
    );
  }

  /** Dipakai oleh WorkCenterService.clashes */
  queryProductionOrderOperationForClashes(
    db: DbOrTx,
    tenantId: string,
    workCenterId: string,
    exceptOpId: string,
    e: Date,
    s: Date,
  ) {
    return db.execute<{
      id: string;
      name: string;
      order_number: string;
      scheduled_start: Date;
      scheduled_end: Date;
    }>(sql`
      SELECT o.id, o.name, p.number AS order_number, o.scheduled_start, o.scheduled_end FROM production_order_operations o JOIN production_orders p ON p.id = o.order_id
      WHERE o.tenant_id = ${tenantId} AND o.work_center_id = ${workCenterId} AND o.id <> ${exceptOpId} AND o.status IN ('PENDING', 'RUNNING') AND o.scheduled_start IS NOT NULL
        AND o.scheduled_start < ${e.toISOString()}::timestamptz AND o.scheduled_end > ${s.toISOString()}::timestamptz ORDER BY o.scheduled_start`);
  }

  /** Dipakai oleh WorkCenterService.clashes */
  queryWorkCenterDowntimeForClashes(db: DbOrTx, tenantId: string, workCenterId: string, e: Date, s: Date) {
    return db.execute<{ reason: string; starts_at: Date; ends_at: Date }>(
      sql`SELECT reason, starts_at, ends_at FROM work_center_downtime WHERE tenant_id = ${tenantId} AND work_center_id = ${workCenterId} AND starts_at < ${e.toISOString()}::timestamptz AND ends_at > ${s.toISOString()}::timestamptz`,
    );
  }

  /** Dipakai oleh WorkCenterService.schedule */
  queryProductionOrderOperationForSchedule(db: DbOrTx, order_id: string, sequence: number) {
    return db.execute<{ name: string; scheduled_end: Date | null }>(
      sql`SELECT name, scheduled_end FROM production_order_operations WHERE order_id = ${order_id} AND sequence < ${sequence} AND status <> 'CANCELLED' ORDER BY sequence DESC LIMIT 1`,
    );
  }

  /** Dipakai oleh WorkCenterService.schedule */
  queryProductionOrderOperationForSchedule2(db: DbOrTx, order_id: string, sequence: number) {
    return db.execute<{ name: string; scheduled_start: Date | null }>(
      sql`SELECT name, scheduled_start FROM production_order_operations WHERE order_id = ${order_id} AND sequence > ${sequence} AND status <> 'CANCELLED' AND scheduled_start IS NOT NULL ORDER BY sequence LIMIT 1`,
    );
  }

  /** Dipakai oleh WorkCenterService.schedule */
  querySchedule(db: DbOrTx, s: Date, e: Date, offShift: boolean, opId: string) {
    return db.execute(
      sql`UPDATE production_order_operations SET scheduled_start = ${s.toISOString()}, scheduled_end = ${e.toISOString()}, off_shift = ${offShift} WHERE id = ${opId}`,
    );
  }

  /** Dipakai oleh WorkCenterService.unschedule */
  queryUnschedule(db: DbOrTx, opId: string) {
    return db.execute(
      sql`UPDATE production_order_operations SET scheduled_start = NULL, scheduled_end = NULL, off_shift = false WHERE id = ${opId}`,
    );
  }

  /** Dipakai oleh WorkCenterService.startOp */
  queryProductionOrderOperationForStartOp(db: DbOrTx, order_id: string, sequence: number) {
    return db.execute<{ name: string; status: string }>(
      sql`SELECT name, status FROM production_order_operations WHERE order_id = ${order_id} AND sequence < ${sequence} AND status NOT IN ('DONE', 'CANCELLED') LIMIT 1`,
    );
  }

  /** Dipakai oleh WorkCenterService.startOp */
  queryProductionOrderOperationForStartOp2(db: DbOrTx, id: string, opId: string) {
    return db.execute<{ name: string }>(
      sql`SELECT name FROM production_order_operations WHERE work_center_id = ${id} AND status = 'RUNNING' AND id <> ${opId} LIMIT 1`,
    );
  }

  /** Dipakai oleh WorkCenterService.startOp */
  queryStartOp(db: DbOrTx, opId: string) {
    return db.execute(
      sql`UPDATE production_order_operations SET status = 'RUNNING', started_at = now() WHERE id = ${opId}`,
    );
  }

  /** Dipakai oleh WorkCenterService.finishOp */
  queryEmployee(db: DbOrTx, operatorEmployeeId: string, tenantId: string) {
    return db.execute(sql`SELECT 1 FROM employees WHERE id = ${operatorEmployeeId} AND tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh WorkCenterService.finishOp */
  queryWorkCenterForFinishOp(db: DbOrTx, work_center_id: string) {
    return db.execute<{ labor_rate: string; overhead_rate: string }>(
      sql`SELECT labor_rate, overhead_rate FROM work_centers WHERE id = ${work_center_id}`,
    );
  }

  /** Dipakai oleh WorkCenterService.costing */
  queryProductionOrder(db: DbOrTx, orderId: string, tenantId: string) {
    return db.execute<{
      number: string;
      status: string;
      batches: string;
      planned_qty: string;
      output_qty: string;
      material_cost: string;
      labor_cost: string;
      overhead_cost: string;
      total_cost: string;
      unit_cost: string;
    }>(
      sql`SELECT number, status, batches, planned_qty, output_qty, material_cost, labor_cost, overhead_cost, total_cost, unit_cost FROM production_orders WHERE id = ${orderId} AND tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh WorkCenterService.schedulePlan */
  queryProductionOrderOperationForSchedulePlan(db: DbOrTx, tenantId: string, to: string, from: string, q: RangeQuery) {
    return db.execute(sql`
      SELECT o.id, o.name, o.status, o.sequence, o.work_center_id AS "workCenterId", w.code AS "workCenterCode", w.name AS "workCenterName", p.id AS "orderId", p.number AS "orderNumber",
             o.scheduled_start AS "scheduledStart", o.scheduled_end AS "scheduledEnd", o.planned_minutes AS "plannedMinutes"
      FROM production_order_operations o JOIN work_centers w ON w.id = o.work_center_id JOIN production_orders p ON p.id = o.order_id
      WHERE o.tenant_id = ${tenantId} AND o.status <> 'CANCELLED' AND o.scheduled_start IS NOT NULL AND o.scheduled_start < (${to}::date + 1)::timestamptz AND o.scheduled_end > ${from}::date::timestamptz
        ${q.workCenterId ? sql`AND o.work_center_id = ${q.workCenterId}` : sql``} ORDER BY o.scheduled_start LIMIT 1000`);
  }

  /** Dipakai oleh WorkCenterService.schedulePlan */
  queryWorkCenterDowntimeForSchedulePlan(db: DbOrTx, tenantId: string, to: string, from: string) {
    return db.execute(
      sql`SELECT d.id, d.work_center_id AS "workCenterId", d.starts_at AS "startsAt", d.ends_at AS "endsAt", d.reason FROM work_center_downtime d WHERE d.tenant_id = ${tenantId} AND d.starts_at < (${to}::date + 1)::timestamptz AND d.ends_at > ${from}::date::timestamptz ORDER BY d.starts_at`,
    );
  }

  /** Dipakai oleh WorkCenterService.utilization */
  queryWorkCenterForUtilization(db: DbOrTx, from: string, to: string, tenantId: string) {
    return db.execute(sql`
      SELECT w.id, w.code, w.name, w.capacity_hours AS "capacityHours",
             COALESCE(SUM(o.actual_minutes) FILTER (WHERE o.status = 'DONE'), 0) / 60.0 AS "actualHours",
             COALESCE(SUM(o.planned_minutes) FILTER (WHERE o.status = 'DONE'), 0) / 60.0 AS "plannedHours",
             COALESCE(SUM(o.labor_cost + o.overhead_cost) FILTER (WHERE o.status = 'DONE'), 0) AS cost
      FROM work_centers w LEFT JOIN production_order_operations o ON o.work_center_id = w.id AND o.finished_at >= ${from}::date::timestamptz AND o.finished_at < (${to}::date + 1)::timestamptz
      WHERE w.tenant_id = ${tenantId} GROUP BY w.id ORDER BY w.code`);
  }
}
