import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { firstOf, rowsOf } from './ops.repository';

export interface AssetRow { id: string; code: string; name: string; type: string; zone: string | null; location: string | null; installed_on: string | null; condition: string; note: string | null; is_active: boolean; open_orders: number; last_done: string | null }
export interface WorkOrderRow {
  id: string; number: string; asset_id: string | null; complaint_id: string | null; type: string; title: string; description: string | null; priority: string; status: string; assigned_to_id: string | null; planned_on: string | null;
  started_at: string | null; finished_at: string | null; labor_cost: string; material_cost: string; result: string | null; created_at: string; asset_code: string | null; asset_name: string | null; complaint_number: string | null; assignee_name: string | null;
}

@Injectable()
export class NetworkAssetsRepository {
  listAssets(db: DbOrTx, tenantId: string) {
    return rowsOf<AssetRow>(db, sql`
      SELECT a.id, a.code, a.name, a.type, a.zone, a.location, a.installed_on::text, a.condition, a.note, a.is_active,
        (SELECT COUNT(*)::int FROM utility_work_orders w WHERE w.asset_id = a.id AND w.status IN ('DIBUAT', 'DIKERJAKAN')) AS open_orders,
        (SELECT MAX(w.finished_at)::date::text FROM utility_work_orders w WHERE w.asset_id = a.id AND w.status = 'SELESAI') AS last_done
      FROM utility_network_assets a WHERE a.tenant_id = ${tenantId} ORDER BY a.code`);
  }
  assetById(db: DbOrTx, tenantId: string, id: string) {
    return firstOf<{ id: string; code: string; name: string }>(db, sql`SELECT id, code, name FROM utility_network_assets WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
  async insertAsset(db: DbOrTx, v: { tenantId: string; code: string; name: string; type: string; zone: string | null; location: string | null; installedOn: string | null; condition: string; note: string | null }) {
    const r = await firstOf<{ id: string }>(db, sql`INSERT INTO utility_network_assets (tenant_id, code, name, type, zone, location, installed_on, condition, note) VALUES (${v.tenantId}, ${v.code}, ${v.name}, ${v.type}, ${v.zone}, ${v.location}, ${v.installedOn}, ${v.condition}, ${v.note}) RETURNING id`);
    return r!.id;
  }
  async updateAsset(db: DbOrTx, tenantId: string, id: string, v: { code: string; name: string; type: string; zone: string | null; location: string | null; installedOn: string | null; condition: string; note: string | null; isActive: boolean }) {
    const r = await rowsOf(db, sql`UPDATE utility_network_assets SET code = ${v.code}, name = ${v.name}, type = ${v.type}, zone = ${v.zone}, location = ${v.location}, installed_on = ${v.installedOn}, condition = ${v.condition}, note = ${v.note}, is_active = ${v.isActive} WHERE tenant_id = ${tenantId} AND id = ${id} RETURNING id`);
    return r.length > 0;
  }
  async setCondition(db: DbOrTx, tenantId: string, id: string, condition: string) {
    await db.execute(sql`UPDATE utility_network_assets SET condition = ${condition} WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }

  private wo() {
    return sql`SELECT w.id, w.number, w.asset_id, w.complaint_id, w.type, w.title, w.description, w.priority, w.status, w.assigned_to_id, w.planned_on::text, w.started_at::text, w.finished_at::text,
        w.labor_cost::text, w.material_cost::text, w.result, w.created_at::text, a.code AS asset_code, a.name AS asset_name, c.number AS complaint_number, u.name AS assignee_name
      FROM utility_work_orders w LEFT JOIN utility_network_assets a ON a.id = w.asset_id LEFT JOIN utility_complaints c ON c.id = w.complaint_id LEFT JOIN users u ON u.id = w.assigned_to_id`;
  }
  listOrders(db: DbOrTx, tenantId: string, f: { status?: string; assigneeId?: string; assetId?: string }) {
    return rowsOf<WorkOrderRow>(db, sql`${this.wo()} WHERE w.tenant_id = ${tenantId}
      AND (${f.status ?? null}::text IS NULL OR w.status = ${f.status ?? null})
      AND (${f.assigneeId ?? null}::uuid IS NULL OR w.assigned_to_id = ${f.assigneeId ?? null}::uuid)
      AND (${f.assetId ?? null}::uuid IS NULL OR w.asset_id = ${f.assetId ?? null}::uuid)
      ORDER BY (w.status IN ('SELESAI', 'BATAL')), w.created_at DESC LIMIT 300`);
  }
  orderById(db: DbOrTx, tenantId: string, id: string) {
    return firstOf<WorkOrderRow>(db, sql`${this.wo()} WHERE w.tenant_id = ${tenantId} AND w.id = ${id}`);
  }
  async insertOrder(db: DbOrTx, v: { tenantId: string; number: string; assetId: string | null; complaintId: string | null; type: string; title: string; description: string | null; priority: string; assigneeId: string | null; plannedOn: string | null; createdById: string }) {
    const r = await firstOf<{ id: string }>(db, sql`INSERT INTO utility_work_orders (tenant_id, number, asset_id, complaint_id, type, title, description, priority, assigned_to_id, planned_on, created_by_id)
      VALUES (${v.tenantId}, ${v.number}, ${v.assetId}, ${v.complaintId}, ${v.type}, ${v.title}, ${v.description}, ${v.priority}, ${v.assigneeId}, ${v.plannedOn}, ${v.createdById}) RETURNING id`);
    return r!.id;
  }
  async setOrderStatus(db: DbOrTx, tenantId: string, id: string, v: { status: string; result?: string | null; laborCost?: string; materialCost?: string }) {
    await db.execute(sql`UPDATE utility_work_orders SET status = ${v.status},
      started_at = CASE WHEN ${v.status} = 'DIKERJAKAN' AND started_at IS NULL THEN now() ELSE started_at END,
      finished_at = CASE WHEN ${v.status} = 'SELESAI' THEN now() ELSE finished_at END,
      result = COALESCE(${v.result ?? null}, result), labor_cost = COALESCE(${v.laborCost ?? null}::numeric, labor_cost), material_cost = COALESCE(${v.materialCost ?? null}::numeric, material_cost)
      WHERE tenant_id = ${tenantId} AND id = ${id}`);
  }
  summary(db: DbOrTx, tenantId: string) {
    return firstOf<{ open: number; done_30d: number; cost_30d: string; broken_assets: number; need_care: number }>(db, sql`
      SELECT (SELECT COUNT(*)::int FROM utility_work_orders WHERE tenant_id = ${tenantId} AND status IN ('DIBUAT', 'DIKERJAKAN')) AS open,
             (SELECT COUNT(*)::int FROM utility_work_orders WHERE tenant_id = ${tenantId} AND status = 'SELESAI' AND finished_at >= now() - interval '30 days') AS done_30d,
             (SELECT COALESCE(SUM(labor_cost + material_cost), 0)::text FROM utility_work_orders WHERE tenant_id = ${tenantId} AND status = 'SELESAI' AND finished_at >= now() - interval '30 days') AS cost_30d,
             (SELECT COUNT(*)::int FROM utility_network_assets WHERE tenant_id = ${tenantId} AND is_active AND condition = 'RUSAK') AS broken_assets,
             (SELECT COUNT(*)::int FROM utility_network_assets WHERE tenant_id = ${tenantId} AND is_active AND condition = 'PERLU_PERAWATAN') AS need_care`);
  }
}
