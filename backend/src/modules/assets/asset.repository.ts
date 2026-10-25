import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DbOrTx } from '../../db/db';
import { accounts, assetCategories, assetUsage, fixedAssets } from '../../db/schema';

type NewCategory = typeof assetCategories.$inferInsert;

/**
 * Akses data aset tetap: satu-satunya tempat kueri sederhana per perusahaan (tenant) untuk kategori, aset, dan pemakaian.
 * Setiap metode menerima `db` (koneksi atau transaksi berjalan) agar tetap satu transaksi dengan pemanggil.
 */
@Injectable()
export class AssetRepository {
  async accountById(db: DbOrTx, tenantId: string, id: string) {
    const [a] = await db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.tenantId, tenantId)));
    return a;
  }

  async categoryById(db: DbOrTx, tenantId: string, id: string) {
    const [c] = await db.select().from(assetCategories).where(and(eq(assetCategories.id, id), eq(assetCategories.tenantId, tenantId)));
    return c;
  }

  categoriesByAssetAccounts(db: DbOrTx, tenantId: string, accountIds: string[]) {
    return db.select().from(assetCategories).where(and(eq(assetCategories.tenantId, tenantId), inArray(assetCategories.assetAccountId, accountIds)));
  }

  categoriesByAssetAccount(db: DbOrTx, tenantId: string, accountId: string) {
    return db.select().from(assetCategories).where(and(eq(assetCategories.tenantId, tenantId), eq(assetCategories.assetAccountId, accountId)));
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
    const [a] = await db.select().from(fixedAssets).where(and(eq(fixedAssets.id, id), eq(fixedAssets.tenantId, tenantId)));
    return a;
  }

  async codes(db: DbOrTx, tenantId: string) {
    const rows = await db.select({ code: fixedAssets.code }).from(fixedAssets).where(eq(fixedAssets.tenantId, tenantId));
    return rows.map((r) => r.code);
  }

  usageRows(db: DbOrTx, tenantId: string, assetId?: string) {
    return db.select().from(assetUsage).where(and(eq(assetUsage.tenantId, tenantId), assetId ? eq(assetUsage.assetId, assetId) : undefined));
  }

  usageRowsOrdered(db: DbOrTx, tenantId: string, assetId: string) {
    return db.select().from(assetUsage).where(and(eq(assetUsage.tenantId, tenantId), eq(assetUsage.assetId, assetId))).orderBy(asc(assetUsage.period));
  }
}
