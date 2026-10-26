import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { firstOf, rowsOf } from './ops.repository';

export interface ChangeRow {
  id: string; connection_id: string; connection_number: string; customer_name: string; kind: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; reason: string; status: string;
  requested_by_id: string; requester_name: string | null; decided_by_id: string | null; decider_name: string | null; decided_at: string | null; decision_note: string | null; created_at: string;
}
export interface ConnectionFacts { id: string; number: string; customer_id: string; customer_name: string; tariff_id: string; tariff_name: string; address: string; zone: string | null; status: string; metered: boolean }

@Injectable()
export class ChangesRepository {
  private base() {
    return sql`SELECT ch.id, ch.connection_id, c.number AS connection_number, cu.name AS customer_name, ch.kind, ch."before", ch."after", ch.reason, ch.status, ch.requested_by_id, ru.name AS requester_name,
        ch.decided_by_id, du.name AS decider_name, ch.decided_at::text, ch.decision_note, ch.created_at::text
      FROM utility_connection_changes ch JOIN utility_connections c ON c.id = ch.connection_id JOIN customers cu ON cu.id = c.customer_id
      LEFT JOIN users ru ON ru.id = ch.requested_by_id LEFT JOIN users du ON du.id = ch.decided_by_id`;
  }
  list(db: DbOrTx, tenantId: string, f: { status?: string; connectionId?: string }) {
    return rowsOf<ChangeRow>(db, sql`${this.base()} WHERE ch.tenant_id = ${tenantId} AND (${f.status ?? null}::text IS NULL OR ch.status = ${f.status ?? null})
      AND (${f.connectionId ?? null}::uuid IS NULL OR ch.connection_id = ${f.connectionId ?? null}::uuid) ORDER BY (ch.status <> 'DIAJUKAN'), ch.created_at DESC LIMIT 300`);
  }
  byId(db: DbOrTx, tenantId: string, id: string) { return firstOf<ChangeRow>(db, sql`${this.base()} WHERE ch.tenant_id = ${tenantId} AND ch.id = ${id}`); }
  facts(db: DbOrTx, tenantId: string, id: string) {
    return firstOf<ConnectionFacts>(db, sql`SELECT c.id, c.number, c.customer_id, cu.name AS customer_name, c.tariff_id, t.name AS tariff_name, c.address, c.zone, c.status::text AS status, t.metered
      FROM utility_connections c JOIN customers cu ON cu.id = c.customer_id JOIN utility_tariffs t ON t.id = c.tariff_id WHERE c.tenant_id = ${tenantId} AND c.id = ${id}`);
  }
  async openAmount(db: DbOrTx, tenantId: string, connectionId: string) {
    const r = await firstOf<{ v: string }>(db, sql`SELECT COALESCE(SUM(i.total - i.paid_amount - i.returned_amount), 0)::text AS v FROM utility_bills b JOIN invoices i ON i.id = b.invoice_id
      WHERE b.tenant_id = ${tenantId} AND b.connection_id = ${connectionId} AND i.total - i.paid_amount - i.returned_amount > 0.5`);
    return Number(r?.v ?? 0);
  }
  async pendingReadings(db: DbOrTx, tenantId: string, connectionId: string) {
    const r = await firstOf<{ n: number }>(db, sql`SELECT COUNT(*)::int AS n FROM utility_readings WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId} AND status IN ('ENTERED', 'VERIFIED')`);
    return r?.n ?? 0;
  }
  async pendingFor(db: DbOrTx, tenantId: string, connectionId: string, kind: string) {
    const r = await firstOf<{ n: number }>(db, sql`SELECT COUNT(*)::int AS n FROM utility_connection_changes WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId} AND kind = ${kind} AND status = 'DIAJUKAN'`);
    return (r?.n ?? 0) > 0;
  }
  tariff(db: DbOrTx, tenantId: string, id: string) {
    return firstOf<{ id: string; name: string; metered: boolean; service_type: string }>(db, sql`SELECT id, name, metered, service_type::text AS service_type FROM utility_tariffs WHERE tenant_id = ${tenantId} AND id = ${id} AND is_active`);
  }
  async insert(db: DbOrTx, v: { tenantId: string; connectionId: string; kind: string; before: unknown; after: unknown; reason: string; requestedById: string }) {
    const r = await firstOf<{ id: string }>(db, sql`INSERT INTO utility_connection_changes (tenant_id, connection_id, kind, "before", "after", reason, requested_by_id)
      VALUES (${v.tenantId}, ${v.connectionId}, ${v.kind}, ${JSON.stringify(v.before)}::jsonb, ${JSON.stringify(v.after)}::jsonb, ${v.reason}, ${v.requestedById}) RETURNING id`);
    return r!.id;
  }
  async decide(db: DbOrTx, tenantId: string, id: string, status: string, userId: string, note: string | null) {
    await db.execute(sql`UPDATE utility_connection_changes SET status = ${status}, decided_by_id = ${userId}, decided_at = now(), decision_note = ${note} WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
  async applyOwner(db: DbOrTx, tenantId: string, connectionId: string, customerId: string) {
    await db.execute(sql`UPDATE utility_connections SET customer_id = ${customerId} WHERE tenant_id = ${tenantId} AND id = ${connectionId}`);
  }
  async applyTariff(db: DbOrTx, tenantId: string, connectionId: string, tariffId: string) {
    await db.execute(sql`UPDATE utility_connections SET tariff_id = ${tariffId} WHERE tenant_id = ${tenantId} AND id = ${connectionId}`);
  }
  async applyAddress(db: DbOrTx, tenantId: string, connectionId: string, address: string, zone: string | null) {
    await db.execute(sql`UPDATE utility_connections SET address = ${address}, zone = ${zone} WHERE tenant_id = ${tenantId} AND id = ${connectionId}`);
  }
  async addressTaken(db: DbOrTx, tenantId: string, connectionId: string, address: string) {
    const r = await firstOf<{ n: number }>(db, sql`SELECT COUNT(*)::int AS n FROM utility_connections WHERE tenant_id = ${tenantId} AND id <> ${connectionId} AND lower(address) = lower(${address}) AND status <> 'DISCONNECTED'`);
    return (r?.n ?? 0) > 0;
  }
}
