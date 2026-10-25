import { DbOrTx } from '../../db/db';
import { tenants, accounts, journalLines, tenantApps, assetCategories } from '../../db/schema';
import { eq, inArray, and, isNull } from 'drizzle-orm';
import { COA_UNUSED_MARK } from './default-coa';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';

/** Dipakai oleh coa-sync.businessModelOf */
export function findTenantsById(db: DbOrTx, tenantId: NonNullable<(typeof tenants.$inferSelect)['id']>) {
  return db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
}

/** Dipakai oleh coa-sync.applyChartRelevance */
export function listAccounts(db: DbOrTx, tenantId: NonNullable<(typeof accounts.$inferSelect)['tenantId']>) {
  return db.select().from(accounts).where(eq(accounts.tenantId, tenantId));
}

/** Dipakai oleh coa-sync.applyChartRelevance */
export function updateAccountsById(db: DbOrTx, id: NonNullable<(typeof accounts.$inferSelect)['id']>) {
  return db.update(accounts).set({ isActive: true, description: null }).where(eq(accounts.id, id));
}

/** Dipakai oleh coa-sync.applyChartRelevance */
export function listJournalLinesByAccountId(
  db: DbOrTx,
  ids: NonNullable<(typeof journalLines.$inferSelect)['accountId']>[],
) {
  return db
    .selectDistinct({ id: journalLines.accountId })
    .from(journalLines)
    .where(inArray(journalLines.accountId, ids));
}

/** Dipakai oleh coa-sync.applyChartRelevance */
export function updateAccountsByIdForApplyChartRelevance(
  db: DbOrTx,
  id: NonNullable<(typeof accounts.$inferSelect)['id']>,
) {
  return db.update(accounts).set({ isActive: false, description: COA_UNUSED_MARK }).where(eq(accounts.id, id));
}

/** Dipakai oleh coa-sync.refreshChartRelevance */
export function listTenantApps(db: DbOrTx, tenantId: NonNullable<(typeof tenantApps.$inferSelect)['tenantId']>) {
  return db.select({ k: tenantApps.appKey }).from(tenantApps).where(eq(tenantApps.tenantId, tenantId));
}

/** Dipakai oleh coa-sync.syncChartOfAccounts */
export function insertAccounts(db: DbOrTx, values: typeof accounts.$inferInsert) {
  return db.insert(accounts).values(values).returning();
}

/** Dipakai oleh coa-sync.syncChartOfAccounts */
export function updateAccountsByIdForSyncChartOfAccounts(
  db: DbOrTx,
  patch: PgUpdateSetSource<typeof accounts>,
  id: NonNullable<(typeof accounts.$inferSelect)['id']>,
) {
  return db.update(accounts).set(patch).where(eq(accounts.id, id)).returning();
}

/** Dipakai oleh coa-sync.syncChartOfAccounts */
export function listAccountsByReportGroupAndIsPostable(
  db: DbOrTx,
  tenantId: NonNullable<(typeof accounts.$inferSelect)['tenantId']>,
) {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.tenantId, tenantId), isNull(accounts.reportGroup), eq(accounts.isPostable, true)));
}

/** Dipakai oleh coa-sync.syncChartOfAccounts */
export function updateAccountsByIdForSyncChartOfAccounts2(
  db: DbOrTx,
  patch: PgUpdateSetSource<typeof accounts>,
  aValues: NonNullable<(typeof accounts.$inferSelect)['id']>,
) {
  return db.update(accounts).set(patch).where(eq(accounts.id, aValues));
}

/** Dipakai oleh coa-sync.syncChartOfAccounts */
export function findAssetCategories(
  db: DbOrTx,
  tenantId: NonNullable<(typeof assetCategories.$inferSelect)['tenantId']>,
) {
  return db
    .select({ id: assetCategories.id })
    .from(assetCategories)
    .where(eq(assetCategories.tenantId, tenantId))
    .limit(1);
}

/** Dipakai oleh coa-sync.syncChartOfAccounts */
export function insertAssetCategories(db: DbOrTx, values: typeof assetCategories.$inferInsert) {
  return db.insert(assetCategories).values(values);
}
