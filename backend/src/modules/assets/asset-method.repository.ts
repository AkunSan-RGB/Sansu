import { Injectable } from '@nestjs/common';
import { DbOrTx } from '../../db/db';
import { assetUsage } from '../../db/schema';
import { and, eq, sql } from 'drizzle-orm';

/** Akses data untuk AssetMethod: kueri dipisah dari logika bisnis; setiap metode memakai koneksi/transaksi pemanggil. */
@Injectable()
export class AssetMethodRepository {
  /** Dipakai oleh AssetMethodService.setUsage */
  findAssetUsageByAssetIdAndPeriod(db: DbOrTx, id: string, period: string) {
    return db
      .select()
      .from(assetUsage)
      .where(and(eq(assetUsage.assetId, id), eq(assetUsage.period, period)));
  }

  /** Dipakai oleh AssetMethodService.setUsage */
  listAssetUsageByAssetId(db: DbOrTx, id: string) {
    return db.select().from(assetUsage).where(eq(assetUsage.assetId, id));
  }

  /** Dipakai oleh AssetMethodService.changeMethod */
  queryAssetDepreciation(db: DbOrTx, id: string) {
    return db.execute<{ total: string }>(
      sql`SELECT COALESCE(SUM(amount), 0) AS total FROM asset_depreciations WHERE asset_id = ${id}`,
    );
  }
}
