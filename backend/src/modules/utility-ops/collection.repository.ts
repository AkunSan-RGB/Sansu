import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { firstOf, rowsOf } from './ops.repository';

export interface WorkRow {
  connection_id: string; number: string; address: string; zone: string | null; status: string; customer: string; phone: string | null; route_id: string | null; route_name: string | null; collector_id: string | null;
  outstanding: string; bills: number; oldest_due: string; days_late: number;
  last_outcome: string | null; last_visit_at: string | null; promised_on: string | null; promised_amount: string | null;
}

/** Bagian FROM/WHERE/GROUP BY daftar tagih, dipakai bersama oleh daftar dan penghitungnya agar jumlah selalu cocok */
function worklistBase(tenantId: string, today: string, f: { collectorId?: string; routeId?: string; q?: string }) {
  const like = f.q ? `%${f.q}%` : null;
  return sql`
      FROM invoices i JOIN utility_bills b ON b.invoice_id = i.id JOIN utility_connections c ON c.id = b.connection_id JOIN customers cu ON cu.id = c.customer_id
      LEFT JOIN utility_routes r ON r.id = c.route_id
      LEFT JOIN LATERAL (SELECT outcome, visited_at, promised_on, promised_amount FROM utility_collection_visits v WHERE v.connection_id = c.id ORDER BY v.visited_at DESC LIMIT 1) lv ON true
      WHERE i.tenant_id = ${tenantId} AND i.total - i.paid_amount - i.returned_amount > 0.5 AND i.due_date < ${today}::date
        AND (${f.collectorId ?? null}::uuid IS NULL OR r.collector_id = ${f.collectorId ?? null}::uuid) AND (${f.routeId ?? null}::uuid IS NULL OR c.route_id = ${f.routeId ?? null}::uuid)
        AND (${like}::text IS NULL OR c.number ILIKE ${like} OR cu.name ILIKE ${like} OR c.address ILIKE ${like})
      GROUP BY c.id, cu.name, cu.phone, r.id, lv.outcome, lv.visited_at, lv.promised_on, lv.promised_amount`;
}

@Injectable()
export class CollectionRepository {
  /** Sambungan dengan tagihan air lewat jatuh tempo, lengkap dengan kunjungan terakhir; satu baris per sambungan */
  worklist(db: DbOrTx, tenantId: string, today: string, f: { collectorId?: string; routeId?: string; q?: string }, page?: { limit: number; offset: number }) {
    return rowsOf<WorkRow>(db, sql`
      SELECT c.id AS connection_id, c.number, c.address, c.zone, c.status::text AS status, cu.name AS customer, cu.phone, r.id AS route_id, r.name AS route_name, r.collector_id,
        SUM(i.total - i.paid_amount - i.returned_amount)::text AS outstanding, COUNT(*)::int AS bills, MIN(i.due_date)::text AS oldest_due, (${today}::date - MIN(i.due_date))::int AS days_late,
        lv.outcome AS last_outcome, lv.visited_at::text AS last_visit_at, lv.promised_on::text AS promised_on, lv.promised_amount::text AS promised_amount
      ${worklistBase(tenantId, today, f)}
      ORDER BY r.name NULLS LAST, c.route_seq NULLS LAST, MIN(i.due_date), c.id LIMIT ${page?.limit ?? 500} OFFSET ${page?.offset ?? 0}`);
  }
  /** Jumlah sambungan di daftar tagih dengan penyaring yang sama (untuk paginasi) */
  async worklistCount(db: DbOrTx, tenantId: string, today: string, f: { collectorId?: string; routeId?: string; q?: string }) {
    const r = await firstOf<{ n: number }>(db, sql`SELECT COUNT(*)::int AS n FROM (SELECT c.id ${worklistBase(tenantId, today, f)}) x`);
    return r?.n ?? 0;
  }
  /** Sambungan beserta penagih rutenya, untuk membatasi petugas lapangan pada rutenya sendiri */
  connectionWithCollector(db: DbOrTx, tenantId: string, id: string) {
    return firstOf<{ id: string; number: string; collector_id: string | null; outstanding: string }>(db, sql`
      SELECT c.id, c.number, r.collector_id,
        COALESCE((SELECT SUM(i.total - i.paid_amount - i.returned_amount) FROM invoices i JOIN utility_bills b ON b.invoice_id = i.id WHERE b.connection_id = c.id), 0)::text AS outstanding
      FROM utility_connections c LEFT JOIN utility_routes r ON r.id = c.route_id WHERE c.tenant_id = ${tenantId} AND c.id = ${id}`);
  }
  async insert(db: DbOrTx, v: { tenantId: string; connectionId: string; collectorId: string; outcome: string; promisedOn: string | null; promisedAmount: number | null; note: string | null; lat: number | null; lng: number | null }) {
    const r = await firstOf<{ id: string }>(db, sql`INSERT INTO utility_collection_visits (tenant_id, connection_id, collector_id, outcome, promised_on, promised_amount, note, lat, lng)
      VALUES (${v.tenantId}, ${v.connectionId}, ${v.collectorId}, ${v.outcome}, ${v.promisedOn}, ${v.promisedAmount}, ${v.note}, ${v.lat}, ${v.lng}) RETURNING id`);
    return r!.id;
  }
  visits(db: DbOrTx, tenantId: string, f: { connectionId?: string; collectorId?: string }) {
    return rowsOf(db, sql`
      SELECT v.id, v.visited_at, v.outcome, v.promised_on, v.promised_amount, v.note, c.number AS connection, cu.name AS customer, u.name AS collector
      FROM utility_collection_visits v JOIN utility_connections c ON c.id = v.connection_id JOIN customers cu ON cu.id = c.customer_id LEFT JOIN users u ON u.id = v.collector_id
      WHERE v.tenant_id = ${tenantId} AND (${f.connectionId ?? null}::uuid IS NULL OR v.connection_id = ${f.connectionId ?? null}::uuid) AND (${f.collectorId ?? null}::uuid IS NULL OR v.collector_id = ${f.collectorId ?? null}::uuid)
      ORDER BY v.visited_at DESC LIMIT 200`);
  }
  /** Kunjungan hari ini dan janji bayar yang sudah lewat tetapi tagihannya masih terbuka */
  summary(db: DbOrTx, tenantId: string, today: string, collectorId?: string) {
    return firstOf<{ visits_today: number; promises_today: number; broken: number; overdue_connections: number; overdue_amount: string }>(db, sql`
      WITH wl AS (
        SELECT c.id, r.collector_id, SUM(i.total - i.paid_amount - i.returned_amount) AS open FROM invoices i JOIN utility_bills b ON b.invoice_id = i.id JOIN utility_connections c ON c.id = b.connection_id LEFT JOIN utility_routes r ON r.id = c.route_id
        WHERE i.tenant_id = ${tenantId} AND i.total - i.paid_amount - i.returned_amount > 0.5 AND i.due_date < ${today}::date AND (${collectorId ?? null}::uuid IS NULL OR r.collector_id = ${collectorId ?? null}::uuid) GROUP BY c.id, r.collector_id),
      lv AS (SELECT DISTINCT ON (connection_id) connection_id, outcome, promised_on FROM utility_collection_visits WHERE tenant_id = ${tenantId} ORDER BY connection_id, visited_at DESC)
      SELECT (SELECT COUNT(*) FROM utility_collection_visits v WHERE v.tenant_id = ${tenantId} AND (v.visited_at AT TIME ZONE 'Asia/Jakarta')::date = ${today}::date AND (${collectorId ?? null}::uuid IS NULL OR v.collector_id = ${collectorId ?? null}::uuid))::int AS visits_today,
        (SELECT COUNT(*) FROM wl JOIN lv ON lv.connection_id = wl.id WHERE lv.outcome = 'JANJI_BAYAR' AND lv.promised_on = ${today}::date)::int AS promises_today,
        (SELECT COUNT(*) FROM wl JOIN lv ON lv.connection_id = wl.id WHERE lv.outcome = 'JANJI_BAYAR' AND lv.promised_on < ${today}::date)::int AS broken,
        (SELECT COUNT(*) FROM wl)::int AS overdue_connections, COALESCE((SELECT SUM(open) FROM wl), 0)::text AS overdue_amount`);
  }
}
