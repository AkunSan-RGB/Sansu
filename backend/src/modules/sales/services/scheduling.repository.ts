import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../../db/db';
import { sql } from 'drizzle-orm';
import { ResourceDto } from './scheduling.dto';
import { BookingsQuery } from './scheduling.shared';

export const OVERLOAD_HOURS = 10;

export type Res = {
  id: string;
  name: string;
  is_active: boolean;
  employee_id: string | null;
  work_start: number;
  work_end: number;
  work_days: string;
};

export type Booking = {
  id: string;
  resource_id: string;
  title: string;
  starts_at: Date;
  ends_at: Date;
  status: string;
  customer_id: string | null;
  project_id: string | null;
};

/** Akses data untuk Scheduling: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class SchedulingRepository {
  /** Dipakai oleh SchedulingService.saveResource */
  queryEmployee(db: DbOrTx, employeeId: string, tenantId: string) {
    return db.execute(sql`SELECT 1 FROM employees WHERE id = ${employeeId} AND tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh SchedulingService.saveResource */
  querySaveResource(db: DbOrTx, dto: ResourceDto, ws: number, we: number, wd: string, id: string, tenantId: string) {
    return db.execute(
      sql`UPDATE scheduling_resources SET name = ${dto.name.trim()}, kind = ${dto.kind}, employee_id = ${dto.employeeId ?? null}, note = ${dto.note ?? null}, is_active = ${dto.isActive ?? true}, work_start = ${ws}, work_end = ${we}, work_days = ${wd} WHERE id = ${id} AND tenant_id = ${tenantId} RETURNING id`,
    );
  }

  /** Dipakai oleh SchedulingService.saveResource */
  querySchedulingResource(db: DbOrTx, tenantId: string, dto: ResourceDto, ws: number, we: number, wd: string) {
    return db.execute<{ id: string }>(
      sql`INSERT INTO scheduling_resources (tenant_id, name, kind, employee_id, note, work_start, work_end, work_days) VALUES (${tenantId}, ${dto.name.trim()}, ${dto.kind}, ${dto.employeeId ?? null}, ${dto.note ?? null}, ${ws}, ${we}, ${wd}) RETURNING id`,
    );
  }

  /** Dipakai oleh SchedulingService.conflicts */
  queryResourceBooking(
    db: DbOrTx,
    tenantId: string,
    resourceId: string,
    e: Date,
    s: Date,
    exceptId: string | undefined,
  ) {
    return db.execute<{ id: string; title: string; starts_at: Date; ends_at: Date }>(sql`
      SELECT id, title, starts_at, ends_at FROM resource_bookings
      WHERE tenant_id = ${tenantId} AND resource_id = ${resourceId} AND status = 'BOOKED' AND starts_at < ${e.toISOString()}::timestamptz AND ends_at > ${s.toISOString()}::timestamptz ${exceptId ? sql`AND id <> ${exceptId}` : sql``}
      ORDER BY starts_at`);
  }

  /** Dipakai oleh SchedulingService.leaveClash */
  queryLeaveRequest(db: DbOrTx, tenantId: string, employee_id: string, d2: string, d1: string) {
    return db.execute<{ start_date: string; end_date: string; type: string }>(
      sql`SELECT start_date, end_date, type FROM leave_requests WHERE tenant_id = ${tenantId} AND employee_id = ${employee_id} AND status = 'APPROVED' AND start_date <= ${d2}::date AND end_date >= ${d1}::date ORDER BY start_date`,
    );
  }

  /** Dipakai oleh SchedulingService.validateLinks */
  queryProject(db: DbOrTx, projectId: string, tenantId: string) {
    return db.execute<{ customer_id: string; status: string }>(
      sql`SELECT customer_id, status FROM projects WHERE id = ${projectId} AND tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh SchedulingService.validateLinks */
  queryCustomer(db: DbOrTx, cust: string, tenantId: string) {
    return db.execute(sql`SELECT 1 FROM customers WHERE id = ${cust} AND tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh SchedulingService.cancelSeries */
  queryCancelSeries(db: DbOrTx, reason: string, tenantId: string, sid: string, starts_at: Date) {
    return db.execute<{ id: string }>(
      sql`UPDATE resource_bookings SET status = 'CANCELLED', cancel_reason = ${reason} WHERE tenant_id = ${tenantId} AND series_id = ${sid} AND status = 'BOOKED' AND starts_at >= ${new Date(starts_at).toISOString()}::timestamptz RETURNING id`,
    );
  }

  /** Dipakai oleh SchedulingService.cancel */
  queryCancel(db: DbOrTx, reason: string, id: string) {
    return db.execute(
      sql`UPDATE resource_bookings SET status = 'CANCELLED', cancel_reason = ${reason} WHERE id = ${id}`,
    );
  }

  /** Dipakai oleh SchedulingService.done */
  queryDone(db: DbOrTx, id: string) {
    return db.execute(sql`UPDATE resource_bookings SET status = 'DONE' WHERE id = ${id}`);
  }

  /** Dipakai oleh SchedulingService.toTimeEntry */
  queryTimeEntry(db: DbOrTx, id: string) {
    return db.execute(sql`SELECT 1 FROM time_entries WHERE booking_id = ${id}`);
  }

  /** Dipakai oleh SchedulingService.toTimeEntry */
  queryToTimeEntry(db: DbOrTx, id: string, entryId: string) {
    return db.execute(sql`UPDATE time_entries SET booking_id = ${id} WHERE id = ${entryId}`);
  }

  /** Dipakai oleh SchedulingService.toTimeEntry */
  queryToTimeEntryForToTimeEntry(db: DbOrTx, id: string) {
    return db.execute(sql`UPDATE resource_bookings SET status = 'DONE' WHERE id = ${id} AND status = 'BOOKED'`);
  }

  /** Dipakai oleh SchedulingService.list */
  queryResourceBookingForList(
    db: DbOrTx,
    tenantId: string,
    onlyId: string | undefined,
    to: string,
    from: string,
    q: BookingsQuery,
  ) {
    return db.execute(sql`
      SELECT b.id, b.resource_id AS "resourceId", r.name AS "resourceName", r.kind, b.title, b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.status, b.note, b.cancel_reason AS "cancelReason",
             b.customer_id AS "customerId", c.name AS "customerName", b.project_id AS "projectId", p.name AS "projectName", b.series_id AS "seriesId", b.off_hours AS "offHours"
      FROM resource_bookings b JOIN scheduling_resources r ON r.id = b.resource_id LEFT JOIN customers c ON c.id = b.customer_id LEFT JOIN projects p ON p.id = b.project_id
      WHERE b.tenant_id = ${tenantId}
        ${onlyId ? sql`AND b.id = ${onlyId}` : sql`AND b.starts_at < (${to}::date + 1)::timestamptz AND b.ends_at > ${from}::date::timestamptz`}
        ${q.resourceId ? sql`AND b.resource_id = ${q.resourceId}` : sql``}
      ORDER BY b.starts_at LIMIT 1000`);
  }

  /** Dipakai oleh SchedulingService.controls */
  queryResourceBookingForControls(db: DbOrTx, tenantId: string) {
    return db.execute(
      sql`SELECT b.id, b.title, r.name AS resource, b.ends_at AS "endsAt" FROM resource_bookings b JOIN scheduling_resources r ON r.id = b.resource_id WHERE b.tenant_id = ${tenantId} AND b.status = 'BOOKED' AND b.ends_at < now() - interval '1 day' ORDER BY b.ends_at LIMIT 50`,
    );
  }

  /** Dipakai oleh SchedulingService.controls */
  queryResourceBookingForControls2(db: DbOrTx, tenantId: string) {
    return db.execute(
      sql`SELECT b.id, b.title, r.name AS resource, b.starts_at AS "startsAt" FROM resource_bookings b JOIN scheduling_resources r ON r.id = b.resource_id WHERE b.tenant_id = ${tenantId} AND b.status = 'BOOKED' AND b.off_hours AND b.ends_at > now() - interval '7 days' ORDER BY b.starts_at LIMIT 50`,
    );
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh SchedulingService.saveResource */
  querySchedulingResourceForSaveResource(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<Res>(
      sql`SELECT id, name, is_active, employee_id, work_start, work_end, work_days FROM scheduling_resources WHERE id = ${id} AND tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh SchedulingService.lockResource */
  querySchedulingResourceForLockResource(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<Res>(
      sql`SELECT id, name, is_active, employee_id, work_start, work_end, work_days FROM scheduling_resources WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
  }

  /** Dipakai oleh SchedulingService.lockBooking */
  queryResourceBookingForLockBooking(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<Booking>(
      sql`SELECT * FROM resource_bookings WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
  }

  /** Dipakai oleh SchedulingService.toTimeEntry */
  queryResourceBookingForToTimeEntry(db: DbOrTx, id: string, tenantId: string) {
    return db.execute<Booking & { employee_id: string | null; kind: string; project_id: string | null }>(
      sql`SELECT b.*, r.employee_id, r.kind FROM resource_bookings b JOIN scheduling_resources r ON r.id = b.resource_id WHERE b.id = ${id} AND b.tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh SchedulingService.freeSlots */
  querySchedulingResourceForFreeSlots(db: DbOrTx, resourceId: string, tenantId: string) {
    return db.execute<Res>(
      sql`SELECT id, name, is_active, employee_id, work_start, work_end, work_days FROM scheduling_resources WHERE id = ${resourceId} AND tenant_id = ${tenantId} AND is_active`,
    );
  }

  /** Dipakai oleh SchedulingService.freeSlots */
  queryLeaveRequestForFreeSlots(db: DbOrTx, tenantId: string, res: Res[], to: string, from: string) {
    return db.execute<{ start_date: string; end_date: string }>(
      sql`SELECT start_date, end_date FROM leave_requests WHERE tenant_id = ${tenantId} AND employee_id = ${res[0].employee_id} AND status = 'APPROVED' AND start_date <= ${to}::date AND end_date >= ${from}::date`,
    );
  }

  /** Dipakai oleh SchedulingService.controls */
  queryResourceBookingForControls3(db: DbOrTx, tenantId: string) {
    return db.execute(sql`
      SELECT r.name AS resource, to_char((b.starts_at AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY-MM-DD') AS day, ROUND(SUM(EXTRACT(EPOCH FROM (b.ends_at - b.starts_at)) / 3600)::numeric, 1) AS hours
      FROM resource_bookings b JOIN scheduling_resources r ON r.id = b.resource_id
      WHERE b.tenant_id = ${tenantId} AND b.status = 'BOOKED' AND r.kind = 'PERSON' AND b.starts_at > now() - interval '7 days'
      GROUP BY r.name, (b.starts_at AT TIME ZONE 'Asia/Jakarta')::date HAVING SUM(EXTRACT(EPOCH FROM (b.ends_at - b.starts_at)) / 3600) > ${OVERLOAD_HOURS} ORDER BY 2 LIMIT 50`);
  }
}
