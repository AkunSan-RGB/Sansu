import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { accounts, assetCategories, assetUsage, fixedAssets, users, assetDepreciations } from '../../db/schema';
import { UpdateAssetDto, VerifyDto } from './assets.dto';
import { Dec } from '../../common/utils/money';

type NewCategory = typeof assetCategories.$inferInsert;

/**
 * Akses data aset tetap: satu-satunya tempat kueri sederhana per perusahaan (tenant) untuk kategori, aset, dan pemakaian.
 * Setiap metode menerima `db` (koneksi atau transaksi berjalan) agar tetap satu transaksi dengan pemanggil.
 */
export type Asset = typeof fixedAssets.$inferSelect;

export type Category = typeof assetCategories.$inferSelect;

@Injectable()
export class AssetRepository {
  async accountById(db: DbOrTx, tenantId: string, id: string) {
    const [a] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.tenantId, tenantId)));
    return a;
  }

  async categoryById(db: DbOrTx, tenantId: string, id: string) {
    const [c] = await db
      .select()
      .from(assetCategories)
      .where(and(eq(assetCategories.id, id), eq(assetCategories.tenantId, tenantId)));
    return c;
  }

  categoriesByAssetAccounts(db: DbOrTx, tenantId: string, accountIds: string[]) {
    return db
      .select()
      .from(assetCategories)
      .where(and(eq(assetCategories.tenantId, tenantId), inArray(assetCategories.assetAccountId, accountIds)));
  }

  categoriesByAssetAccount(db: DbOrTx, tenantId: string, accountId: string) {
    return db
      .select()
      .from(assetCategories)
      .where(and(eq(assetCategories.tenantId, tenantId), eq(assetCategories.assetAccountId, accountId)));
  }

  async insertCategory(db: DbOrTx, values: NewCategory) {
    const [c] = await db.insert(assetCategories).values(values).returning();
    return c;
  }

  async updateCategory(db: DbOrTx, id: string, patch: Partial<NewCategory>) {
    const [c] = await db.update(assetCategories).set(patch).where(eq(assetCategories.id, id)).returning();
    return c;
  }

  async assetById(db: DbOrTx, tenantId: string, id: string) {
    const [a] = await db
      .select()
      .from(fixedAssets)
      .where(and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, tenantId)));
    return a;
  }

  async codes(db: DbOrTx, tenantId: string) {
    const rows = await db
      .select({ code: fixedAssets.code })
      .from(fixedAssets)
      .where(eq(fixedAssets.tenantId, tenantId));
    return rows.map((r) => r.code);
  }

  usageRows(db: DbOrTx, tenantId: string, assetId?: string) {
    return db
      .select()
      .from(assetUsage)
      .where(and(eq(assetUsage.tenantId, tenantId), assetId ? eq(assetUsage.assetId, assetId) : undefined));
  }

  usageRowsOrdered(db: DbOrTx, tenantId: string, assetId: string) {
    return db
      .select()
      .from(assetUsage)
      .where(and(eq(assetUsage.tenantId, tenantId), eq(assetUsage.assetId, assetId)))
      .orderBy(asc(assetUsage.period));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh AssetsService.unregistered */
  queryJournalLine(db: DbOrTx, tenantId: string) {
    return db.execute<{
      journal_id: string;
      number: string;
      date: string;
      description: string;
      source_type: string;
      account_id: string;
      code: string;
      name: string;
      amount: string;
      registered: string;
    }>(sql`
      SELECT j.id AS journal_id, j.number, j.date::text AS date, j.description, j.source_type, a.id AS account_id, a.code, a.name,
             SUM(l.debit) AS amount,
             COALESCE((SELECT SUM(fa.cost) FROM fixed_assets fa JOIN asset_categories c ON c.id = fa.category_id
                       WHERE fa.acquisition_journal_id = j.id AND c.asset_account_id = a.id), 0) AS registered
      FROM journal_lines l
      JOIN journal_entries j ON j.id = l.journal_id
      JOIN accounts a ON a.id = l.account_id
      WHERE j.tenant_id = ${tenantId} AND l.debit > 0
        AND a.id IN (SELECT asset_account_id FROM asset_categories WHERE tenant_id = ${tenantId})
        AND j.source_type NOT IN ('OPENING', 'REVERSAL', 'ASSET_DISPOSAL', 'CLOSING')
        AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = j.id)
      GROUP BY j.id, j.number, j.date, j.description, j.source_type, a.id, a.code, a.name
      ORDER BY j.date, j.number`);
  }

  /** Dipakai oleh AssetsService.registerFromJournalTx */
  queryJournalLineForRegisterFromJournalTx(db: DbOrTx, journalId: string, accountId: string) {
    return db.execute<{ b: string | null }>(
      sql`SELECT branch_id::text AS b FROM journal_lines WHERE journal_id = ${journalId} AND account_id = ${accountId} LIMIT 1`,
    );
  }

  /** Dipakai oleh AssetsService.postedTotals */
  queryAssetDepreciation(db: DbOrTx, tenantId: string, upTo: string) {
    return db.execute<{ asset_id: string; total: string; last: string }>(sql`
      SELECT asset_id, SUM(amount) AS total, MAX(period) AS last FROM asset_depreciations
      WHERE tenant_id = ${tenantId} AND period <= ${upTo} GROUP BY asset_id`);
  }

  /** Dipakai oleh AssetsService.create */
  queryBranche(db: DbOrTx, branchId: string, tenantId: string) {
    return db.execute<{ id: string }>(
      sql`SELECT id FROM branches WHERE id = ${branchId} AND tenant_id = ${tenantId} AND is_active`,
    );
  }

  /** Dipakai oleh AssetsService.update */
  updateFixedAssetsById(db: DbOrTx, dto: UpdateAssetDto, id: string, tenantId: string) {
    return db
      .update(fixedAssets)
      .set(dto)
      .where(and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, tenantId)))
      .returning();
  }

  /** Dipakai oleh AssetsService.nextCode */
  queryNextCode(db: DbOrTx, tenantId: string) {
    return db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`asset-code:${tenantId}`}))`);
  }

  /** Dipakai oleh AssetsService.nextCode */
  queryFixedAsset(db: DbOrTx, tenantId: string) {
    return db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM fixed_assets WHERE tenant_id = ${tenantId}`);
  }

  /** Dipakai oleh AssetsService.run */
  queryRun(db: DbOrTx, tenantId: string) {
    return db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`dep:${tenantId}`}))`);
  }

  /** Dipakai oleh AssetsService.runs */
  queryAssetDepreciationForRuns(db: DbOrTx, tenantId: string) {
    return db.execute<{ period: string; total: string; n: number; journal_id: string; number: string }>(sql`
      SELECT d.period, SUM(d.amount) AS total, COUNT(*)::int AS n, MIN(j.id::text) AS journal_id, MIN(j.number) AS number
      FROM asset_depreciations d LEFT JOIN journal_entries j ON j.id = d.journal_id
      WHERE d.tenant_id = ${tenantId} GROUP BY d.period ORDER BY d.period DESC`);
  }

  /** Dipakai oleh AssetsService.verify */
  updateFixedAssetsByIdAndStatus(db: DbOrTx, dto: VerifyDto, id: string, tenantId: string) {
    return db
      .update(fixedAssets)
      .set({
        lastVerifiedAt: new Date(),
        verificationStatus: dto.status,
        verificationNote: dto.note?.trim() || null,
        ...(dto.location?.trim() ? { location: dto.location.trim() } : {}),
      })
      .where(and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, tenantId), eq(fixedAssets.status, 'ACTIVE')))
      .returning();
  }

  /** Dipakai oleh AssetsService.autoDepreciateAll */
  queryFixedAssetForAutoDepreciateAll(db: DbOrTx) {
    return db.execute<{ tenant_id: string }>(sql`
      SELECT DISTINCT tenant_id FROM fixed_assets WHERE status = 'ACTIVE' AND method <> 'NONE' AND useful_life_months > 0`);
  }

  /** Dipakai oleh AssetsService.autoDepreciateAll */
  findUsersByRoleAndIsActive(db: DbOrTx, tenantId: string) {
    return db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, 'OWNER'), eq(users.isActive, true)))
      .limit(1);
  }

  /** Dipakai oleh AssetsService.notifyAutoFailure */
  listUsersByRoleAndIsActive(db: DbOrTx, tenantId: string) {
    return db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, 'OWNER'), eq(users.isActive, true)));
  }

  // ---- kueri yang dipindah dari service ----
  /** Dipakai oleh AssetsService.run */
  insertAssetDepreciations(
    db: DbOrTx,
    items: { cat: Category; asset: Asset; amount: Dec }[],
    tenantId: string,
    p: string,
    id: string,
  ) {
    return db
      .insert(assetDepreciations)
      .values(
        items.map((it) => ({
          tenantId: tenantId,
          assetId: it.asset.id,
          period: p,
          amount: it.amount.toFixed(2),
          journalId: id,
        })),
      );
  }
}
