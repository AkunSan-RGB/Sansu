import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { firstOf, rowsOf } from './ops.repository';

export interface RouteRow { id: string; code: string; name: string; reader_id: string | null; reader_name: string | null; collector_id: string | null; collector_name: string | null; zone: string | null; is_active: boolean; connections: number; metered: number; read: number; arrears: number }

@Injectable()
export class RoutesRepository {
  /** Rute beserta progres baca meter pada periode (sambungan aktif ber-meter yang sudah punya catatan tak ditolak) */
  list(db: DbOrTx, tenantId: string, period: string) {
    return rowsOf<RouteRow>(db, sql`
      SELECT r.id, r.code, r.name, r.reader_id, ru.name AS reader_name, r.collector_id, cu.name AS collector_name, r.zone, r.is_active,
        (SELECT COUNT(*)::int FROM utility_connections c WHERE c.route_id = r.id AND c.status <> 'DISCONNECTED') AS connections,
        (SELECT COUNT(*)::int FROM utility_connections c JOIN utility_tariffs t ON t.id = c.tariff_id WHERE c.route_id = r.id AND c.status = 'ACTIVE' AND t.metered AND to_char(c.installed_at, 'YYYY-MM') <= ${period}) AS metered,
        (SELECT COUNT(*)::int FROM utility_connections c JOIN utility_tariffs t ON t.id = c.tariff_id WHERE c.route_id = r.id AND c.status = 'ACTIVE' AND t.metered AND to_char(c.installed_at, 'YYYY-MM') <= ${period}
           AND EXISTS (SELECT 1 FROM utility_readings x WHERE x.connection_id = c.id AND x.period = ${period} AND x.status <> 'REJECTED')) AS read,
        (SELECT COUNT(DISTINCT b.connection_id)::int FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id JOIN utility_connections c ON c.id = b.connection_id
           WHERE c.route_id = r.id AND i.total - i.paid_amount - i.returned_amount > 0.5 AND i.due_date < (now() AT TIME ZONE 'Asia/Jakarta')::date) AS arrears
      FROM utility_routes r LEFT JOIN users ru ON ru.id = r.reader_id LEFT JOIN users cu ON cu.id = r.collector_id WHERE r.tenant_id = ${tenantId} ORDER BY r.code`);
  }
  byId(db: DbOrTx, tenantId: string, id: string) { return firstOf<{ id: string; code: string; name: string }>(db, sql`SELECT id, code, name FROM utility_routes WHERE tenant_id = ${tenantId} AND id = ${id}`); }
  async insert(db: DbOrTx, v: { tenantId: string; code: string; name: string; readerId: string | null; collectorId: string | null; zone: string | null }) {
    const r = await firstOf<{ id: string }>(db, sql`INSERT INTO utility_routes (tenant_id, code, name, reader_id, collector_id, zone) VALUES (${v.tenantId}, ${v.code}, ${v.name}, ${v.readerId}, ${v.collectorId}, ${v.zone}) RETURNING id`);
    return r!.id;
  }
  async update(db: DbOrTx, tenantId: string, id: string, v: { code: string; name: string; readerId: string | null; collectorId: string | null; zone: string | null; isActive: boolean }) {
    const r = await rowsOf(db, sql`UPDATE utility_routes SET code = ${v.code}, name = ${v.name}, reader_id = ${v.readerId}, collector_id = ${v.collectorId}, zone = ${v.zone}, is_active = ${v.isActive} WHERE tenant_id = ${tenantId} AND id = ${id} RETURNING id`);
    return r.length > 0;
  }
  /** Masukkan sambungan ke rute (urutan mengikuti alamat) atau keluarkan bila routeId kosong */
  async assign(db: DbOrTx, tenantId: string, routeId: string | null, connectionIds: string[]) {
    if (!routeId) {
      await db.execute(sql`UPDATE utility_connections SET route_id = NULL, route_seq = NULL WHERE tenant_id = ${tenantId} AND id IN (${sql.join(connectionIds.map((c) => sql`${c}::uuid`), sql`, `)})`);
      return;
    }
    const base = await firstOf<{ n: number }>(db, sql`SELECT COALESCE(MAX(route_seq), 0)::int AS n FROM utility_connections WHERE tenant_id = ${tenantId} AND route_id = ${routeId}`);
    await db.execute(sql`WITH picked AS (SELECT id, ROW_NUMBER() OVER (ORDER BY address) AS rn FROM utility_connections WHERE tenant_id = ${tenantId} AND id IN (${sql.join(connectionIds.map((c) => sql`${c}::uuid`), sql`, `)}))
      UPDATE utility_connections c SET route_id = ${routeId}, route_seq = ${base?.n ?? 0} + picked.rn FROM picked WHERE c.id = picked.id`);
  }
  /** Daftar baca satu rute: tiap sambungan dengan status pencatatan periode itu */
  stops(db: DbOrTx, tenantId: string, routeId: string, period: string) {
    return rowsOf<{ id: string; number: string; meter_no: string | null; address: string; customer: string; route_seq: number | null; status: string | null; usage: string | null; metered: boolean }>(db, sql`
      SELECT c.id, c.number, c.meter_no, c.address, cu.name AS customer, c.route_seq, x.status, x.usage::text AS usage, t.metered
      FROM utility_connections c JOIN customers cu ON cu.id = c.customer_id JOIN utility_tariffs t ON t.id = c.tariff_id
      LEFT JOIN LATERAL (SELECT r.status, r.usage FROM utility_readings r WHERE r.connection_id = c.id AND r.period = ${period} AND r.status <> 'REJECTED' LIMIT 1) x ON true
      WHERE c.tenant_id = ${tenantId} AND c.route_id = ${routeId} AND c.status <> 'DISCONNECTED' ORDER BY c.route_seq NULLS LAST, c.address`);
  }
  unassigned(db: DbOrTx, tenantId: string, q: string) {
    const like = `%${q.trim()}%`;
    return rowsOf<{ id: string; number: string; address: string; customer: string; zone: string | null }>(db, sql`
      SELECT c.id, c.number, c.address, cu.name AS customer, c.zone FROM utility_connections c JOIN customers cu ON cu.id = c.customer_id
      WHERE c.tenant_id = ${tenantId} AND c.route_id IS NULL AND c.status <> 'DISCONNECTED' AND (${q.trim()} = '' OR c.address ILIKE ${like} OR cu.name ILIKE ${like} OR c.number ILIKE ${like} OR COALESCE(c.zone, '') ILIKE ${like}) ORDER BY c.address LIMIT 200`);
  }
}
