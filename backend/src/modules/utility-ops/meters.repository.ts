import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { firstOf, rowsOf } from './ops.shared';

export interface MeterRow { id: string; serial: string; brand: string | null; size: string | null; status: string; connection_id: string | null; connection_number: string | null; customer_name: string | null; address: string | null; installed_on: string | null; last_calibrated_on: string | null; next_calibration_on: string | null; initial_reading: string; note: string | null; days_to_calibration: number | null }

@Injectable()
export class MetersRepository {
  private base() {
    return sql`SELECT m.id, m.serial, m.brand, m.size, m.status, m.connection_id, uc.number AS connection_number, cu.name AS customer_name, uc.address, m.installed_on::text, m.last_calibrated_on::text, m.next_calibration_on::text,
        m.initial_reading::text, m.note, (m.next_calibration_on - (now() AT TIME ZONE 'Asia/Jakarta')::date)::int AS days_to_calibration
      FROM utility_meters m LEFT JOIN utility_connections uc ON uc.id = m.connection_id LEFT JOIN customers cu ON cu.id = uc.customer_id`;
  }
  list(db: DbOrTx, tenantId: string, f: { status?: string; q?: string; due?: boolean }) {
    const like = f.q ? `%${f.q.trim()}%` : null;
    return rowsOf<MeterRow>(db, sql`${this.base()} WHERE m.tenant_id = ${tenantId} AND (${f.status ?? null}::text IS NULL OR m.status = ${f.status ?? null})
      AND (${like}::text IS NULL OR m.serial ILIKE ${like} OR uc.number ILIKE ${like} OR cu.name ILIKE ${like} OR m.brand ILIKE ${like})
      AND (${f.due ?? false}::boolean = false OR (m.status = 'TERPASANG' AND m.next_calibration_on <= (now() AT TIME ZONE 'Asia/Jakarta')::date + 90))
      ORDER BY m.next_calibration_on NULLS LAST, m.serial LIMIT 500`);
  }
  byId(db: DbOrTx, tenantId: string, id: string, lock = false) { return firstOf<MeterRow>(db, sql`${this.base()} WHERE m.tenant_id = ${tenantId} AND m.id = ${id} ${lock ? sql`FOR UPDATE OF m` : sql``}`); }
  events(db: DbOrTx, tenantId: string, meterId: string) {
    return rowsOf<{ id: string; at: string; kind: string; connection_number: string | null; user_name: string | null; note: string | null }>(db, sql`SELECT e.id, e.at::text, e.kind, uc.number AS connection_number, u.name AS user_name, e.note FROM utility_meter_events e
      LEFT JOIN utility_connections uc ON uc.id = e.connection_id LEFT JOIN users u ON u.id = e.user_id WHERE e.tenant_id = ${tenantId} AND e.meter_id = ${meterId} ORDER BY e.at, e.id`);
  }
  async insert(db: DbOrTx, v: { tenantId: string; serial: string; brand: string | null; size: string | null; lastCalibratedOn: string | null; nextCalibrationOn: string | null; initialReading: string; note: string | null }) {
    const r = await firstOf<{ id: string }>(db, sql`INSERT INTO utility_meters (tenant_id, serial, brand, size, last_calibrated_on, next_calibration_on, initial_reading, note) VALUES (${v.tenantId}, ${v.serial}, ${v.brand}, ${v.size}, ${v.lastCalibratedOn}::date, ${v.nextCalibrationOn}::date, ${v.initialReading}::numeric, ${v.note}) RETURNING id`);
    return r!.id;
  }
  async event(db: DbOrTx, tenantId: string, meterId: string, kind: string, userId: string, o: { connectionId?: string | null; note?: string | null } = {}) {
    await db.execute(sql`INSERT INTO utility_meter_events (tenant_id, meter_id, kind, connection_id, user_id, note) VALUES (${tenantId}, ${meterId}, ${kind}, ${o.connectionId ?? null}, ${userId}, ${o.note ?? null})`);
  }
  async setCalibration(db: DbOrTx, tenantId: string, id: string, last: string, next: string) {
    await db.execute(sql`UPDATE utility_meters SET last_calibrated_on = ${last}::date, next_calibration_on = ${next}::date WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
  async setStatus(db: DbOrTx, tenantId: string, id: string, status: string, detach: boolean) {
    await db.execute(sql`UPDATE utility_meters SET status = ${status}, connection_id = CASE WHEN ${detach} THEN NULL ELSE connection_id END WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
  async attach(db: DbOrTx, tenantId: string, id: string, connectionId: string) {
    await db.execute(sql`UPDATE utility_meters SET status = 'TERPASANG', connection_id = ${connectionId}, installed_on = (now() AT TIME ZONE 'Asia/Jakarta')::date WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
  connection(db: DbOrTx, tenantId: string, id: string) {
    return firstOf<{ id: string; number: string; meter_no: string | null; status: string; metered: boolean }>(db, sql`SELECT c.id, c.number, c.meter_no, c.status::text AS status, t.metered FROM utility_connections c JOIN utility_tariffs t ON t.id = c.tariff_id WHERE c.tenant_id = ${tenantId} AND c.id = ${id} FOR UPDATE OF c`);
  }
  currentMeterOf(db: DbOrTx, tenantId: string, connectionId: string) {
    return firstOf<{ id: string; serial: string }>(db, sql`SELECT id, serial FROM utility_meters WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId} AND status = 'TERPASANG'`);
  }
  async setConnectionMeter(db: DbOrTx, tenantId: string, connectionId: string, serial: string) {
    await db.execute(sql`UPDATE utility_connections SET meter_no = ${serial} WHERE tenant_id = ${tenantId} AND id = ${connectionId}`);
  }
  async meterNoTaken(db: DbOrTx, tenantId: string, connectionId: string, serial: string) {
    const r = await firstOf<{ n: number }>(db, sql`SELECT COUNT(*)::int AS n FROM utility_connections WHERE tenant_id = ${tenantId} AND id <> ${connectionId} AND meter_no = ${serial} AND status <> 'DISCONNECTED'`);
    return (r?.n ?? 0) > 0;
  }
  /** Daftarkan meter dari nomor meter yang sudah tertulis pada sambungan (data lama) */
  async syncFromConnections(db: DbOrTx, tenantId: string, userId: string) {
    const rows = await rowsOf<{ id: string }>(db, sql`INSERT INTO utility_meters (tenant_id, serial, status, connection_id, installed_on, initial_reading, next_calibration_on)
      SELECT c.tenant_id, c.meter_no, 'TERPASANG', c.id, c.installed_at, c.initial_reading, (c.installed_at + interval '5 years')::date FROM utility_connections c
      WHERE c.tenant_id = ${tenantId} AND c.meter_no IS NOT NULL AND c.meter_no <> '' AND c.status <> 'DISCONNECTED' AND NOT EXISTS (SELECT 1 FROM utility_meters m WHERE m.tenant_id = c.tenant_id AND m.serial = c.meter_no)
      ON CONFLICT (tenant_id, serial) DO NOTHING RETURNING id`);
    for (const r of rows) await this.event(db, tenantId, r.id, 'REGISTRASI', userId, { note: 'Diimpor dari data sambungan' });
    return rows.length;
  }
  summary(db: DbOrTx, tenantId: string) {
    return rowsOf<{ status: string; n: number }>(db, sql`SELECT status, COUNT(*)::int AS n FROM utility_meters WHERE tenant_id = ${tenantId} GROUP BY status`).then(async (by) => {
      const due = await firstOf<{ due: number; overdue: number }>(db, sql`SELECT COUNT(*) FILTER (WHERE status = 'TERPASANG' AND next_calibration_on <= (now() AT TIME ZONE 'Asia/Jakarta')::date + 90)::int AS due,
        COUNT(*) FILTER (WHERE status = 'TERPASANG' AND next_calibration_on < (now() AT TIME ZONE 'Asia/Jakarta')::date)::int AS overdue FROM utility_meters WHERE tenant_id = ${tenantId}`);
      return { by: Object.fromEntries(by.map((x) => [x.status, x.n])), due: due?.due ?? 0, overdue: due?.overdue ?? 0 };
    });
  }
}
