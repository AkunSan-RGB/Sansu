import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { firstOf, rowsOf } from './ops.shared';

export interface ApplicationRow {
  id: string; number: string; applicant_name: string; phone: string | null; id_number: string | null; address: string; geo_lat: string | null; geo_lng: string | null; tariff_id: string | null; tariff_name: string | null;
  customer_id: string | null; requested_on: string; status: string; survey_note: string | null; survey_by_id: string | null; surveyed_at: string | null; pipe_length: string | null; feasible: boolean | null;
  cost_invoice_id: string | null; invoice_number: string | null; invoice_total: string | null; invoice_open: string | null; paid: boolean; install_note: string | null; installer_id: string | null; installer_name: string | null;
  meter_serial: string | null; connection_id: string | null; connection_number: string | null; activated_at: string | null; closed_reason: string | null; created_by_id: string | null; created_at: string;
}

@Injectable()
export class ApplicationsRepository {
  private base() {
    return sql`SELECT a.id, a.number, a.applicant_name, a.phone, a.id_number, a.address, a.geo_lat::text, a.geo_lng::text, a.tariff_id, t.name AS tariff_name, a.customer_id, a.requested_on::text, a.status, a.survey_note,
        a.survey_by_id, a.surveyed_at::text, a.pipe_length::text, a.feasible, a.cost_invoice_id, i.number AS invoice_number, i.total::text AS invoice_total,
        (i.total - i.paid_amount - i.returned_amount)::text AS invoice_open, COALESCE(i.total - i.paid_amount - i.returned_amount <= 0.5, false) AS paid,
        a.install_note, a.installer_id, u.name AS installer_name, a.meter_serial, a.connection_id, uc.number AS connection_number, a.activated_at::text, a.closed_reason, a.created_by_id, a.created_at::text
      FROM utility_applications a LEFT JOIN utility_tariffs t ON t.id = a.tariff_id LEFT JOIN invoices i ON i.id = a.cost_invoice_id LEFT JOIN users u ON u.id = a.installer_id LEFT JOIN utility_connections uc ON uc.id = a.connection_id`;
  }
  list(db: DbOrTx, tenantId: string, status?: string, q?: string) {
    const like = q ? `%${q.trim()}%` : null;
    return rowsOf<ApplicationRow>(db, sql`${this.base()} WHERE a.tenant_id = ${tenantId} AND (${status ?? null}::text IS NULL OR a.status = ${status ?? null})
      AND (${like}::text IS NULL OR a.number ILIKE ${like} OR a.applicant_name ILIKE ${like} OR a.address ILIKE ${like})
      ORDER BY (a.status IN ('AKTIF', 'DITOLAK', 'BATAL')), a.created_at DESC LIMIT 300`);
  }
  byId(db: DbOrTx, tenantId: string, id: string) { return firstOf<ApplicationRow>(db, sql`${this.base()} WHERE a.tenant_id = ${tenantId} AND a.id = ${id}`); }
  async insert(db: DbOrTx, v: { tenantId: string; number: string; applicantName: string; phone: string | null; idNumber: string | null; address: string; geoLat: number | null; geoLng: number | null; tariffId: string | null; customerId: string | null; createdById: string }) {
    const r = await firstOf<{ id: string }>(db, sql`INSERT INTO utility_applications (tenant_id, number, applicant_name, phone, id_number, address, geo_lat, geo_lng, tariff_id, customer_id, requested_on, created_by_id)
      VALUES (${v.tenantId}, ${v.number}, ${v.applicantName}, ${v.phone}, ${v.idNumber}, ${v.address}, ${v.geoLat}, ${v.geoLng}, ${v.tariffId}, ${v.customerId}, (now() AT TIME ZONE 'Asia/Jakarta')::date, ${v.createdById}) RETURNING id`);
    return r!.id;
  }
  async setSurvey(db: DbOrTx, tenantId: string, id: string, v: { status: string; feasible: boolean; pipeLength: string | null; note: string; userId: string; tariffId: string | null; closedReason: string | null }) {
    await db.execute(sql`UPDATE utility_applications SET status = ${v.status}, feasible = ${v.feasible}, pipe_length = ${v.pipeLength}::numeric, survey_note = ${v.note}, survey_by_id = ${v.userId}, surveyed_at = now(),
      tariff_id = COALESCE(${v.tariffId}::uuid, tariff_id), closed_reason = ${v.closedReason} WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
  async setCustomerAndInvoice(db: DbOrTx, tenantId: string, id: string, customerId: string, invoiceId: string) {
    await db.execute(sql`UPDATE utility_applications SET customer_id = ${customerId}, cost_invoice_id = ${invoiceId}, status = 'MENUNGGU_BAYAR' WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
  async setInstall(db: DbOrTx, tenantId: string, id: string, v: { installerId: string; meterSerial: string; note: string | null }) {
    await db.execute(sql`UPDATE utility_applications SET status = 'PEMASANGAN', installer_id = ${v.installerId}, meter_serial = ${v.meterSerial}, install_note = ${v.note} WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
  async setActive(db: DbOrTx, tenantId: string, id: string, connectionId: string) {
    await db.execute(sql`UPDATE utility_applications SET status = 'AKTIF', connection_id = ${connectionId}, activated_at = now() WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
  async setClosed(db: DbOrTx, tenantId: string, id: string, status: string, reason: string) {
    await db.execute(sql`UPDATE utility_applications SET status = ${status}, closed_reason = ${reason} WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
  tariff(db: DbOrTx, tenantId: string, id: string) {
    return firstOf<{ id: string; name: string; metered: boolean; service_type: string }>(db, sql`SELECT id, name, metered, service_type::text AS service_type FROM utility_tariffs WHERE tenant_id = ${tenantId} AND id = ${id} AND is_active`);
  }
  /** Daftarkan meter yang dipasang (atau catat meter baru) dan kaitkan ke sambungan */
  async attachMeter(db: DbOrTx, tenantId: string, serial: string, connectionId: string, initialReading: string, userId: string) {
    const m = await firstOf<{ id: string }>(db, sql`INSERT INTO utility_meters (tenant_id, serial, status, connection_id, installed_on, initial_reading, next_calibration_on)
      VALUES (${tenantId}, ${serial}, 'TERPASANG', ${connectionId}, (now() AT TIME ZONE 'Asia/Jakarta')::date, ${initialReading}::numeric, ((now() AT TIME ZONE 'Asia/Jakarta')::date + interval '5 years')::date)
      ON CONFLICT (tenant_id, serial) DO UPDATE SET status = 'TERPASANG', connection_id = ${connectionId}, installed_on = (now() AT TIME ZONE 'Asia/Jakarta')::date RETURNING id`);
    await db.execute(sql`INSERT INTO utility_meter_events (tenant_id, meter_id, kind, connection_id, user_id, note) VALUES (${tenantId}, ${m!.id}, 'PASANG', ${connectionId}, ${userId}, 'Pemasangan sambungan baru')`);
  }
  summary(db: DbOrTx, tenantId: string) {
    return rowsOf<{ status: string; n: number }>(db, sql`SELECT status, COUNT(*)::int AS n FROM utility_applications WHERE tenant_id = ${tenantId} GROUP BY status`);
  }
}
