import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { workflowLinks, workflowCases, workflowEvents, customers, suppliers } from '../../db/schema';
import { and, eq, asc, sql, desc } from 'drizzle-orm';
import { AuthUser } from '../../common/auth/auth-user';
import { CaseQueryDto } from './workflow.dto';
import { type WorkflowLinkType } from '@sansu/shared';

/** Akses data untuk Workflow: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class WorkflowRepository {
  /** Dipakai oleh WorkflowService.liveLinks */
  listWorkflowLinksByCaseIdAndCreatedAt(db: DbOrTx, caseId: string, tenantId: string) {
    return db
      .select()
      .from(workflowLinks)
      .where(and(eq(workflowLinks.caseId, caseId), eq(workflowLinks.tenantId, tenantId)))
      .orderBy(asc(workflowLinks.createdAt));
  }

  /** Dipakai oleh WorkflowService.pipelines */
  queryWorkflowCase(db: DbOrTx, tenantId: string) {
    return db.execute<{ pipeline: string; stage: string; n: number }>(
      sql`SELECT pipeline, stage, COUNT(*)::int AS n FROM workflow_cases WHERE tenant_id = ${tenantId} AND status = 'ACTIVE' GROUP BY pipeline, stage`,
    );
  }

  /** Dipakai oleh WorkflowService.list */
  queryWorkflowCaseForList(db: DbOrTx, u: AuthUser, keys: string[], q: CaseQueryDto) {
    return db.execute<Record<string, unknown>>(sql`
      SELECT c.id, c.pipeline, c.number, c.title, c.stage, c.status, c.amount, c.due_date::text AS "dueDate", c.stage_entered_at AS "stageEnteredAt", c.created_at AS "createdAt", c.auto_opened AS "autoOpened",
             cu.name AS "customerName", su.name AS "supplierName",
             (SELECT COUNT(*)::int FROM workflow_links l WHERE l.case_id = c.id) AS "linkCount"
      FROM workflow_cases c LEFT JOIN customers cu ON cu.id = c.customer_id LEFT JOIN suppliers su ON su.id = c.supplier_id
      WHERE c.tenant_id = ${u.tenantId} AND c.pipeline = ANY(${sql.raw(`ARRAY[${keys.map((k) => `'${k}'`).join(',')}]::text[]`)})
        ${q.pipeline ? sql`AND c.pipeline = ${q.pipeline}` : sql``} ${q.status ? sql`AND c.status = ${q.status}` : sql``}
      ORDER BY c.created_at DESC LIMIT 300`);
  }

  /** Dipakai oleh WorkflowService.get */
  queryWorkflowEvent(db: DbOrTx, tenantId: string, id: string) {
    return db.execute<Record<string, unknown>>(sql`
      SELECT e.id, e.kind, e.from_stage AS "fromStage", e.to_stage AS "toStage", e.note, e.auto, e.at, us.name AS "byName"
      FROM workflow_events e LEFT JOIN users us ON us.id = e.by_id WHERE e.tenant_id = ${tenantId} AND e.case_id = ${id} ORDER BY e.id`);
  }

  /** Dipakai oleh WorkflowService.tasksFor */
  listWorkflowCasesByStatus(db: DbOrTx, tenantId: string) {
    return db
      .select()
      .from(workflowCases)
      .where(and(eq(workflowCases.tenantId, tenantId), eq(workflowCases.status, 'ACTIVE')));
  }

  /** Dipakai oleh WorkflowService.creditPosition */
  queryCustomer(db: DbOrTx, customerId: string, tenantId: string) {
    return db.execute<{ lim: string; ar: string }>(sql`
      SELECT cu.credit_limit AS lim, COALESCE((SELECT SUM(i.total - i.paid_amount - i.returned_amount) FROM invoices i WHERE i.tenant_id = cu.tenant_id AND i.customer_id = cu.id AND i.status <> 'PAID'), 0) AS ar
      FROM customers cu WHERE cu.id = ${customerId} AND cu.tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh WorkflowService.alerts */
  queryInvoiceLine(db: DbOrTx, docId: string, tenantId: string) {
    return db.execute<{ n: number; loss: string }>(sql`
          SELECT COUNT(*)::int AS n, COALESCE(SUM((il.unit_cost * il.uom_factor - il.line_total / NULLIF(il.qty, 0)) * il.qty), 0) AS loss
          FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
          WHERE i.id = ${docId} AND i.tenant_id = ${tenantId} AND il.qty > 0 AND il.unit_cost > 0 AND il.line_total / il.qty < il.unit_cost * il.uom_factor`);
  }

  /** Dipakai oleh WorkflowService.alerts */
  queryPosSession(db: DbOrTx, docId: string, tenantId: string) {
    return db.execute<{ difference: string | null }>(
      sql`SELECT difference FROM pos_sessions WHERE id = ${docId} AND tenant_id = ${tenantId}`,
    );
  }

  /** Dipakai oleh WorkflowService.event */
  insertWorkflowEvents(
    db: DbOrTx,
    tenantId: string,
    caseId: string,
    e: { kind: string; from?: string; to?: string; note?: string; by?: string; auto?: boolean },
  ) {
    return db
      .insert(workflowEvents)
      .values({
        tenantId: tenantId,
        caseId: caseId,
        kind: e.kind,
        fromStage: e.from ?? null,
        toStage: e.to ?? null,
        note: e.note ?? null,
        byId: e.by ?? null,
        auto: !!e.auto,
      });
  }

  /** Dipakai oleh WorkflowService.create */
  findCustomersById(db: DbOrTx, customerId: string, tenantId: string) {
    return db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
  }

  /** Dipakai oleh WorkflowService.create */
  findSuppliersById(db: DbOrTx, supplierId: string, tenantId: string) {
    return db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.tenantId, tenantId)));
  }

  /** Dipakai oleh WorkflowService.back */
  findWorkflowEventsByCaseIdAndToStageAndId(db: DbOrTx, id: string, stage: string) {
    return db
      .select()
      .from(workflowEvents)
      .where(and(eq(workflowEvents.caseId, id), eq(workflowEvents.toStage, stage)))
      .orderBy(desc(workflowEvents.id))
      .limit(1);
  }

  /** Dipakai oleh WorkflowService.followLinks */
  listWorkflowLinksByCaseId(db: DbOrTx, id: string, tenantId: string) {
    return db
      .select()
      .from(workflowLinks)
      .where(and(eq(workflowLinks.caseId, id), eq(workflowLinks.tenantId, tenantId)));
  }

  /** Dipakai oleh WorkflowService.followLinks */
  queryFollowLinks(
    db: DbOrTx,
    f: { to: WorkflowLinkType; ids: (tenant: string, id: string) => string },
    tenantId: string,
    docId: string,
  ) {
    return db.execute<{ id: string | null }>(sql.raw(f.ids(tenantId, docId)));
  }

  /** Dipakai oleh WorkflowService.discoverRestock */
  queryStockMinimum(db: DbOrTx, tenantId: string) {
    return db.execute<{
      product_id: string;
      warehouse_id: string;
      min_qty: string;
      qty: string;
      incoming: string;
      sku: string;
      name: string;
      supplier_id: string | null;
      supplier_name: string | null;
    }>(sql`
      SELECT sm.product_id, sm.warehouse_id, sm.min_qty, COALESCE(sb.qty, 0) AS qty, COALESCE(po.qty, 0) + COALESCE(pr.qty, 0) AS incoming, pr0.sku, pr0.name, ls.supplier_id, ls.supplier_name
      FROM stock_minimums sm JOIN products pr0 ON pr0.id = sm.product_id AND pr0.tenant_id = sm.tenant_id AND pr0.is_active
      LEFT JOIN stock_balances sb ON sb.tenant_id = sm.tenant_id AND sb.product_id = sm.product_id AND sb.warehouse_id = sm.warehouse_id
      LEFT JOIN (SELECT l.product_id, o.warehouse_id, SUM((l.qty - l.received_qty) * l.uom_factor) AS qty
                 FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id
                 WHERE o.tenant_id = ${tenantId} AND o.status IN ('DRAFT', 'CONFIRMED') AND l.qty > l.received_qty GROUP BY 1, 2) po ON po.product_id = sm.product_id AND po.warehouse_id = sm.warehouse_id
      LEFT JOIN (SELECT l.product_id, r.warehouse_id, SUM(l.qty * l.uom_factor) AS qty
                 FROM purchase_request_lines l JOIN purchase_requests r ON r.id = l.request_id
                 WHERE r.tenant_id = ${tenantId} AND r.status IN ('SUBMITTED', 'APPROVED') AND l.purchase_order_id IS NULL GROUP BY 1, 2) pr ON pr.product_id = sm.product_id AND pr.warehouse_id = sm.warehouse_id
      LEFT JOIN LATERAL (SELECT o.supplier_id, s.name AS supplier_name FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id JOIN suppliers s ON s.id = o.supplier_id
                         WHERE o.tenant_id = sm.tenant_id AND l.product_id = sm.product_id AND o.status <> 'CANCELLED' ORDER BY o.date DESC, o.created_at DESC LIMIT 1) ls ON true
      WHERE sm.tenant_id = ${tenantId} AND COALESCE(sb.qty, 0) + COALESCE(po.qty, 0) + COALESCE(pr.qty, 0) < sm.min_qty
        AND NOT EXISTS (SELECT 1 FROM workflow_cases c WHERE c.tenant_id = sm.tenant_id AND c.status = 'ACTIVE' AND c.ref_key = 'RESTOCK:' || sm.product_id || ':' || sm.warehouse_id)
      ORDER BY pr0.sku LIMIT 30`);
  }

  /** Dipakai oleh WorkflowService.discoverRestock */
  listWorkflowCasesByStatusAndPipelineAndRefKey(db: DbOrTx, tenantId: string, key: string) {
    return db
      .select()
      .from(workflowCases)
      .where(
        and(
          eq(workflowCases.tenantId, tenantId),
          eq(workflowCases.status, 'ACTIVE'),
          eq(workflowCases.pipeline, key),
          sql`${workflowCases.refKey} LIKE 'RESTOCK:%'`,
        ),
      );
  }

  /** Dipakai oleh WorkflowService.discoverRestock */
  queryDiscoverRestock(db: DbOrTx, tenantId: string, pid: string, wid: string, id: string) {
    return db.execute<{ ok: boolean; links: number }>(sql`
        SELECT (COALESCE((SELECT qty FROM stock_balances WHERE tenant_id = ${tenantId} AND product_id = ${pid}::uuid AND warehouse_id = ${wid}::uuid), 0)
                + COALESCE((SELECT SUM((l.qty - l.received_qty) * l.uom_factor) FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id WHERE o.tenant_id = ${tenantId} AND l.product_id = ${pid}::uuid AND o.warehouse_id = ${wid}::uuid AND o.status IN ('DRAFT', 'CONFIRMED') AND l.qty > l.received_qty), 0)
                >= COALESCE((SELECT min_qty FROM stock_minimums WHERE tenant_id = ${tenantId} AND product_id = ${pid}::uuid AND warehouse_id = ${wid}::uuid), 0)) AS ok,
               (SELECT COUNT(*)::int FROM workflow_links WHERE case_id = ${id}) AS links`);
  }

  /** Dipakai oleh WorkflowService.discoverRestock */
  findWorkflowCasesById(db: DbOrTx, id: string) {
    return db.select().from(workflowCases).where(eq(workflowCases.id, id)).for('update');
  }

  /** Dipakai oleh WorkflowService.sweep */
  listWorkflowCasesByStatusForSweep(db: DbOrTx, tenantId: string) {
    return db
      .select({ id: workflowCases.id })
      .from(workflowCases)
      .where(and(eq(workflowCases.tenantId, tenantId), eq(workflowCases.status, 'ACTIVE')))
      .limit(300);
  }

  /** Dipakai oleh WorkflowService.gate */
  queryPurchaseInvoice(db: DbOrTx, tenantId: string, docId: string) {
    return db.execute<{ case_id: string }>(sql`
        SELECT l.case_id FROM purchase_invoices i JOIN workflow_links l ON l.tenant_id = i.tenant_id AND l.link_type = 'PURCHASE_ORDER' AND l.doc_id = i.purchase_order_id
        WHERE i.tenant_id = ${tenantId} AND i.id = ${docId} LIMIT 1`);
  }

  /** Dipakai oleh WorkflowScheduler.sweepAll */
  queryTenant(db: DbOrTx) {
    return db.execute<{ id: string; owner: string | null }>(sql`
      SELECT t.id, (SELECT u.id FROM users u WHERE u.tenant_id = t.id AND u.role = 'OWNER' ORDER BY u.created_at LIMIT 1) AS owner
      FROM tenants t LIMIT 500`);
  }
}
