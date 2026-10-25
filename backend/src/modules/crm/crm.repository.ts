import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { crmStages, leads, crmActivities, tenants, warehouses, quotations, customers } from '../../db/schema';
import { eq, asc, and, sql, inArray } from 'drizzle-orm';
import { CRM_PROFILES } from '@sansu/shared';

/** Akses data untuk Crm: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class CrmRepository {
  /** Dipakai oleh CrmService.stages */
  listCrmStagesBySequence(db: DbOrTx, tenantId: string) {
    return db.select().from(crmStages).where(eq(crmStages.tenantId, tenantId)).orderBy(asc(crmStages.sequence));
  }

  /** Dipakai oleh CrmService.stages */
  insertCrmStages(
    db: DbOrTx,
    model: 'DAGANG' | 'RITEL' | 'JASA' | 'FMCG' | 'MANUFAKTUR' | 'FNB' | 'UTILITAS',
    tenantId: string,
  ) {
    return db
      .insert(crmStages)
      .values(CRM_PROFILES[model].stages.map((s, i) => ({ tenantId: tenantId, sequence: i + 1, ...s })))
      .returning();
  }

  /** Dipakai oleh CrmService.renameStage */
  updateCrmStagesById(db: DbOrTx, name: string, probability: number | undefined, id: string, tenantId: string) {
    return db
      .update(crmStages)
      .set({ name: name, probability: probability })
      .where(and(eq(crmStages.id, id), eq(crmStages.tenantId, tenantId)))
      .returning();
  }

  /** Dipakai oleh CrmService.deleteStage */
  findCrmStagesById(db: DbOrTx, id: string, tenantId: string) {
    return db
      .select({ id: crmStages.id })
      .from(crmStages)
      .where(and(eq(crmStages.id, id), eq(crmStages.tenantId, tenantId)));
  }

  /** Dipakai oleh CrmService.deleteStage */
  findLeadsByStageId(db: DbOrTx, id: string) {
    return db.select({ id: leads.id }).from(leads).where(eq(leads.stageId, id)).limit(1);
  }

  /** Dipakai oleh CrmService.deleteStage */
  deleteCrmStagesById(db: DbOrTx, id: string, tenantId: string) {
    return db.delete(crmStages).where(and(eq(crmStages.id, id), eq(crmStages.tenantId, tenantId)));
  }

  /** Dipakai oleh CrmService.mark */
  queryMark(db: DbOrTx, tenantId: string) {
    return db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`customer-code:${tenantId}`}))`);
  }

  /** Dipakai oleh CrmService.mark */
  queryCustomer(db: DbOrTx, tenantId: string) {
    return db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM customers WHERE tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh CrmService.doneActivity */
  updateCrmActivitiesById(db: DbOrTx, result: string | undefined, id: string, tenantId: string) {
    return db
      .update(crmActivities)
      .set({ done: true, doneAt: new Date(), result: result })
      .where(and(eq(crmActivities.id, id), eq(crmActivities.tenantId, tenantId)))
      .returning();
  }

  /** Dipakai oleh CrmService.summary */
  queryLead(db: DbOrTx, tenantId: string) {
    return db.execute<{ stage_id: string; n: number; value: string; weighted: string }>(sql`
      SELECT stage_id, COUNT(*)::int AS n, COALESCE(SUM(expected_revenue), 0) AS value,
             COALESCE(SUM(expected_revenue * probability / 100.0), 0) AS weighted
      FROM leads WHERE tenant_id = ${tenantId} AND status = 'OPEN' GROUP BY stage_id`);
  }

  /** Dipakai oleh CrmService.summary */
  queryLeadForSummary(db: DbOrTx, tenantId: string) {
    return db.execute<{ won: number; lost: number; won_value: string }>(sql`
      SELECT COUNT(*) FILTER (WHERE status = 'WON')::int AS won, COUNT(*) FILTER (WHERE status = 'LOST')::int AS lost,
             COALESCE(SUM(expected_revenue) FILTER (WHERE status = 'WON'), 0) AS won_value
      FROM leads WHERE tenant_id = ${tenantId} AND closed_at >= now() - interval '90 days'`);
  }

  /** Dipakai oleh CrmService.getQuotation */
  findTenantsById(db: DbOrTx, tenantId: string) {
    return db
      .select({ name: tenants.name, address: tenants.address, npwp: tenants.npwp })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
  }

  /** Dipakai oleh CrmService.createQuotation */
  findTenantsByIdForCreateQuotation(db: DbOrTx, tenantId: string) {
    return db.select().from(tenants).where(eq(tenants.id, tenantId));
  }

  /** Dipakai oleh CrmService.createQuotation */
  findWarehousesById(db: DbOrTx, warehouseId: string, tenantId: string) {
    return db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.id, warehouseId), eq(warehouses.tenantId, tenantId)));
  }

  /** Dipakai oleh CrmService.createQuotation */
  findLeadsById(db: DbOrTx, leadId: string, tenantId: string) {
    return db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)));
  }

  /** Dipakai oleh CrmService.createQuotation */
  updateLeadsByIdAndCustomerId(db: DbOrTx, customerId: string, leadId: string) {
    return db
      .update(leads)
      .set({ customerId: customerId })
      .where(and(eq(leads.id, leadId), sql`${leads.customerId} IS NULL`));
  }

  /** Dipakai oleh CrmService.convert */
  updateQuotationsByIdAndStatus(db: DbOrTx, id: string, idId: string) {
    return db
      .update(quotations)
      .set({ status: 'ACCEPTED', salesOrderId: id })
      .where(and(eq(quotations.id, idId), inArray(quotations.status, ['DRAFT', 'SENT'])))
      .returning({ id: quotations.id });
  }

  /** Dipakai oleh CrmService.convert */
  updateLeadsByIdAndStatus(db: DbOrTx, leadId: string) {
    return db
      .update(leads)
      .set({ status: 'WON', probability: 100, closedAt: new Date() })
      .where(and(eq(leads.id, leadId), eq(leads.status, 'OPEN')));
  }

  /** Dipakai oleh CrmService.assertCustomer */
  findCustomersById(db: DbOrTx, customerId: string, tenantId: string) {
    return db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
  }
}
