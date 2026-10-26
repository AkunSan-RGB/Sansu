import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { firstOf, rowsOf } from './ops.shared';

export interface ComplaintRow {
  id: string; number: string; connection_id: string | null; customer_id: string | null; reporter_name: string | null; reporter_phone: string | null; category: string; priority: string; channel: string;
  description: string; location: string | null; status: string; assigned_to_id: string | null; assigned_at: string | null; due_at: string | null; resolved_at: string | null; resolution: string | null;
  work_order_id: string | null; created_by_id: string | null; created_at: string; connection_number: string | null; customer_name: string | null; assignee_name: string | null; overdue: boolean;
}

@Injectable()
export class ComplaintsRepository {
  private base() {
    return sql`SELECT c.id, c.number, c.connection_id, c.customer_id, c.reporter_name, c.reporter_phone, c.category, c.priority, c.channel, c.description, c.location, c.status,
        c.assigned_to_id, c.assigned_at::text, c.due_at::text, c.resolved_at::text, c.resolution, c.work_order_id, c.created_by_id, c.created_at::text,
        uc.number AS connection_number, COALESCE(cu.name, c.reporter_name) AS customer_name, u.name AS assignee_name,
        (c.due_at IS NOT NULL AND c.due_at < now() AND c.status IN ('BARU', 'DITUGASKAN', 'DIKERJAKAN')) AS overdue
      FROM utility_complaints c LEFT JOIN utility_connections uc ON uc.id = c.connection_id LEFT JOIN customers cu ON cu.id = c.customer_id LEFT JOIN users u ON u.id = c.assigned_to_id`;
  }
  list(db: DbOrTx, tenantId: string, f: { status?: string; assigneeId?: string; q?: string; open?: boolean }) {
    const like = f.q ? `%${f.q.trim()}%` : null;
    return rowsOf<ComplaintRow>(db, sql`${this.base()} WHERE c.tenant_id = ${tenantId}
      AND (${f.status ?? null}::text IS NULL OR c.status = ${f.status ?? null})
      AND (${f.assigneeId ?? null}::uuid IS NULL OR c.assigned_to_id = ${f.assigneeId ?? null}::uuid)
      AND (${f.open ?? null}::boolean IS NULL OR (c.status IN ('BARU', 'DITUGASKAN', 'DIKERJAKAN', 'SELESAI')) = ${f.open ?? null}::boolean)
      AND (${like}::text IS NULL OR c.number ILIKE ${like} OR c.description ILIKE ${like} OR cu.name ILIKE ${like} OR c.reporter_name ILIKE ${like} OR uc.number ILIKE ${like})
      ORDER BY (c.status IN ('DITUTUP')), c.created_at DESC LIMIT 300`);
  }
  byId(db: DbOrTx, tenantId: string, id: string) {
    return firstOf<ComplaintRow>(db, sql`${this.base()} WHERE c.tenant_id = ${tenantId} AND c.id = ${id}`);
  }
  events(db: DbOrTx, tenantId: string, complaintId: string) {
    return rowsOf<{ id: string; at: string; user_name: string | null; kind: string; from_status: string | null; to_status: string | null; note: string | null }>(db, sql`
      SELECT e.id, e.at::text, u.name AS user_name, e.kind, e.from_status, e.to_status, e.note FROM utility_complaint_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.tenant_id = ${tenantId} AND e.complaint_id = ${complaintId} ORDER BY e.at, e.id`);
  }
  async insert(db: DbOrTx, v: { tenantId: string; number: string; connectionId: string | null; customerId: string | null; reporterName: string | null; reporterPhone: string | null; category: string; priority: string; channel: string; description: string; location: string | null; dueAt: Date; createdById: string | null }) {
    const r = await firstOf<{ id: string }>(db, sql`INSERT INTO utility_complaints (tenant_id, number, connection_id, customer_id, reporter_name, reporter_phone, category, priority, channel, description, location, due_at, created_by_id)
      VALUES (${v.tenantId}, ${v.number}, ${v.connectionId}, ${v.customerId}, ${v.reporterName}, ${v.reporterPhone}, ${v.category}, ${v.priority}, ${v.channel}, ${v.description}, ${v.location}, ${v.dueAt.toISOString()}, ${v.createdById}) RETURNING id`);
    return r!.id;
  }
  async addEvent(db: DbOrTx, tenantId: string, complaintId: string, e: { userId: string | null; kind: string; from?: string | null; to?: string | null; note?: string | null }) {
    await db.execute(sql`INSERT INTO utility_complaint_events (tenant_id, complaint_id, user_id, kind, from_status, to_status, note) VALUES (${tenantId}, ${complaintId}, ${e.userId}, ${e.kind}, ${e.from ?? null}, ${e.to ?? null}, ${e.note ?? null})`);
  }
  async setAssignment(db: DbOrTx, tenantId: string, id: string, assigneeId: string) {
    await db.execute(sql`UPDATE utility_complaints SET assigned_to_id = ${assigneeId}, assigned_at = now(), status = 'DITUGASKAN' WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
  async setStatus(db: DbOrTx, tenantId: string, id: string, status: string, resolution?: string) {
    await db.execute(sql`UPDATE utility_complaints SET status = ${status},
      resolved_at = CASE WHEN ${status} = 'SELESAI' THEN now() WHEN ${status} = 'DIKERJAKAN' THEN NULL ELSE resolved_at END,
      resolution = CASE WHEN ${resolution ?? null}::text IS NOT NULL THEN ${resolution ?? null} ELSE resolution END WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
  async linkWorkOrder(db: DbOrTx, tenantId: string, id: string, workOrderId: string) {
    await db.execute(sql`UPDATE utility_complaints SET work_order_id = ${workOrderId} WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
  summary(db: DbOrTx, tenantId: string) {
    return firstOf<{ open: number; baru: number; overdue: number; done_30d: number; on_time_30d: number; avg_hours_30d: string | null }>(db, sql`
      SELECT COUNT(*) FILTER (WHERE status IN ('BARU', 'DITUGASKAN', 'DIKERJAKAN', 'SELESAI'))::int AS open,
             COUNT(*) FILTER (WHERE status = 'BARU')::int AS baru,
             COUNT(*) FILTER (WHERE due_at < now() AND status IN ('BARU', 'DITUGASKAN', 'DIKERJAKAN'))::int AS overdue,
             COUNT(*) FILTER (WHERE resolved_at >= now() - interval '30 days')::int AS done_30d,
             COUNT(*) FILTER (WHERE resolved_at >= now() - interval '30 days' AND resolved_at <= due_at)::int AS on_time_30d,
             (AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600) FILTER (WHERE resolved_at >= now() - interval '30 days'))::text AS avg_hours_30d
      FROM utility_complaints WHERE tenant_id = ${tenantId}`);
  }
}
