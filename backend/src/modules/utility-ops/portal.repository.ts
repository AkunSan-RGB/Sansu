import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { firstOf, rowsOf } from './ops.repository';

@Injectable()
export class PortalRepository {
  /** Pencarian token memakai lingkup tanpa penyaring perusahaan (permintaan publik); semua kueri sesudahnya memakai tenant_id dari baris ini */
  byToken(db: DbOrTx, token: string) {
    return firstOf<{ id: string; tenant_id: string; connection_id: string }>(db, sql`SELECT id, tenant_id, connection_id FROM utility_portal_tokens WHERE token = ${token} AND NOT revoked`);
  }
  touch(db: DbOrTx, id: string) { return db.execute(sql`UPDATE utility_portal_tokens SET last_used_at = now() WHERE id = ${id}`); }
  byConnection(db: DbOrTx, tenantId: string, connectionId: string) {
    return firstOf<{ token: string; revoked: boolean; last_used_at: string | null; created_at: string }>(db, sql`SELECT token, revoked, last_used_at, created_at FROM utility_portal_tokens WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId}`);
  }
  async upsert(db: DbOrTx, tenantId: string, connectionId: string, token: string) {
    await db.execute(sql`INSERT INTO utility_portal_tokens (tenant_id, connection_id, token) VALUES (${tenantId}, ${connectionId}, ${token})
      ON CONFLICT (connection_id) DO UPDATE SET token = EXCLUDED.token, revoked = false, last_used_at = NULL`);
  }
  revoke(db: DbOrTx, tenantId: string, connectionId: string) { return db.execute(sql`UPDATE utility_portal_tokens SET revoked = true WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId}`); }
  connectionInfo(db: DbOrTx, tenantId: string, connectionId: string) {
    return firstOf<{ number: string; address: string; status: string; customer: string; tariff: string; meter_no: string | null; zone: string | null; company: string; company_address: string | null }>(db, sql`
      SELECT c.number, c.address, c.status::text AS status, cu.name AS customer, t.name AS tariff, c.meter_no, c.zone, tn.name AS company, tn.address AS company_address
      FROM utility_connections c JOIN customers cu ON cu.id = c.customer_id JOIN utility_tariffs t ON t.id = c.tariff_id JOIN tenants tn ON tn.id = c.tenant_id
      WHERE c.tenant_id = ${tenantId} AND c.id = ${connectionId}`);
  }
  openBills(db: DbOrTx, tenantId: string, connectionId: string) {
    return rowsOf(db, sql`
      SELECT b.period, i.number AS invoice, i.total, (i.total - i.paid_amount - i.returned_amount) AS outstanding, i.due_date, b.usage
      FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id
      WHERE b.tenant_id = ${tenantId} AND b.connection_id = ${connectionId} AND i.total - i.paid_amount - i.returned_amount > 0.5 ORDER BY b.period`);
  }
  usage(db: DbOrTx, tenantId: string, connectionId: string) {
    return rowsOf(db, sql`
      SELECT b.period, b.usage, i.total, (i.total - i.paid_amount - i.returned_amount) <= 0.5 AS paid
      FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id WHERE b.tenant_id = ${tenantId} AND b.connection_id = ${connectionId} ORDER BY b.period DESC LIMIT 12`);
  }
  counters(db: DbOrTx, tenantId: string) { return rowsOf(db, sql`SELECT name, location FROM utility_counters WHERE tenant_id = ${tenantId} AND is_active ORDER BY name`); }
  complaints(db: DbOrTx, tenantId: string, connectionId: string) {
    return rowsOf(db, sql`SELECT number, category, status, created_at, resolution FROM utility_complaints WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId} ORDER BY created_at DESC LIMIT 10`);
  }
  async openFromPortal(db: DbOrTx, tenantId: string, connectionId: string) {
    const r = await firstOf<{ n: number }>(db, sql`SELECT COUNT(*)::int AS n FROM utility_complaints WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId} AND channel = 'PORTAL' AND status NOT IN ('SELESAI', 'DITUTUP')`);
    return r?.n ?? 0;
  }
}
